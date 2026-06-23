from typing import TypedDict, List, Dict, Any, Optional, Annotated
from langchain_core.messages import BaseMessage
from langgraph.graph import add_messages

class AgentState(TypedDict):
    # Conversation memory (append-only list using add_messages reducer)
    messages: Annotated[List[BaseMessage], add_messages]
    
    # Current turn inputs
    user_prompt: str
    thread_id: str
    db_dialect: str
    connection_id: str
    
    # Schema cached
    schema_info: Optional[List[Dict[str, Any]]]
    schema_formatted: str
    
    # Intent classification
    intent: str
    
    # SQL generation outputs
    generated_sql: str
    explanation: str
    identifier_corrections: List[str]
    unmatched_identifiers: List[str]
    
    # Safety
    is_mutation: bool
    mutation_type: str
    human_approved: Optional[bool]
    
    # Execution
    execution_result: Optional[Dict[str, Any]]
    
    # Error & retries
    error: Optional[str]
    retry_count: int
    last_failed_sql: str
    
    # Final responses and pending flags
    final_response: Optional[Dict[str, Any]]
    pending_clarification: Optional[Optional[Dict[str, Any]]]
    skip_mutation_ambiguity_check: bool
