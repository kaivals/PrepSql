from typing import Dict, Any
from langchain_core.messages import AIMessage, HumanMessage

def is_follow_up_answer(state: Dict[str, Any]) -> bool:
    pending = state.get("pending_clarification")
    if not pending:
        return False
        
    messages = state.get("messages", [])
    if not messages:
        return False
        
    # Check if the last message in state is a human message
    last_msg = messages[-1]
    if last_msg.type != 'human':
        return False
        
    question = pending.get("question", "")
    # Accept user's reply if the question is in the conversation history
    has_question_in_history = any(
        msg.type == 'ai' and question[:40] in str(msg.content)
        for msg in messages
    )
    has_any_ai = any(msg.type == 'ai' for msg in messages)
    
    return has_question_in_history or has_any_ai

def clarify_node(state: Dict[str, Any]) -> Dict[str, Any]:
    intent = state.get("intent")
    pending = state.get("pending_clarification")

    # Case 1: standard clarify_needed intent
    if intent == 'clarify_needed' and not pending:
        question = (
            "I need a bit more context to generate the right query. "
            "Could you clarify which table(s) you are interested in, and what result you are looking for?"
        )
        ai_message = AIMessage(content=question)
        return {
            "messages": [ai_message],
            "final_response": {
                "type": "clarification",
                "message": question,
                "question": question
            }
        }

    # Case 2: pending clarification from placeholder or mutation check
    if pending:
        question = pending.get("question")
        partial_sql = pending.get("partialSQL")
        missing_fields = pending.get("missingFields", [])

        # On the next turn, check if the user has provided the follow-up answer
        if is_follow_up_answer(state):
            missing_fields_str = ", ".join(missing_fields)
            
            if partial_sql:
                content = (
                    f"Previous partial query had placeholders for: {missing_fields_str}.\n\n"
                    f"User provided: \"{state.get('user_prompt')}\"\n\n"
                    f"Resume from this partial SQL, replace placeholders with the user-provided values:\n"
                    f"```sql\n{partial_sql}\n```"
                )
            else:
                content = (
                    f"Previous partial query was ambiguous. User provided: \"{state.get('user_prompt')}\".\n\n"
                    f"Now generate the complete SQL with the provided values."
                )

            resume_context = HumanMessage(content=content)
            resumed_from_mutation_ambiguity = pending.get("reason") == "mutation_ambiguity"

            return {
                "messages": [resume_context],
                "pending_clarification": None,
                "generated_sql": "",
                "final_response": None,
                "skip_mutation_ambiguity_check": resumed_from_mutation_ambiguity
            }

        # Still waiting for the answer — output the question again
        ai_message = AIMessage(content=question)
        return {
            "messages": [ai_message],
            "final_response": {
                "type": "clarification",
                "message": question,
                "question": question
            }
        }

    return {}
