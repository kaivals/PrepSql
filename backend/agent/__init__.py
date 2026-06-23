from typing import Dict, Any, Optional
from langchain_core.messages import HumanMessage
from langgraph.types import Command

from agent.graph import graph
from session import SessionManager

def run_agent(prompt: str, thread_id: str, action: Optional[str] = None) -> Dict[str, Any]:
    config = {
        "configurable": {
            "thread_id": thread_id,
        }
    }

    # If we are resuming from an interrupt (user decision: "approve" or "reject")
    if action:
        # Resume graph with user decision
        graph.invoke(Command(resume=action), config)
        
        state_val = graph.get_state(config)
        is_pending = len(state_val.next) > 0 and state_val.next[0] == 'human_review'
        
        if is_pending:
            return {
                "type": "pending_approval",
                "pendingApproval": True,
                "sql": state_val.values.get("generated_sql"),
                "explanation": state_val.values.get("explanation"),
                "isMutation": True,
                "mutationType": state_val.values.get("mutation_type"),
                "identifierCorrections": state_val.values.get("identifier_corrections", []),
                "unmatchedIdentifiers": state_val.values.get("unmatched_identifiers", [])
            }

        final_resp = state_val.values.get("final_response") or {}
        return {
            **final_resp,
            "pendingApproval": False
        }

    # Otherwise, start a new execution
    connection = SessionManager.get_connection(thread_id)
    if not connection:
        raise ValueError("No active database connection. Please connect to a database first.")

    initial_state = {
        "messages": [HumanMessage(content=prompt)],
        "user_prompt": prompt,
        "thread_id": thread_id,
        "db_dialect": connection.get("type"),
        "connection_id": connection.get("id"),
        "retry_count": 0,
        "error": None,
        "generated_sql": None,
        "explanation": None,
        "final_response": None,
        "is_mutation": False,
        "human_approved": None,
        "execution_result": None,
        "pending_clarification": None,
        "intent": None,
    }

    graph.invoke(initial_state, config)
    
    state_val = graph.get_state(config)
    is_pending = len(state_val.next) > 0 and state_val.next[0] == 'human_review'

    if is_pending:
        return {
            "type": "pending_approval",
            "pendingApproval": True,
            "sql": state_val.values.get("generated_sql"),
            "explanation": state_val.values.get("explanation"),
            "isMutation": True,
            "mutationType": state_val.values.get("mutation_type"),
            "identifierCorrections": state_val.values.get("identifier_corrections", []),
            "unmatchedIdentifiers": state_val.values.get("unmatched_identifiers", [])
        }

    final_resp = state_val.values.get("final_response") or {}
    return {
        **final_resp,
        "pendingApproval": False
    }
