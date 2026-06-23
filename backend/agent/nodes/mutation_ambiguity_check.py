import re
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_groq import ChatGroq
from langchain_anthropic import ChatAnthropic

from session import SessionManager
from agent.mutation_target_identification import (
    build_conversation_context,
    infer_target_table,
    identifiers_from_execution_result,
    extract_target_identifiers,
    verify_unique_target
)

class MutationAmbiguityResponse(BaseModel):
    sufficient: bool = Field(description="True if there is sufficient information to target the mutation, False otherwise.")
    question: Optional[str] = Field(default=None, description="The exact question to ask the user if sufficient is False.")
    missing: List[str] = Field(default_factory=list, description="List of missing fields needed to uniquely identify the target rows.")

def is_mutation_intent(intent: str) -> bool:
    return intent in ('sql_modification', 'sql_schema')

def is_intentional_bulk_mutation(context: str) -> bool:
    return bool(re.search(r'\b(all|every)\s+(employees?|users?|rows?|records?|entries)\b', context, re.IGNORECASE)) \
        or bool(re.search(r'\bupdate\s+all\b', context, re.IGNORECASE)) \
        or bool(re.search(r'\bdelete\s+all\b', context, re.IGNORECASE))

def has_sufficient_target_identification(state: Dict[str, Any], connection: Dict[str, Any]) -> bool:
    context = build_conversation_context(state.get("user_prompt", ""), state.get("messages", []))
    table_hint = infer_target_table(context, state.get("schema_info"))

    if is_intentional_bulk_mutation(context):
        return True

    from_result = identifiers_from_execution_result(
        state.get("execution_result"),
        state.get("schema_info"),
        table_hint
    )
    if from_result:
        verification = verify_unique_target(from_result, state.get("db_dialect", "sqlite"), connection)
        if verification and verification.get("unique"):
            return True

    extracted = extract_target_identifiers(context, state.get("schema_info"))
    if not extracted:
        return False

    verification = verify_unique_target(extracted, state.get("db_dialect", "sqlite"), connection)
    return bool(verification and verification.get("unique") is True)

def mutation_ambiguity_check_node(state: Dict[str, Any]) -> Dict[str, Any]:
    intent = state.get("intent")
    if not is_mutation_intent(intent):
        return {}

    if state.get("skip_mutation_ambiguity_check"):
        return {"skip_mutation_ambiguity_check": False}

    session_id = state.get("thread_id")
    connection = SessionManager.get_connection(session_id)
    if not connection:
        return {}

    if has_sufficient_target_identification(state, connection):
        return {}

    key_info = SessionManager.get_ai_api_key(session_id)
    if not key_info:
        return {"error": "AI API Key not configured"}
        
    provider, api_key = key_info
    
    try:
        if provider == "groq":
            llm = ChatGroq(
                api_key=api_key,
                model="llama-3.3-70b-versatile",
                temperature=0,
                max_tokens=200,
                max_retries=0
            )
        else:
            llm = ChatAnthropic(
                api_key=api_key,
                model="claude-3-5-sonnet-20241022",
                temperature=0,
                max_tokens=200,
                max_retries=0
            )

        structured_llm = llm.with_structured_output(MutationAmbiguityResponse)
        conversation_context = build_conversation_context(state.get("user_prompt", ""), state.get("messages", []))

        system_prompt = """
You are checking if a database mutation request has enough 
information to write a safe, unambiguous WHERE clause.

Rules:
- Consider the FULL conversation history, not just the latest message.
- If the user already identified a row earlier in the conversation, that counts.
- first_name AND last_name together ARE sufficient to identify a row when both are provided.
- id, email, or a full name (first + last) are sufficient unique identifiers.
- Only first_name alone (without last_name) is NOT sufficient when both columns exist.
- If a primary key is mentioned anywhere in the conversation, it IS sufficient.
- If updating/deleting ALL rows intentionally, it IS sufficient.
- Do NOT ask for id or email if first_name and last_name are already known.
- Ask at most one focused question for the smallest missing detail.
""".strip()

        user_message = f"""
Database schema summary:
{state.get("schema_formatted") or 'No schema available.'}

Full conversation:
{conversation_context}

Latest user request: "{state.get("user_prompt")}"

Is there enough information to safely identify the target row(s)?
""".strip()

        result = structured_llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message)
        ])

        if result.sufficient is False:
            question = result.question or 'Could you provide more specific criteria to target the rows for mutation?'
            return {
                "generated_sql": "",
                "pending_clarification": {
                    "reason": "mutation_ambiguity",
                    "missingFields": result.missing or [],
                    "partialSQL": "",
                    "question": question
                },
                "final_response": {
                    "type": "clarification",
                    "message": question
                }
            }
    except Exception as error:
        print(f"[Mutation Ambiguity Check] Error: {error}")

    return {}
