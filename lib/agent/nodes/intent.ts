import { ChatGroq } from "@langchain/groq";
import { SystemMessage } from "@langchain/core/messages";
import { getGroqApiKey } from "../../app-state";
import type { AgentStateType } from "../state";

const VALID_INTENTS = [
  "sql_retrieval",
  "sql_analytics",
  "sql_modification",
  "sql_schema",
  "boolean_check",
  "table_structure",
  "greeting",
  "clarify_needed",
  "out_of_scope",
] as const;

type ValidIntent = (typeof VALID_INTENTS)[number];

const SYSTEM_PROMPT = `You are an intent classifier for a SQL assistant.
Given the conversation history and the latest user message, classify the intent into exactly one of:
- sql_retrieval: User wants to fetch/list/show data (SELECT without aggregation)
- sql_analytics: User wants aggregation, counts, averages, group by, trends, top-N
- sql_modification: User wants to INSERT, UPDATE, DELETE, or UPSERT data
- sql_schema: User wants to CREATE, ALTER, DROP tables or query information_schema
- boolean_check: User asks a yes/no question
- table_structure: User wants to understand table columns, types, relationships
- greeting: Generic hello, thanks, small talk
- clarify_needed: Request is too vague to generate SQL without more info
- out_of_scope: Completely unrelated to databases or SQL

IMPORTANT: If the user says "update that query" or "add a filter" — that is a REFINEMENT of the previous SQL query.
Check conversation history: if the last assistant message had SQL, classify as the same intent type.

You must respond with a JSON object containing the intent label under the key "intent".
Example:
{
  "intent": "sql_retrieval"
}`;

export async function intentNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const apiKey = await getGroqApiKey();
  const llm = new ChatGroq({
    apiKey,
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    maxTokens: 40,
    maxRetries: 0,
  });

  // Take last 6 messages for context
  const recentMessages = state.messages.slice(-6);

  const response = await llm.invoke(
    [new SystemMessage(SYSTEM_PROMPT), ...recentMessages],
    {
      response_format: { type: "json_object" },
    },
  );

  // Parse and validate the intent from the raw response
  const rawResponse =
    typeof response.content === "string" ? response.content.trim() : "";

  let intent: AgentStateType["intent"] = "clarify_needed";

  try {
    const data = JSON.parse(rawResponse);
    if (VALID_INTENTS.includes(data.intent)) {
      intent = data.intent as ValidIntent;
    } else {
      console.warn(
        `[Intent Classifier] Classified intent "${data.intent}" is not in the list of valid intents. defaulting to clarify_needed.`,
      );
    }
  } catch (e) {
    console.warn(
      "[Intent Classifier] Failed to parse JSON response from LLM:",
      rawResponse,
      e,
    );
    // Fallback to substring matching if the response format is somehow not valid JSON
    const lowerRaw = rawResponse.toLowerCase();
    const found = VALID_INTENTS.find((i) => lowerRaw.includes(i));
    if (found) {
      intent = found;
    }
  }

  return { intent };
}
