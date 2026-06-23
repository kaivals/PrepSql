from langgraph.graph import StateGraph, END
from agent.state import AgentState
from agent.memory import checkpointer

# Import nodes
from agent.nodes.intent import intent_node
from agent.nodes.schema_load import schema_load_node
from agent.nodes.mutation_ambiguity_check import mutation_ambiguity_check_node
from agent.nodes.sql_generate import sql_generate_node
from agent.nodes.placeholder_detect import placeholder_detect_node
from agent.nodes.validate_and_safety import validate_and_safety_node
from agent.nodes.human_review import human_review_node
from agent.nodes.execute import execute_node
from agent.nodes.clarify import clarify_node
from agent.nodes.responder import responder_node
from agent.nodes.conversational import conversational_node

# --- Edge routing functions ---

def is_mutation_intent(intent: str) -> bool:
    return intent in ('sql_modification', 'sql_schema')

def route_by_intent(state: AgentState) -> str:
    if state.get("error"):
        return 'responder'
    
    if state.get("pending_clarification"):
        return 'clarify'

    intent = state.get("intent")
    if intent in ('greeting', 'out_of_scope'):
        return 'responder'
    elif intent == 'table_structure':
        return 'schema_load'
    elif intent == 'clarify_needed':
        return 'clarify'
    else:
        return 'schema_load'  # all SQL intents need schema

def route_after_schema(state: AgentState) -> str:
    if state.get("error"):
        return 'responder'
    if state.get("intent") == 'table_structure':
        return 'responder'
    if state.get("intent") == 'conversational':
        return 'conversational'
    if is_mutation_intent(state.get("intent")):
        return 'mutation_ambiguity_check'
    return 'sql_generate'

def route_after_mutation_check(state: AgentState) -> str:
    if state.get("pending_clarification"):
        return 'clarify'
    return 'sql_generate'

def route_after_generate(state: AgentState) -> str:
    if state.get("error"):
        return 'responder'
    if not state.get("generated_sql"):
        return 'responder'
    return 'placeholder_detect'

def route_after_placeholder_detect(state: AgentState) -> str:
    if state.get("pending_clarification"):
        return 'clarify'
    return 'validate_and_safety'

def route_after_validation(state: AgentState) -> str:
    final_resp = state.get("final_response")
    if final_resp and final_resp.get("type") == 'error':
        return 'responder'
    if state.get("is_mutation"):
        return 'human_review'
    return 'execute'

def route_after_review(state: AgentState) -> str:
    if state.get("human_approved") is False:
        return 'responder'
    return 'execute'

def route_after_execute(state: AgentState) -> str:
    if state.get("error") and state.get("retry_count", 0) <= 2:
        return 'sql_generate'
    return END

def route_after_clarify(state: AgentState) -> str:
    if state.get("pending_clarification") is None:
        return 'schema_load'
    return END

# --- Build graph ---

workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node('classify_intent', intent_node)
workflow.add_node('schema_load', schema_load_node)
workflow.add_node('mutation_ambiguity_check', mutation_ambiguity_check_node)
workflow.add_node('sql_generate', sql_generate_node)
workflow.add_node('placeholder_detect', placeholder_detect_node)
workflow.add_node('validate_and_safety', validate_and_safety_node)
workflow.add_node('human_review', human_review_node)
workflow.add_node('execute', execute_node)
workflow.add_node('clarify', clarify_node)
workflow.add_node('responder', responder_node)
workflow.add_node('conversational', conversational_node)

# Set starting edge
workflow.set_entry_point('classify_intent')

# Wire conditional edges
workflow.add_conditional_edges('classify_intent', route_by_intent)
workflow.add_conditional_edges('schema_load', route_after_schema)
workflow.add_conditional_edges('mutation_ambiguity_check', route_after_mutation_check)
workflow.add_conditional_edges('sql_generate', route_after_generate)
workflow.add_conditional_edges('placeholder_detect', route_after_placeholder_detect)
workflow.add_conditional_edges('validate_and_safety', route_after_validation)
workflow.add_conditional_edges('human_review', route_after_review)
workflow.add_conditional_edges('execute', route_after_execute)
workflow.add_conditional_edges('clarify', route_after_clarify)
workflow.add_edge('responder', END)
workflow.add_edge('conversational', END)

# Compile graph
graph = workflow.compile(checkpointer=checkpointer)
