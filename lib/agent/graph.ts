import { StateGraph, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { checkpointer } from "./memory";

import { intentNode } from "./nodes/intent";
import { schemaLoadNode } from "./nodes/schema-load";
import { mutationAmbiguityCheckNode } from "./nodes/mutation_ambiguity_check";
import { sqlGenerateNode } from "./nodes/sql-generate";
import { placeholderDetectNode } from "./nodes/placeholder_detect";
import { validateAndSafetyNode } from "./nodes/validate_and_safety";
import { humanReviewNode } from "./nodes/human-review";
import { executeNode } from "./nodes/execute";
import { clarifyNode } from "./nodes/clarify";
import { responderNode } from "./nodes/responder";

// --- Edge routing functions ---

function isMutationIntent(intent: string): boolean {
  return intent === "sql_modification" || intent === "sql_schema";
}

function routeByIntent(state: AgentStateType): string {
  if (state.error) return "responder";

  // If there is a pending clarification, we MUST route to clarify node to handle the resume/response
  if (state.pendingClarification) {
    return "clarify";
  }

  switch (state.intent) {
    case "greeting":
    case "out_of_scope":
      return "responder";
    case "table_structure":
      return "schema_load";
    case "clarify_needed":
      return "clarify";
    default:
      return "schema_load"; // all SQL intents need schema
  }
}

function routeAfterSchema(state: AgentStateType): string {
  if (state.error) return "responder";
  if (state.intent === "table_structure") return "responder";
  if (isMutationIntent(state.intent)) return "mutation_ambiguity_check";
  return "sql_generate";
}

function routeAfterMutationCheck(state: AgentStateType): string {
  if (state.pendingClarification) return "clarify";
  return "sql_generate";
}

function routeAfterGenerate(state: AgentStateType): string {
  if (state.error) return "responder";
  if (!state.generatedSQL) return "responder";
  return "placeholder_detect";
}

function routeAfterPlaceholderDetect(state: AgentStateType): string {
  if (state.pendingClarification) return "clarify";
  return "validate_and_safety";
}

function routeAfterValidation(state: AgentStateType): string {
  if (state.finalResponse?.type === "error") return "responder";
  if (state.isMutation) return "human_review";
  return "execute";
}

function routeAfterReview(state: AgentStateType): string {
  if (state.humanApproved === false) return "responder";
  return "execute";
}

function routeAfterExecute(state: AgentStateType): string {
  // Retry on execution error (max 2 retries)
  if (state.error && state.retryCount <= 2) {
    return "sql_generate";
  }
  return END;
}

function routeAfterClarify(state: AgentStateType): string {
  if (state.pendingClarification === null) {
    return "schema_load";
  }
  return END;
}

// --- Build graph ---

const workflow = new StateGraph(AgentState)
  .addNode("classify_intent", intentNode)
  .addNode("schema_load", schemaLoadNode)
  .addNode("mutation_ambiguity_check", mutationAmbiguityCheckNode)
  .addNode("sql_generate", sqlGenerateNode)
  .addNode("placeholder_detect", placeholderDetectNode)
  .addNode("validate_and_safety", validateAndSafetyNode)
  .addNode("human_review", humanReviewNode)
  .addNode("execute", executeNode)
  .addNode("clarify", clarifyNode)
  .addNode("responder", responderNode)

  .addEdge("__start__", "classify_intent")
  .addConditionalEdges("classify_intent", routeByIntent)
  .addConditionalEdges("schema_load", routeAfterSchema)
  .addConditionalEdges("mutation_ambiguity_check", routeAfterMutationCheck)
  .addConditionalEdges("sql_generate", routeAfterGenerate)
  .addConditionalEdges("placeholder_detect", routeAfterPlaceholderDetect)
  .addConditionalEdges("validate_and_safety", routeAfterValidation)
  .addConditionalEdges("human_review", routeAfterReview)
  .addConditionalEdges("execute", routeAfterExecute)
  .addConditionalEdges("clarify", routeAfterClarify)
  .addEdge("responder", END);

export const graph = workflow.compile({ checkpointer });
