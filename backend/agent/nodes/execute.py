import json
from typing import Dict, Any
from langchain_core.messages import AIMessage, HumanMessage

from session import SessionManager
from database import execute_query
from agent.nodes.schema_load import clear_schema_cache

def execute_node(state: Dict[str, Any]) -> Dict[str, Any]:
    # Skip if mutation was rejected
    if state.get("is_mutation") and state.get("human_approved") is False:
        return {}
    # Skip if no SQL or there's already an unhandled error
    if not state.get("generated_sql") or state.get("error"):
        return {}

    try:
        session_id = state.get("thread_id")
        connection = SessionManager.get_connection(session_id)
        if not connection:
            err_msg = "No active database connection. Please connect to a database first."
            return {
                "error": err_msg,
                "final_response": {
                    "type": "error",
                    "message": err_msg
                }
            }

        # Execute query
        result = execute_query(connection, state.get("generated_sql"))

        # Clear schema cache if DDL or mutation to ensure schema is fresh
        if state.get("intent") == "sql_schema" or state.get("is_mutation"):
            clear_schema_cache(connection.get("id"))

        # Summarize rows for assistant message
        rows = result.get("rows", [])
        if rows:
            sample_rows = rows[:5]
            rows_summary_list = []
            for r in sample_rows:
                s = json.dumps(r)
                if len(s) > 300:
                    s = s[:300] + "..."
                rows_summary_list.append(s)
            rows_summary = "\n".join(rows_summary_list)
        else:
            rows_summary = "No rows returned."

        ai_message = AIMessage(
            content=f"SQL:\n```sql\n{state.get('generated_sql')}\n```\n\n"
                    f"Explanation: {state.get('explanation')}\n\n"
                    f"Execution Result (sample):\n{rows_summary}"
        )

        res_obj = {
            "columns": result.get("columns", []),
            "rows": rows,
            "rowCount": len(rows)
        }

        # Build update
        update = {
            "messages": [ai_message],
            "execution_result": res_obj,
        }

        # Incorporate result into final response
        final_resp = state.get("final_response")
        if final_resp:
            updated_final = dict(final_resp)
            updated_final["result"] = res_obj
            update["final_response"] = updated_final
        else:
            update["final_response"] = {
                "type": "sql",
                "sql": state.get("generated_sql"),
                "explanation": state.get("explanation"),
                "result": res_obj
            }

        return update

    except Exception as err:
        err_msg = str(err)
        retry_count = state.get("retry_count", 0)

        # Automatic error recovery - retry up to 2 times
        if retry_count < 2:
            error_context = HumanMessage(
                content=f"The previous SQL query failed with this error:\n\n"
                        f"Error: {err_msg}\n\n"
                        f"Failed SQL:\n```sql\n{state.get('generated_sql')}\n```\n\n"
                        f"Please analyze the error and generate a corrected SQL query. "
                        f"Do not repeat the same query."
            )
            return {
                "messages": [error_context],
                "generated_sql": "",
                "error": err_msg,
                "retry_count": retry_count + 1,
                "last_failed_sql": state.get("generated_sql")
            }

        # Retries exhausted — surface query error
        ai_message = AIMessage(content=f"SQL execution failed: {err_msg}")
        return {
            "messages": [ai_message],
            "error": err_msg,
            "final_response": {
                "type": "error",
                "message": f"Query failed after {retry_count + 1} attempts: {err_msg}",
                "sql": state.get("generated_sql")
            }
        }
