from typing import Dict, Any, Literal
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_groq import ChatGroq
from langchain_anthropic import ChatAnthropic

from session import SessionManager

class IntentResponse(BaseModel):
    intent: Literal[
        'sql_retrieval',
        'sql_analytics',
        'sql_modification',
        'sql_schema',
        'boolean_check',
        'table_structure',
        'greeting',
        'clarify_needed',
        'conversational',
        'out_of_scope'
    ] = Field(description="The classified intent of the user prompt.")

SYSTEM_PROMPT = """You are an intent classifier for a SQL assistant.
Given the conversation history and the latest user message, classify the intent into exactly one of:
- sql_retrieval: User wants to fetch/list/show data (SELECT without aggregation). This includes direct questions asking for specific database entities or lists (e.g., 'Who is the CEO?', 'List the engineering employees', 'What projects are active?').
- sql_analytics: User wants aggregation, counts, averages, group by, trends, top-N
- sql_modification: User wants to INSERT, UPDATE, DELETE, or UPSERT data
- sql_schema: User wants to CREATE, ALTER, DROP tables or query information_schema
- boolean_check: User asks a yes/no question
- table_structure: User wants to understand table columns, types, relationships
- greeting: Generic hello, thanks, small talk
- clarify_needed: Request is too vague to generate SQL without more info
- conversational: User asks general database questions, asks to explain previous SQL/results, or wants to talk about the data (e.g. "what is the average salary of sales department in those results?", "explain that last query"). Do NOT use this if the user is asking to find or list specific information from the database (like "Who is the CEO?") — those must be sql_retrieval.
- out_of_scope: Completely unrelated to databases or SQL

IMPORTANT: If the user says "update that query" or "add a filter" — that is a REFINEMENT of the previous SQL query.
Check conversation history: if the last assistant message had SQL, classify as the same intent type.
"""

def intent_node(state: Dict[str, Any]) -> Dict[str, Any]:
    session_id = state.get("thread_id")
    key_info = SessionManager.get_ai_api_key(session_id)
    if not key_info:
        return {"error": "AI API Key not configured", "intent": "clarify_needed"}
        
    provider, api_key = key_info
    
    try:
        if provider == "openrouter":
            from langchain_openai import ChatOpenAI
            from config import OPENROUTER_MODEL
            llm = ChatOpenAI(
                openai_api_key=api_key,
                openai_api_base="https://openrouter.ai/api/v1",
                model=OPENROUTER_MODEL,
                temperature=0,
                max_tokens=1024,
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
                temperature=0,
                max_tokens=100,
                max_retries=0
            )
        else:
            llm = ChatAnthropic(
                api_key=api_key,
                model="claude-3-5-sonnet-20241022",
                temperature=0,
                max_tokens=100,
                max_retries=0
            )

        if provider == "openrouter":
            structured_llm = llm.with_structured_output(IntentResponse, method="json_mode")
        else:
            structured_llm = llm.with_structured_output(IntentResponse)

        # Take last 6 messages
        recent_messages = state.get("messages", [])[-6:]
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + recent_messages

        try:
            result = structured_llm.invoke(messages)
            intent_val = result.intent
        except Exception as parse_err:
            print(f"[Intent Classifier] Structured output failed, falling back to raw parser: {parse_err}")
            fallback_prompt = (
                "Review the conversation history and the latest message. "
                "Respond ONLY with one of the following intent names, and nothing else (no punctuation, no explanation, no markdown):\n"
                "- sql_retrieval\n- sql_analytics\n- sql_modification\n- sql_schema\n- boolean_check\n- table_structure\n- greeting\n- clarify_needed\n- conversational\n- out_of_scope\n\n"
                "Response: "
            )
            fallback_messages = messages[:-1] + [
                HumanMessage(content=messages[-1].content + "\n\n" + fallback_prompt)
            ]
            response = llm.invoke(fallback_messages)
            raw_text = response.content.strip().lower()
            
            # Map raw text to one of the intents
            intent_val = 'conversational'  # default fallback
            possible_intents = [
                'sql_retrieval', 'sql_analytics', 'sql_modification', 'sql_schema',
                'boolean_check', 'table_structure', 'greeting', 'clarify_needed',
                'conversational', 'out_of_scope'
            ]
            for val in possible_intents:
                if val in raw_text:
                    intent_val = val
                    break
        
        return {"intent": intent_val, "error": None}

    except Exception as e:
        print(f"[Intent Classifier] LLM execution or parsing failed: {e}")
        # Fallback to general classification and record error
        return {"intent": "clarify_needed", "error": f"LLM error: {e}"}
