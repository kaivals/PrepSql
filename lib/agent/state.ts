import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { DatabaseType, SchemaTable } from "../types";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  userPrompt: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  threadId: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  dbDialect: Annotation<DatabaseType>({
    reducer: (x, y) => y ?? x,
    default: () => "sqlite",
  }),
  connectionId: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  schemaInfo: Annotation<SchemaTable[] | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  schemaFormatted: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  intent: Annotation<
    | "sql_retrieval"
    | "sql_analytics"
    | "sql_modification"
    | "sql_schema"
    | "boolean_check"
    | "table_structure"
    | "greeting"
    | "clarify_needed"
    | "out_of_scope"
  >({
    reducer: (x, y) => y ?? x,
    default: () => "clarify_needed",
  }),
  generatedSQL: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  explanation: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  identifierCorrections: Annotation<string[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  unmatchedIdentifiers: Annotation<string[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  isMutation: Annotation<boolean>({
    reducer: (x, y) => y ?? x,
    default: () => false,
  }),
  mutationType: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  humanApproved: Annotation<boolean | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  executionResult: Annotation<{
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  } | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  retryCount: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),
  lastFailedSQL: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  finalResponse: Annotation<{
    type: string;
    sql?: string;
    explanation?: string;
    result?: any;
    question?: string;
    message?: string;
    isMutation?: boolean;
    mutationType?: string;
    pendingApproval?: boolean;
    identifierCorrections?: string[];
    unmatchedIdentifiers?: string[];
    usage?: any;
  } | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  pendingClarification: Annotation<{
    reason: "placeholder" | "mutation_ambiguity" | "missing_field";
    missingFields: string[];
    partialSQL: string; // SQL with placeholders, saved for resume
    question: string;
  } | null>({
    reducer: (x, y) => (y === undefined ? x : y),
    default: () => null,
  }),
  skipMutationAmbiguityCheck: Annotation<boolean>({
    reducer: (x, y) => y ?? x,
    default: () => false,
  }),
});

export type AgentStateType = typeof AgentState.State;
