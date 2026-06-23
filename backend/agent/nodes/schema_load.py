import time
from typing import Dict, Any, List, Optional
from session import SessionManager
from schema import introspect_schema
from schema_format import format_schema_for_prompt

# Simple schema cache with TTL (5 minutes)
schema_cache = {}
CACHE_TTL = 300 # 5 minutes in seconds

def schema_load_node(state: Dict[str, Any]) -> Dict[str, Any]:
    # Already loaded this turn
    if state.get("schema_info") and state.get("schema_formatted"):
        return {}

    # Intents that don't need schema
    no_schema_intents = {'greeting', 'out_of_scope', 'clarify_needed'}
    if state.get("intent") in no_schema_intents:
        return {}

    try:
        session_id = state.get("thread_id")
        connection = SessionManager.get_connection(session_id)
        if not connection:
            return {"error": "No active database connection. Please connect to a database first."}

        cache_key = f"{connection.get('id')}:{state.get('db_dialect')}"
        now = time.time()
        
        # Check cache
        if cache_key in schema_cache:
            cached = schema_cache[cache_key]
            if now - cached["ts"] < CACHE_TTL:
                return {
                    "schema_info": cached["schema_info"],
                    "schema_formatted": cached["schema_formatted"]
                }

        # Introspect & format
        schema_info = introspect_schema(connection)
        schema_formatted = format_schema_for_prompt(schema_info, state.get("db_dialect", "sqlite"))

        # Save to cache
        schema_cache[cache_key] = {
            "schema_info": schema_info,
            "schema_formatted": schema_formatted,
            "ts": now
        }

        return {
            "schema_info": schema_info,
            "schema_formatted": schema_formatted
        }
    except Exception as e:
        return {
            "error": f"Schema introspection failed: {str(e)}. Check your database connection."
        }

def clear_schema_cache(connection_id: Optional[str] = None) -> None:
    if connection_id:
        keys_to_delete = [k for k in schema_cache.keys() if k.startswith(f"{connection_id}:")]
        for k in keys_to_delete:
            if k in schema_cache:
                del schema_cache[k]
    else:
        schema_cache.clear()
