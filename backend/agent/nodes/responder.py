from typing import Dict, Any
from langchain_core.messages import AIMessage

def responder_node(state: Dict[str, Any]) -> Dict[str, Any]:
    error = state.get("error")
    final_resp = state.get("final_response")
    intent = state.get("intent")

    # If there's an error and no finalResponse already set, surface it
    if error and not final_resp:
        ai_message = AIMessage(content=f"Error: {error}")
        return {
            "messages": [ai_message],
            "final_response": {
                "type": "error",
                "message": error
            }
        }

    if intent == 'greeting':
        msg = "Hi! I'm your SQL assistant. Ask me to query your database, explore your tables, or modify data."
        ai_message = AIMessage(content=msg)
        return {
            "messages": [ai_message],
            "final_response": {
                "type": "greeting",
                "message": msg
            }
        }

    if intent == 'out_of_scope':
        msg = "I'm focused on database queries. I can help you fetch, analyze, or modify data in your connected database."
        ai_message = AIMessage(content=msg)
        return {
            "messages": [ai_message],
            "final_response": {
                "type": "answer",
                "message": msg
            }
        }

    if intent == 'table_structure':
        msg = state.get("schema_formatted") or "No schema information available."
        ai_message = AIMessage(content=f"Table Structure:\n{msg}")
        return {
            "messages": [ai_message],
            "final_response": {
                "type": "schema_info",
                "message": msg
            }
        }

    # Fallback — if finalResponse was already set by an earlier node, pass through
    if final_resp:
        msg_text = final_resp.get("message") or final_resp.get("explanation") or ""
        ai_message = AIMessage(content=msg_text)
        return {
            "messages": [ai_message]
        }

    default_msg = "Something unexpected happened. Please try again."
    return {
        "messages": [AIMessage(content=default_msg)],
        "final_response": {
            "type": "error",
            "message": default_msg
        }
    }
