from typing import Dict, Any
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_groq import ChatGroq
from langchain_anthropic import ChatAnthropic

from session import SessionManager

SYSTEM_PROMPT_TEMPLATE = """You are a helpful database assistant for PrepSQL.
You can answer questions about the database schema, SQL queries, database concepts, or previous query results.

The user is looking at a connected {db_dialect} database.
Here is the Database Schema (it is the ONLY database schema that exists):
{schema_formatted}

Review the conversation history, which includes previous queries and samples of their execution results.
Answer the user's question conversationally and clearly.
- If they ask about previous query results, refer to the sample execution results in the history.
- If they ask for explanations of SQL queries, explain the queries and how they work.
- If they ask general database questions, answer them accurately.
- Keep your answers concise, clear, and focused on the database.
"""

def conversational_node(state: Dict[str, Any]) -> Dict[str, Any]:
    session_id = state.get("thread_id")
    key_info = SessionManager.get_ai_api_key(session_id)
    
    if not key_info:
        return {
            "error": "AI API Key not configured",
            "final_response": {
                "type": "error",
                "message": "AI API Key not configured. Add a Groq or Anthropic key in Settings."
            }
        }

    provider, api_key = key_info
    db_dialect = state.get("db_dialect", "sqlite")
    schema_formatted = state.get("schema_formatted") or "No schema loaded."
    
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        db_dialect=db_dialect,
        schema_formatted=schema_formatted
    )

    try:
        if provider == "openrouter":
            from langchain_openai import ChatOpenAI
            from config import OPENROUTER_MODEL
            llm = ChatOpenAI(
                openai_api_key=api_key,
                openai_api_base="https://openrouter.ai/api/v1",
                model=OPENROUTER_MODEL,
                temperature=0.3,
                max_tokens=4096,
                max_retries=0,
                default_headers={
                    "HTTP-Referer": "https://github.com/kaivals/PrepSql",
                    "X-Title": "PrepSql"
                }
            )
        elif provider == "groq":
            llm = ChatGroq(
                api_key=api_key,
                model="llama-3.3-70b-versatile",
                temperature=0.3,
                max_tokens=1024,
                max_retries=0
            )
        else:
            llm = ChatAnthropic(
                api_key=api_key,
                model="claude-3-5-sonnet-20241022",
                temperature=0.3,
                max_tokens=1024,
                max_retries=0
            )

        # Slice to get previous conversation history, excluding current message
        history_messages = state.get("messages", [])[:-1][-7:]
        current_prompt = state.get("user_prompt", "")

        messages = [
            SystemMessage(content=system_prompt)
        ] + history_messages + [
            HumanMessage(content=current_prompt)
        ]

        response = llm.invoke(messages)
        content = response.content.strip() if isinstance(response.content, str) else str(response.content)

        ai_message = AIMessage(content=content)

        return {
            "messages": [ai_message],
            "error": None,
            "final_response": {
                "type": "answer",
                "message": content
            }
        }
    except Exception as err:
        err_msg = str(err)
        return {
            "error": err_msg,
            "final_response": {
                "type": "error",
                "message": f"Conversational response generation failed: {err_msg}"
            }
        }
