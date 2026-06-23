import os
import re
import json
import time
import random
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, Header, HTTPException, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import local backend modules
from config import PORT, GROQ_MODEL, ANTHROPIC_MODEL, OPENROUTER_MODEL
from session import (
    SessionManager,
    strip_password,
    validate_connection
)
from database import test_connection, execute_query, ensure_demo_database
from schema import introspect_schema
from agent import run_agent

# LLM imports for analyze endpoint
from langchain_groq import ChatGroq
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

app = FastAPI(title="PrepSQL Backend", version="1.0.0")

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper to get session ID from header
def get_session_id(x_prepsql_session_id: Optional[str] = Header(None)) -> str:
    if not x_prepsql_session_id:
        raise HTTPException(status_code=400, detail="x-prepsql-session-id header is required")
    return x_prepsql_session_id

# LLM call helper for JSON responses (for analyze)
def generate_json_response(prompt: str, session_id: str) -> Dict[str, Any]:
    key_info = SessionManager.get_ai_api_key(session_id)
    if not key_info:
        raise HTTPException(
            status_code=400,
            detail="AI API key not configured. Add a Groq or Anthropic key in Settings."
        )

    provider, api_key = key_info
    
    if provider == 'openrouter':
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(
            openai_api_key=api_key,
            openai_api_base="https://openrouter.ai/api/v1",
            model=OPENROUTER_MODEL,
            temperature=0.1,
            max_tokens=4096,
            max_retries=0,
            default_headers={
                "HTTP-Referer": "https://github.com/kaivals/PrepSql",
                "X-Title": "PrepSql"
            }
        )
        messages = [
            SystemMessage(content="You are a database performance expert. Respond only in raw JSON matching the requested schema. Do not wrap in conversational text."),
            HumanMessage(content=prompt)
        ]
        response = llm.invoke(messages)
        raw = response.content
    elif provider == 'groq':
        llm = ChatGroq(
            api_key=api_key,
            model=GROQ_MODEL,
            temperature=0.1,
            max_tokens=1024,
            max_retries=0
        )
        messages = [
            SystemMessage(content="You are a database performance expert. Respond only in raw JSON matching the requested schema."),
            HumanMessage(content=prompt)
        ]
        response = llm.invoke(messages, response_format={"type": "json_object"})
        raw = response.content
    else:
        llm = ChatAnthropic(
            api_key=api_key,
            model=ANTHROPIC_MODEL,
            temperature=0.1,
            max_tokens=1024,
            max_retries=0
        )
        messages = [
            SystemMessage(content="You are a database performance expert. Respond only in raw JSON matching the requested schema. Do not wrap in conversational text."),
            HumanMessage(content=prompt)
        ]
        response = llm.invoke(messages)
        raw = response.content

    raw_str = raw.strip() if isinstance(raw, str) else ""
    
    # Extract JSON block if LLM adds conversational wrapping
    json_match = re.search(r'\{[\s\S]*\}', raw_str)
    if not json_match:
        raise HTTPException(status_code=500, detail="Failed to parse JSON response from AI model")
    
    try:
        return json.loads(json_match.group(0))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse JSON response: {e}")


# --- 1. Connection Endpoints ---

@app.get("/api/connection")
def get_connection_info(session_id: str = Header(..., alias="x-prepsql-session-id")):
    conns = SessionManager.get_connections(session_id)
    active = SessionManager.get_connection(session_id)
    return {
        "connections": [strip_password(c) for c in conns],
        "connection": strip_password(active) if active else None,
        "connected": active is not None
    }

class ConnectionPayload(BaseModel):
    type: str
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    user: Optional[str] = None
    password: Optional[str] = ""
    database: Optional[str] = None
    filepath: Optional[str] = None

@app.post("/api/connection")
def set_connection(
    payload: ConnectionPayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    conn_dict = payload.model_dump()
    valid, err_msg = validate_connection(conn_dict)
    if not valid:
        raise HTTPException(status_code=400, detail=err_msg)

    try:
        # Test connection
        test_connection(conn_dict)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to connect: {e}")

    # Add connection
    conn = SessionManager.add_connection(session_id, {
        "type": payload.type,
        "name": payload.name or payload.type,
        "host": payload.host,
        "port": payload.port,
        "user": payload.user,
        "password": payload.password or "",
        "database": payload.database,
        "filepath": payload.filepath
    })

    return {
        "success": True,
        "message": "Connected successfully",
        "connection": strip_password(conn)
    }

class ActivatePayload(BaseModel):
    id: str

@app.patch("/api/connection")
def activate_connection(
    payload: ActivatePayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    SessionManager.set_active_connection(session_id, payload.id)
    conn = SessionManager.get_connection(session_id)
    return {
        "connection": strip_password(conn) if conn else None
    }

@app.delete("/api/connection")
def delete_connection(
    id: str,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    SessionManager.remove_connection(session_id, id)
    return {"success": True}


DEMO_DB_NAME = 'Company Database (Complex)'

@app.post("/api/demo")
def setup_demo_db(session_id: str = Header(..., alias="x-prepsql-session-id")):
    try:
        filepath = ensure_demo_database()
        
        existing = SessionManager.get_connections(session_id)
        found = None
        for c in existing:
            if c.get("name") == DEMO_DB_NAME and c.get("type") == 'sqlite':
                found = c
                break
                
        if found:
            return {
                "success": True,
                "message": "Demo database already connected",
                "connection": found,
                "alreadyExists": True
            }
            
        demo_config = {
            "type": "sqlite",
            "name": DEMO_DB_NAME,
            "filepath": filepath
        }
        
        # Test connection
        test_connection(demo_config)
        
        connection = SessionManager.add_connection(session_id, demo_config)
        
        return {
            "success": True,
            "message": "Demo database ready",
            "connection": connection,
            "alreadyExists": False
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# --- 2. Schema Introspection Endpoints ---

@app.get("/api/schema")
def get_schema(session_id: str = Header(..., alias="x-prepsql-session-id")):
    connection = SessionManager.get_connection(session_id)
    if not connection:
        raise HTTPException(status_code=400, detail="No database connection")
    try:
        tables = introspect_schema(connection)
        return {"tables": tables}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# --- 3. SQL Execution Endpoints ---

class ExecutePayload(BaseModel):
    sql: str

@app.post("/api/execute")
def run_sql(
    payload: ExecutePayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    sql = payload.sql.strip()
    if not sql:
        raise HTTPException(status_code=400, detail="SQL is required")

    connection = SessionManager.get_connection(session_id)
    if not connection:
        raise HTTPException(status_code=400, detail="No database connection. Please connect first.")

    try:
        start_time = time.perf_counter()
        result = execute_query(connection, sql)
        execution_time = int((time.perf_counter() - start_time) * 1000)

        # Limit rows
        rows = result.get("rows", [])
        truncated = False
        if len(rows) > 1000:
            rows = rows[:1000]
            truncated = True
            
        rows_returned = len(rows)
        
        # Realistic metrics simulation
        if sql.upper().startswith("SELECT"):
            if execution_time > 100:
                rows_scanned = int(rows_returned * 8 + (execution_time * 65) + random.randint(0, 200))
            else:
                rows_scanned = int(rows_returned * 1.15 + random.randint(0, 8) + 2)
        else:
            rows_scanned = result.get("rowsAffected", 1) or 1

        cpu_usage = min(99, max(1, int((execution_time / 300) * 100) + random.randint(0, 5)))
        memory_usage = min(512, max(1, int(rows_returned * 0.04) + random.randint(0, 6) + 1))

        table_match = re.search(r'from\s+["`]?(\w+)["`]?', sql, re.IGNORECASE)
        table_name = table_match.group(1) if table_match else ""
        indexes_used = []
        if "WHERE" in sql.upper() and ("ID =" in sql.upper() or "ID=" in sql.upper()):
            indexes_used.append(f"pk_{table_name or 'table'}")

        # Add to history
        SessionManager.add_to_history(session_id, {
            "prompt": "",
            "sql": sql,
            "timestamp": int(time.time() * 1000),
            "success": True,
            "rowsAffected": result.get("rowsAffected", 0),
            "executionTime": execution_time,
            "rowsScanned": rows_scanned,
            "rowsReturned": rows_returned,
            "cpuUsage": cpu_usage,
            "memoryUsage": memory_usage,
            "indexesUsed": indexes_used
        })

        return {
            "columns": result.get("columns", []),
            "rows": rows,
            "rowsAffected": result.get("rowsAffected", 0),
            "rowCount": rows_returned,
            "truncated": truncated
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        err_msg = str(e)
        SessionManager.add_to_history(session_id, {
            "prompt": "",
            "sql": sql,
            "timestamp": int(time.time() * 1000),
            "success": False,
            "error": err_msg,
            "executionTime": 0,
            "rowsScanned": 0,
            "rowsReturned": 0,
            "cpuUsage": 0,
            "memoryUsage": 0,
            "indexesUsed": []
        })
        raise HTTPException(status_code=400, detail=err_msg)


# --- 4. History Endpoints ---

@app.get("/api/history")
def get_history_logs(session_id: str = Header(..., alias="x-prepsql-session-id")):
    history = SessionManager.get_history(session_id)
    return {"history": history}

@app.delete("/api/history")
def clear_history_logs(session_id: str = Header(..., alias="x-prepsql-session-id")):
    SessionManager.clear_history(session_id)
    return {"success": True, "message": "History cleared"}


# --- 5. Generate / Agent Endpoints ---

class GeneratePayload(BaseModel):
    prompt: Optional[str] = ""
    action: Optional[str] = None

@app.post("/api/generate")
def run_generation_agent(
    payload: GeneratePayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    if not payload.prompt and not payload.action:
        raise HTTPException(status_code=400, detail="Prompt or action is required")
        
    try:
        response = run_agent(
            prompt=payload.prompt or "",
            thread_id=session_id,
            action=payload.action
        )
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# --- 6. AI Key Settings Endpoints ---

@app.get("/api/settings")
def get_settings(session_id: str = Header(..., alias="x-prepsql-session-id")):
    info = SessionManager.get_ai_key_info(session_id)
    return {
        "configured": info.get("configured", False),
        "provider": info.get("provider"),
        "source": info.get("source", "none"),
        "maskedKey": info.get("maskedKey")
    }

class ApiKeyPayload(BaseModel):
    apiKey: str

@app.post("/api/settings")
def save_settings(
    payload: ApiKeyPayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    key = payload.apiKey.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is required")
        
    try:
        SessionManager.set_ai_api_key(session_id, key)
        info = SessionManager.get_ai_key_info(session_id)
        return {
            "success": True,
            "configured": True,
            "provider": info.get("provider"),
            "source": info.get("source"),
            "maskedKey": info.get("maskedKey")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/settings")
def clear_settings(session_id: str = Header(..., alias="x-prepsql-session-id")):
    SessionManager.clear_ai_api_key(session_id)
    info = SessionManager.get_ai_key_info(session_id)
    return {
        "success": True,
        "configured": info.get("configured", False),
        "source": info.get("source", "none"),
        "provider": info.get("provider"),
        "maskedKey": info.get("maskedKey")
    }


# --- 7. Mode Endpoints ---

@app.get("/api/mode")
def get_mode(session_id: str = Header(..., alias="x-prepsql-session-id")):
    mode = SessionManager.get_query_mode(session_id)
    return {"mode": mode}

class ModePayload(BaseModel):
    mode: str

@app.post("/api/mode")
def set_mode(
    payload: ModePayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    if payload.mode not in ('crud', 'analytics', 'schema'):
        raise HTTPException(status_code=400, detail="Invalid mode")
        
    if not SessionManager.get_connection(session_id):
        raise HTTPException(status_code=400, detail="No database connection")
        
    SessionManager.set_query_mode(session_id, payload.mode)
    return {"mode": payload.mode}


# --- 8. AI Analysis & Audit Endpoints ---

class AnalyzePayload(BaseModel):
    action: str
    sql: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None

@app.post("/api/analyze")
def run_ai_analysis(
    payload: AnalyzePayload,
    session_id: str = Header(..., alias="x-prepsql-session-id")
):
    connection = SessionManager.get_connection(session_id)
    if not connection:
        raise HTTPException(status_code=400, detail="No database connection")

    if payload.action == "query":
        if not payload.sql:
            raise HTTPException(status_code=400, detail="SQL query required")
            
        prompt = f"""You are a database performance analysis system. Analyze this SQL query:
Query: {payload.sql}
Dialect: {connection.get("type")}

Analyze potential bottlenecks (such as missing indexes, full table scans, SELECT *, partition limits, bad joins, etc.) and propose optimizations.

Return EXACTLY this JSON structure:
{{
  "rootCause": "Short diagnosis of bottleneck...",
  "impact": "High" | "Medium" | "Low",
  "optimizedQuery": "Fully formed SQL query or DDL statement (e.g. CREATE INDEX ...) to resolve this...",
  "isDdl": true, (true if optimizedQuery is a schema DDL index creation, false if it is a rewritten select/update query)
  "explanation": "Brief explanation of how this optimization works...",
  "estTimeBefore": 250, (estimated time in ms prior to fix)
  "estTimeAfter": 15, (estimated time in ms after fix)
  "estScannedBefore": 10000, (estimated rows scanned before)
  "estScannedAfter": 10 (estimated rows scanned after)
}}"""
        return generate_json_response(prompt, session_id)

    elif payload.action == "db":
        history = payload.history or []
        prompt = f"""You are a database health monitoring system. Analyze this connection type: "{connection.get("type")}" and this query execution history:
History: {json.dumps(history[:20])}

Provide an overall health audit. Estimate or formulate score metrics between 0 and 100.

Return EXACTLY this JSON structure:
{{
  "queryEfficiency": 80, (score 0-100)
  "indexCoverage": 75, (score 0-100)
  "schemaQuality": 85, (score 0-100)
  "overallScore": 80, (score 0-100)
  "recommendations": [
    "Point 1...",
    "Point 2...",
    "Point 3..."
  ]
}}"""
        return generate_json_response(prompt, session_id)
        
    raise HTTPException(status_code=400, detail="Invalid action")
