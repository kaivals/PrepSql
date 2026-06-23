from typing import Dict, Any
from langgraph.types import interrupt

def human_review_node(state: Dict[str, Any]) -> Dict[str, Any]:
    # Pauses graph execution and sends details to the client
    # The API endpoint will catch the interrupt and return a pending approval state
    decision = interrupt({
        "question": f"This query will {state.get('mutation_type')} data. Do you want to proceed?",
        "sql": state.get("generated_sql"),
        "mutationType": state.get("mutation_type")
    })

    if decision == 'reject':
        return {
            "human_approved": False,
            "final_response": {
                "type": "answer",
                "message": "Query execution cancelled by user."
            }
        }

    return {"human_approved": True}
