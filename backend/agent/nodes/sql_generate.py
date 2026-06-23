import re
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_groq import ChatGroq
from langchain_anthropic import ChatAnthropic

from session import SessionManager
from agent.prompts.system import build_system_prompt
from agent.prompts.few_shot import get_few_shot_examples

class SQLGenerationResponse(BaseModel):
    sql: Optional[str] = Field(default=None, description="The generated SQL query. Set to None or empty if you cannot generate it, if the request is out of scope, or if tables/columns don't exist.")
    explanation: str = Field(description="A brief 1-3 sentence explanation of the query, or a plain English response explaining why the query could not be generated (listing available tables if a table doesn't exist).")

def sql_generate_node(state: Dict[str, Any]) -> Dict[str, Any]:
    # Skip if schema introspection failed
    if state.get("error") and not state.get("retry_count"):
        return {}

    session_id = state.get("thread_id")
    query_mode = SessionManager.get_query_mode(session_id)
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
    
    try:
        if provider == "openrouter":
            from langchain_openai import ChatOpenAI
            from config import OPENROUTER_MODEL
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
        elif provider == "groq":
            llm = ChatGroq(
                api_key=api_key,
                model="llama-3.3-70b-versatile",
                temperature=0.1,
                max_tokens=1024,
                max_retries=0
            )
        else:
            llm = ChatAnthropic(
                api_key=api_key,
                model="claude-3-5-sonnet-20241022",
                temperature=0.1,
                max_tokens=1024,
                max_retries=0
            )

        if provider == "openrouter":
            structured_llm = llm.with_structured_output(SQLGenerationResponse, method="json_mode")
        else:
            structured_llm = llm.with_structured_output(SQLGenerationResponse)

        system_prompt = build_system_prompt(
            db_dialect=state.get("db_dialect", "sqlite"),
            schema_formatted=state.get("schema_formatted", ""),
            intent=state.get("intent", "sql_retrieval"),
            query_mode=query_mode
        )

        few_shots = get_few_shot_examples(state.get("intent", ""), state.get("db_dialect", ""))

        # Last 7 previous messages (excluding the current user message at the end)
        history_messages = state.get("messages", [])[:-1][-7:]

        current_prompt = state.get("user_prompt", "")
        retry_count = state.get("retry_count", 0)
        if retry_count > 0:
            human_msg_content = (
                f"The previous SQL failed with error: \"{state.get('error')}\"\n"
                f"Original SQL:\n```sql\n{state.get('last_failed_sql')}\n```\n\n"
                f"Please fix the SQL. User's original request: {current_prompt}"
            )
        else:
            human_msg_content = current_prompt

        messages = [
            SystemMessage(content=system_prompt)
        ] + few_shots + history_messages + [
            HumanMessage(content=human_msg_content)
        ]

        try:
            result = structured_llm.invoke(messages)
            generated_sql = result.sql.strip() if result.sql else ""
            explanation = result.explanation.strip() if result.explanation else ""
        except Exception as parse_err:
            print(f"[SQL Generator] Structured output failed, falling back to text parsing: {parse_err}")
            fallback_system_prompt = system_prompt + "\n\nYou MUST respond in a JSON format matching this schema:\n{\n  \"sql\": \"SELECT ...\",\n  \"explanation\": \"...\"\n}\nDo NOT wrap the response in markdown blocks (no ```json). Respond only with this JSON."
            fallback_messages = [
                SystemMessage(content=fallback_system_prompt)
            ] + few_shots + history_messages + [
                HumanMessage(content=human_msg_content)
            ]
            response = llm.invoke(fallback_messages)
            raw_content = response.content.strip()
            
            try:
                import re
                import json
                json_match = re.search(r'\{[\s\S]*\}', raw_content)
                if json_match:
                    parsed = json.loads(json_match.group(0))
                    generated_sql = (parsed.get("sql") or "").strip()
                    explanation = (parsed.get("explanation") or "").strip()
                else:
                    # If not a JSON object, check for SQL block
                    sql_match = re.search(r'```sql\s*([\s\S]*?)\s*```', raw_content, re.IGNORECASE)
                    generated_sql = sql_match.group(1).strip() if sql_match else ""
                    explanation = raw_content.replace(f"```sql{generated_sql}```", "").strip()
            except Exception as json_err:
                print(f"[SQL Generator] Fallback parsing failed: {json_err}")
                generated_sql = ""
                explanation = raw_content

        if not generated_sql:
            return {
                "error": None,
                "final_response": {
                    "type": "answer",
                    "message": explanation or "Could not generate SQL from your request. Try being more specific."
                }
            }

        return {
            "generated_sql": generated_sql,
            "explanation": explanation,
            "error": None,
            "final_response": {
                "type": "sql",
                "sql": generated_sql,
                "explanation": explanation
            }
        }
    except Exception as err:
        err_msg = str(err)
        return {
            "error": err_msg,
            "final_response": {
                "type": "error",
                "message": f"SQL generation failed: {err_msg}"
            }
        }
