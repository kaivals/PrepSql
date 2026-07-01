// lib/agent/nodes/human-review.ts
// Uses LangGraph interrupt() to pause for user approval on mutation queries.
import { interrupt } from "@langchain/langgraph";
import type { AgentStateType } from "../state";

export function humanReviewNode(
  state: AgentStateType,
): Partial<AgentStateType> {
  // This call pauses graph execution and sends state to the client.
  // The API route catches the interrupt and returns pendingApproval: true.
  const decision = interrupt({
    question: `This query will ${state.mutationType} data. Do you want to proceed?`,
    sql: state.generatedSQL,
    mutationType: state.mutationType,
  });

  // When resumed, decision is either "approve" or "reject"
  if (decision === "reject") {
    return {
      humanApproved: false,
      finalResponse: {
        type: "answer",
        message: "Query execution cancelled by user.",
      },
    };
  }

  return { humanApproved: true };
}
