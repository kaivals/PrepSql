# PrepSQL — LangGraph Text-to-SQL Agent: Architecture & Implementation Plan

> **Target stack:** Next.js 14+ · TypeScript · LangGraph.js v1.4.x · LangChain.js v1.x · `@langchain/groq` · existing `pg` / `mysql2` / `node:sqlite` drivers
>
> **Goal:** Replace the current linear 5-stage pipeline in `lib/claude.ts` with a stateful, intent-aware LangGraph agent that supports multi-turn conversation memory, human-in-the-loop execution approval, structured error recovery, and modular node design that is easy to extend or migrate.

---

## Package Versions (pin these in `package.json`)

```json
{
  "@langchain/langgraph": "^1.4.1",
  "@langchain/core": "^0.3.x",
  "langchain": "^1.x",
  "@langchain/groq": "^0.2.x",
  "zod": "^3.x"
}
```

> **Important:** `@langchain/langgraph` 1.x dropped `createReactAgent` from `langgraph/prebuilt` — use `createReactAgent` from `"langchain"` instead (LangChain 1.0 re-export). Always import `StateGraph`, `Annotation`, `interrupt`, `MemorySaver` from `"@langchain/langgraph"` directly.

---

## 1. New Directory Structure

Add a new `lib/agent/` folder. Existing files (`lib/schema.ts`, `lib/database.ts`, `lib/sql-validator.ts`, `lib/schema-format.ts`) are **reused as-is** — the agent calls them as utility functions, so no rewrite needed there.

```text
lib/
├── agent/
│   ├── graph.ts              ← StateGraph definition, node wiring, edge routing
│   ├── state.ts              ← AgentState type (Annotation schema)
│   ├── nodes/
│   │   ├── intent.ts         ← Intent classification node
│   │   ├── schema-load.ts    ← Schema introspection node (wraps lib/schema.ts)
│   │   ├── sql-generate.ts   ← SQL generation node (LLM call + few-shot)
│   │   ├── sql-validate.ts   ← Post-generation casing fix (wraps lib/sql-validator.ts)
│   │   ├── safety-check.ts   ← Regex-based mutation detector
│   │   ├── human-review.ts   ← interrupt() checkpoint for mutation queries
│   │   ├── execute.ts        ← Query execution tool (wraps lib/database.ts)
│   │   ├── clarify.ts        ← Returns a clarifying question to the user
│   │   └── responder.ts      ← Final response formatter
│   ├── tools/
│   │   └── db-execute.ts     ← LangChain tool wrapping multi-dialect DB execution
│   ├── prompts/
│   │   ├── system.ts         ← Dynamic system prompt builder
│   │   └── few-shot.ts       ← Few-shot example bank per intent
│   ├── memory.ts             ← MemorySaver / checkpointer setup
│   └── index.ts              ← Public export: runAgent(input, config)
└── ... (existing files unchanged)
```

The existing `app/api/generate/route.ts` is updated to call `runAgent()` instead of the old pipeline. The `app/api/execute/route.ts` can remain or be folded into the agent's human-review flow.

---

## 2. Agent State

```typescript
// lib/agent/state.ts
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { SchemaInfo } from "../types";

export const AgentState = Annotation.Root({
  // --- Conversation memory (append-only reducer) ---
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // --- Current turn inputs ---
  userPrompt: Annotation<string>({ default: () => "" }),
  threadId: Annotation<string>({ default: () => "" }),
  dbDialect: Annotation<"postgresql" | "mysql" | "mariadb" | "sqlite">({
    default: () => "postgresql",
  }),

  // --- Schema (loaded once per turn, cached in memory) ---
  schemaInfo: Annotation<SchemaInfo | null>({ default: () => null }),
  schemaFormatted: Annotation<string>({ default: () => "" }),

  // --- Intent classification ---
  intent: Annotation<
    | "sql_retrieval"      // SELECT — fetch data
    | "sql_analytics"     // SELECT + GROUP BY / aggregates / window functions
    | "sql_modification"  // INSERT / UPDATE / DELETE
    | "sql_schema"        // DDL / information_schema queries
    | "boolean_check"     // EXISTS / COUNT — yes/no questions
    | "table_structure"   // User wants to understand schema
    | "greeting"          // Small talk, greeting
    | "clarify_needed"    // Ambiguous — agent must ask a question
    | "out_of_scope"      // Cannot handle
  >({ default: () => "clarify_needed" }),

  // --- SQL generation output ---
  generatedSQL: Annotation<string>({ default: () => "" }),
  explanation: Annotation<string>({ default: () => "" }),
  identifierCorrections: Annotation<string[]>({ default: () => [] }),
  unmatchedIdentifiers: Annotation<string[]>({ default: () => [] }),

  // --- Safety ---
  isMutation: Annotation<boolean>({ default: () => false }),
  mutationType: Annotation<string>({ default: () => "" }), // "DELETE" | "UPDATE" | etc.
  humanApproved: Annotation<boolean | null>({ default: () => null }),

  // --- Execution results ---
  executionResult: Annotation<{
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  } | null>({ default: () => null }),

  // --- Error handling ---
  error: Annotation<string | null>({ default: () => null }),
  retryCount: Annotation<number>({ default: () => 0 }),
  lastFailedSQL: Annotation<string>({ default: () => "" }),

  // --- Final response to surface to UI ---
  finalResponse: Annotation<{
    type: "sql" | "answer" | "clarification" | "schema_info" | "greeting" | "error";
    sql?: string;
    explanation?: string;
    result?: unknown;
    question?: string;
    message?: string;
    isMutation?: boolean;
    mutationType?: string;
    pendingApproval?: boolean;
    identifierCorrections?: string[];
    unmatchedIdentifiers?: string[];
    usage?: { promptTokens: number; completionTokens: number };
  } | null>({ default: () => null }),
});

export type AgentStateType = typeof AgentState.State;
```

---

## 3. Intent Classification Node

This is the **entry router**. The LLM classifies the user message into one of the intent categories, considering the conversation history in `messages` so that follow-up instructions ("update that query to also group by city") resolve correctly.

```typescript
// lib/agent/nodes/intent.ts
import { ChatGroq } from "@langchain/groq";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state";

const INTENT_SYSTEM = `You are an intent classifier for a SQL assistant.
Given the conversation history and the latest user message, classify the intent into exactly one of:
- sql_retrieval       : User wants to fetch/list/show data (SELECT without aggregation)
- sql_analytics       : User wants aggregation, counts, averages, group by, trends, top-N
- sql_modification    : User wants to INSERT, UPDATE, DELETE, or UPSERT data
- sql_schema          : User wants to CREATE, ALTER, DROP tables or query information_schema
- boolean_check       : User asks a yes/no question ("Does X exist?", "Are there any Y?", "Is Z out of stock?")
- table_structure     : User wants to understand table columns, types, relationships
- greeting            : Generic hello, thanks, small talk
- clarify_needed      : Request is too vague to generate SQL without more info
- out_of_scope        : Completely unrelated to databases or SQL

IMPORTANT: If the user says "update that query" or "add a filter" — that is a REFINEMENT of the previous SQL query.
Check conversation history: if the last assistant message had SQL, classify as the same intent type.

Respond with ONLY the intent label, no explanation.`;

export async function intentNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const llm = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    maxTokens: 20,
  });

  // Build conversation context — last 6 messages max to stay within token budget
  const recentHistory = state.messages.slice(-6);
  const historyText = recentHistory
    .map((m) => `${m._getType()}: ${m.content}`)
    .join("\n");

  const response = await llm.invoke([
    new SystemMessage(INTENT_SYSTEM),
    new HumanMessage(
      `Conversation history:\n${historyText}\n\nLatest user message: "${state.userPrompt}"\n\nClassify the intent:`
    ),
  ]);

  const raw = String(response.content).trim().toLowerCase().replace(/[^a-z_]/g, "");
  const validIntents = [
    "sql_retrieval", "sql_analytics", "sql_modification", "sql_schema",
    "boolean_check", "table_structure", "greeting", "clarify_needed", "out_of_scope",
  ];

  const intent = validIntents.includes(raw) ? raw : "clarify_needed";
  return { intent: intent as AgentStateType["intent"] };
}
```

---

## 4. Schema Load Node

Wraps the existing `lib/schema.ts` + `lib/schema-format.ts`. Adds caching so schema is not re-fetched on every turn within the same session.

```typescript
// lib/agent/nodes/schema-load.ts
import { introspectSchema } from "../../schema";          // existing
import { formatSchemaForPrompt } from "../../schema-format"; // existing
import type { AgentStateType } from "../state";

// Simple in-memory cache keyed by connection string (cleared on reconnect)
const schemaCache = new Map<string, { schemaInfo: unknown; formatted: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function schemaLoadNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Skip if already loaded this turn
  if (state.schemaInfo && state.schemaFormatted) {
    return {};
  }

  // intents that don't need schema
  const noSchemaNeeded = ["greeting", "out_of_scope", "clarify_needed"];
  if (noSchemaNeeded.includes(state.intent)) {
    return {};
  }

  try {
    const cacheKey = `${state.dbDialect}:${state.threadId}`;
    const cached = schemaCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { schemaInfo: cached.schemaInfo as AgentStateType["schemaInfo"], schemaFormatted: cached.formatted };
    }

    const schemaInfo = await introspectSchema(state.dbDialect);
    const schemaFormatted = formatSchemaForPrompt(schemaInfo, state.dbDialect);

    schemaCache.set(cacheKey, { schemaInfo, formatted: schemaFormatted, ts: Date.now() });
    return { schemaInfo, schemaFormatted };
  } catch (err) {
    return {
      error: `Schema introspection failed: ${(err as Error).message}. Check your database connection.`,
    };
  }
}
```

---

## 5. SQL Generation Node

This is the heart of the agent. Uses the full conversation history for context so follow-up refinements ("also group by region") work naturally. Uses few-shot examples per intent.

```typescript
// lib/agent/nodes/sql-generate.ts
import { ChatGroq } from "@langchain/groq";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildSystemPrompt } from "../prompts/system";
import { getFewShotExamples } from "../prompts/few-shot";
import type { AgentStateType } from "../state";

export async function sqlGenerateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (state.error) return {}; // skip if schema failed

  const llm = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0.1,        // low for deterministic SQL
    maxTokens: 1024,
    stop: ["```\n\n"],       // stop after code block ends
  });

  const systemPrompt = buildSystemPrompt({
    dialect: state.dbDialect,
    schemaFormatted: state.schemaFormatted,
    intent: state.intent,
    queryMode: "readonly",   // pass from session if needed
  });

  const fewShots = getFewShotExamples(state.intent, state.dbDialect);

  // Build the message list:
  // system → few-shot pairs → conversation history → current prompt
  const messages = [
    new SystemMessage(systemPrompt),
    ...fewShots,                          // HumanMessage / AIMessage pairs
    ...state.messages.slice(-8),          // last 4 turns (8 messages) for context
    new HumanMessage(
      state.retryCount > 0
        ? `The previous SQL failed with error: "${state.error}"\nOriginal SQL:\n\`\`\`sql\n${state.lastFailedSQL}\n\`\`\`\n\nPlease fix the SQL. User's original request: ${state.userPrompt}`
        : state.userPrompt
    ),
  ];

  const response = await llm.invoke(messages);
  const raw = String(response.content);

  // Extract SQL block
  const sqlMatch = raw.match(/```sql\s*([\s\S]*?)```/i);
  const generatedSQL = sqlMatch ? sqlMatch[1].trim() : "";

  // Extract explanation (text after the code block)
  const explanation = raw.replace(/```sql[\s\S]*?```/gi, "").trim();

  if (!generatedSQL) {
    return {
      error: "The model did not return a valid SQL block. Please rephrase your request.",
      finalResponse: {
        type: "error",
        message: "Could not generate SQL from your request. Try being more specific.",
      },
    };
  }

  // Track token usage from response metadata
  const usage = (response as unknown as { usage_metadata?: { input_tokens: number; output_tokens: number } })
    .usage_metadata;

  return {
    generatedSQL,
    explanation,
    error: null,
    finalResponse: {
      type: "sql",
      sql: generatedSQL,
      explanation,
      usage: usage
        ? { promptTokens: usage.input_tokens, completionTokens: usage.output_tokens }
        : undefined,
    },
  };
}
```

---

## 6. SQL Validation Node

Wraps the existing `lib/sql-validator.ts` unchanged. This is a pure post-processing step — no LLM call.

```typescript
// lib/agent/nodes/sql-validate.ts
import { validateAndCorrectSQL } from "../../sql-validator"; // existing
import type { AgentStateType } from "../state";

export async function sqlValidateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.generatedSQL || state.error) return {};

  const result = validateAndCorrectSQL(
    state.generatedSQL,
    state.schemaInfo!,
    state.dbDialect
  );

  return {
    generatedSQL: result.correctedSQL,
    identifierCorrections: result.corrections,
    unmatchedIdentifiers: result.unmatched,
    finalResponse: state.finalResponse
      ? {
          ...state.finalResponse,
          sql: result.correctedSQL,
          identifierCorrections: result.corrections,
          unmatchedIdentifiers: result.unmatched,
        }
      : null,
  };
}
```

---

## 7. Safety Check Node

Regex-based — no LLM call. Fast and deterministic. Returns `isMutation: true` with the mutation type so the edge router can divert to human-review.

```typescript
// lib/agent/nodes/safety-check.ts
import type { AgentStateType } from "../state";

// Covers single and multi-statement patterns
const MUTATION_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /\bDELETE\s+FROM\b/i,           type: "DELETE" },
  { regex: /\bUPDATE\s+\w/i,               type: "UPDATE" },
  { regex: /\bINSERT\s+INTO\b/i,           type: "INSERT" },
  { regex: /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)\b/i, type: "DROP" },
  { regex: /\bTRUNCATE\s+(TABLE\s+)?\w/i,  type: "TRUNCATE" },
  { regex: /\bALTER\s+TABLE\b/i,           type: "ALTER" },
  { regex: /\bCREATE\s+(TABLE|INDEX|VIEW|DATABASE)\b/i, type: "DDL" },
];

export function safetyCheckNode(state: AgentStateType): Partial<AgentStateType> {
  const sql = state.generatedSQL;
  if (!sql) return {};

  for (const { regex, type } of MUTATION_PATTERNS) {
    if (regex.test(sql)) {
      return {
        isMutation: true,
        mutationType: type,
        finalResponse: state.finalResponse
          ? { ...state.finalResponse, isMutation: true, mutationType: type, pendingApproval: true }
          : null,
      };
    }
  }

  return { isMutation: false, mutationType: "" };
}
```

---

## 8. Human Review Node (interrupt)

Uses LangGraph's `interrupt()` to **pause** the graph and wait for the user to approve or reject mutation queries. The UI receives `pendingApproval: true` in the response and shows a confirmation dialog. When the user approves, the frontend resumes the graph by calling the agent API with `{ approve: true }`.

```typescript
// lib/agent/nodes/human-review.ts
import { interrupt } from "@langchain/langgraph";
import type { AgentStateType } from "../state";

export function humanReviewNode(state: AgentStateType): Partial<AgentStateType> {
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
```

---

## 9. Execute Node

Wraps the existing multi-dialect DB execution from `lib/database.ts`.

```typescript
// lib/agent/nodes/execute.ts
import { executeQuery } from "../../database"; // existing pool-based execution
import type { AgentStateType } from "../state";

export async function executeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Skip if mutation was rejected
  if (state.isMutation && state.humanApproved === false) return {};
  if (!state.generatedSQL || state.error) return {};

  try {
    const result = await executeQuery(state.generatedSQL, state.dbDialect);

    return {
      executionResult: result,
      finalResponse: {
        ...state.finalResponse!,
        type: "sql",
        result,
      },
    };
  } catch (err) {
    const errMsg = (err as Error).message;

    // If within retry budget, signal re-generation
    if (state.retryCount < 2) {
      return {
        error: errMsg,
        lastFailedSQL: state.generatedSQL,
        retryCount: state.retryCount + 1,
        generatedSQL: "",
      };
    }

    // Exhausted retries — surface to user
    return {
      error: errMsg,
      finalResponse: {
        type: "error",
        message: `Query failed after ${state.retryCount + 1} attempts: ${errMsg}`,
        sql: state.generatedSQL,
      },
    };
  }
}
```

---

## 10. Clarify, Greeting, and Responder Nodes

```typescript
// lib/agent/nodes/clarify.ts
import type { AgentStateType } from "../state";

export function clarifyNode(state: AgentStateType): Partial<AgentStateType> {
  return {
    finalResponse: {
      type: "clarification",
      question:
        "I need a bit more context to generate the right query. Could you clarify: " +
        "which table(s) are you interested in, and what result are you looking for?",
    },
  };
}

// lib/agent/nodes/responder.ts  — table structure / greeting / out-of-scope
import { ChatGroq } from "@langchain/groq";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state";

export async function responderNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (state.intent === "greeting") {
    return {
      finalResponse: {
        type: "greeting",
        message:
          "Hi! I'm your SQL assistant. Ask me to query your database, explore your tables, or modify data.",
      },
    };
  }

  if (state.intent === "out_of_scope") {
    return {
      finalResponse: {
        type: "answer",
        message: "I'm focused on database queries. I can help you fetch, analyze, or modify data in your connected database.",
      },
    };
  }

  if (state.intent === "table_structure") {
    // Return formatted schema as human-readable text
    return {
      finalResponse: {
        type: "schema_info",
        message: state.schemaFormatted || "No schema information available.",
      },
    };
  }

  return {};
}
```

---

## 11. Few-Shot Prompt Examples

```typescript
// lib/agent/prompts/few-shot.ts
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state";

type FewShotPair = [HumanMessage, AIMessage];

const RETRIEVAL_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("Show me all customers from Mumbai"),
    new AIMessage(
      '```sql\nSELECT * FROM "customers" WHERE "city" = \'Mumbai\';\n```\nRetrieves all customers whose city is Mumbai.'
    ),
  ],
  [
    new HumanMessage("List the top 5 products by revenue"),
    new AIMessage(
      '```sql\nSELECT "productId", "name", SUM("price" * "quantity") AS revenue\nFROM "order_items"\nGROUP BY "productId", "name"\nORDER BY revenue DESC\nLIMIT 5;\n```\nJoins order items, sums up revenue per product, returns the top 5.'
    ),
  ],
];

const BOOLEAN_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("Does customer ID 42 exist?"),
    new AIMessage(
      '```sql\nSELECT EXISTS(SELECT 1 FROM "customers" WHERE "id" = 42) AS "exists";\n```\nReturns true if a customer with ID 42 exists.'
    ),
  ],
  [
    new HumanMessage("Are there any pending orders?"),
    new AIMessage(
      '```sql\nSELECT EXISTS(SELECT 1 FROM "orders" WHERE "status" = \'pending\') AS "hasPendingOrders";\n```\nReturns true/false whether pending orders exist.'
    ),
  ],
];

const ANALYTICS_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("What is the average order value per city this month?"),
    new AIMessage(
      '```sql\nSELECT c."city", ROUND(AVG(o."totalAmount"), 2) AS "avgOrderValue"\nFROM "orders" o\nJOIN "customers" c ON o."customerId" = c."id"\nWHERE DATE_TRUNC(\'month\', o."createdAt") = DATE_TRUNC(\'month\', CURRENT_DATE)\nGROUP BY c."city"\nORDER BY "avgOrderValue" DESC;\n```\nAggregates orders by city for the current month.'
    ),
  ],
];

export function getFewShotExamples(
  intent: AgentStateType["intent"],
  _dialect: AgentStateType["dbDialect"]
): (HumanMessage | AIMessage)[] {
  const map: Partial<Record<AgentStateType["intent"], FewShotPair[]>> = {
    sql_retrieval: RETRIEVAL_SHOTS,
    sql_analytics: ANALYTICS_SHOTS,
    boolean_check: BOOLEAN_SHOTS,
  };
  return (map[intent] ?? []).flat();
}
```

---

## 12. System Prompt Builder

```typescript
// lib/agent/prompts/system.ts
import type { AgentStateType } from "../state";

interface SystemPromptInput {
  dialect: AgentStateType["dbDialect"];
  schemaFormatted: string;
  intent: AgentStateType["intent"];
  queryMode: "readonly" | "crud" | "schema";
}

export function buildSystemPrompt({
  dialect,
  schemaFormatted,
  intent,
  queryMode,
}: SystemPromptInput): string {
  const dialectHints: Record<AgentStateType["dbDialect"], string> = {
    postgresql: `
- Use double-quotes for ALL table and column identifiers (e.g. "userId", "createdAt").
- Identifiers ARE case-sensitive in PostgreSQL. Copy them VERBATIM from the schema below.
- Use $1, $2 for parameterized queries if needed.
- Use ILIKE for case-insensitive string matching.
- Use DATE_TRUNC for date grouping.`,
    mysql: `
- Use backtick quoting for identifiers: \`tableName\`, \`columnName\`.
- Identifiers are case-insensitive but match schema casing in output.
- Use LIMIT/OFFSET for pagination.
- Use STR_TO_DATE for date parsing.`,
    mariadb: `
- Same rules as MySQL. Use backtick quoting for identifiers.`,
    sqlite: `
- Identifiers are case-insensitive. No special quoting needed unless names contain spaces.
- Use LIMIT/OFFSET for pagination.
- SQLite does not support RIGHT JOIN — use LEFT JOIN instead.
- Use strftime() for date operations.`,
  };

  const modeRules: Record<string, string> = {
    readonly: "You MUST only generate SELECT, SHOW, DESCRIBE, or EXPLAIN queries. Any mutation (INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER) is FORBIDDEN.",
    crud: "You may generate SELECT, INSERT, UPDATE, or DELETE queries. DDL (DROP/TRUNCATE/ALTER TABLE) is FORBIDDEN unless the user explicitly asks.",
    schema: "You may generate any SQL including DDL statements. Always confirm destructive operations.",
  };

  const intentHints: Partial<Record<AgentStateType["intent"], string>> = {
    sql_analytics:
      "Use JOINs across related tables. Apply GROUP BY with aggregates (SUM, COUNT, AVG, MAX, MIN). Use window functions (ROW_NUMBER, RANK, LAG) when rankings or running totals are needed. Always alias aggregated columns.",
    boolean_check:
      "Use EXISTS or SELECT COUNT(*) > 0 pattern. Never fetch all rows — use EXISTS(SELECT 1 ...) for efficiency.",
    sql_modification:
      "Generate precise WHERE clauses. Never update/delete without a WHERE clause unless the user explicitly requests all rows. Return the affected row count using RETURNING (PostgreSQL) or ROW_COUNT().",
    sql_schema:
      "Query information_schema or dialect-specific catalog tables. For PostgreSQL, use pg_catalog.",
    table_structure:
      "Generate a query that returns column names, types, and constraints for the requested table(s).",
  };

  return `You are an expert SQL assistant for a ${dialect} database.

## Rules
${dialectHints[dialect]}

## Query Mode
${modeRules[queryMode]}

## Intent-Specific Guidance
${intentHints[intent] ?? "Generate the most accurate and efficient SQL for the user's request."}

## General Best Practices
- Always use JOINs when data from multiple tables is needed. Prefer explicit JOIN ... ON over implicit comma joins.
- Add ORDER BY for deterministic results.
- Use subqueries or CTEs when the logic becomes complex (WITH cte AS ...).
- Never use SELECT * in production queries — select only needed columns.
- Use LIMIT to prevent accidental full-table scans unless the user asks for all rows.
- Consider table relationships from the schema (foreign keys) when joining.

## Output Format
Respond with:
1. A SQL code block: \`\`\`sql ... \`\`\`
2. A brief plain-English explanation (1-3 sentences) after the block.
Do NOT add any preamble before the code block.

## Database Schema
${schemaFormatted || "No schema loaded."}`;
}
```

---

## 13. Memory Setup

```typescript
// lib/agent/memory.ts
import { MemorySaver } from "@langchain/langgraph";

// MemorySaver is an in-process, in-memory checkpointer.
// For production, swap with PostgresSaver or RedisSaver:
//   import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
//   export const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
export const checkpointer = new MemorySaver();
```

Each user session gets a `thread_id` (e.g. `session.id` from `lib/session.ts`). Passing it via `config.configurable.thread_id` gives LangGraph the correct memory lane per user.

---

## 14. The Graph — Node Wiring & Edge Routing

```typescript
// lib/agent/graph.ts
import { StateGraph, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { checkpointer } from "./memory";

import { intentNode }      from "./nodes/intent";
import { schemaLoadNode }  from "./nodes/schema-load";
import { sqlGenerateNode } from "./nodes/sql-generate";
import { sqlValidateNode } from "./nodes/sql-validate";
import { safetyCheckNode } from "./nodes/safety-check";
import { humanReviewNode } from "./nodes/human-review";
import { executeNode }     from "./nodes/execute";
import { clarifyNode }     from "./nodes/clarify";
import { responderNode }   from "./nodes/responder";

// --- Edge routing functions ---

function routeByIntent(state: AgentStateType): string {
  if (state.error) return "responder";
  switch (state.intent) {
    case "greeting":
    case "out_of_scope":      return "responder";
    case "table_structure":   return "schema_load";
    case "clarify_needed":    return "clarify";
    default:                  return "schema_load"; // all SQL intents need schema
  }
}

function routeAfterSchema(state: AgentStateType): string {
  if (state.error) return "responder";
  if (state.intent === "table_structure") return "responder";
  return "sql_generate";
}

function routeAfterGenerate(state: AgentStateType): string {
  if (state.error) return "responder";
  if (!state.generatedSQL) return "responder";
  return "sql_validate";
}

function routeAfterSafety(state: AgentStateType): string {
  if (state.isMutation) return "human_review";
  return "execute";
}

function routeAfterReview(state: AgentStateType): string {
  if (state.humanApproved === false) return "responder";
  return "execute";
}

function routeAfterExecute(state: AgentStateType): string {
  // Retry on execution error (max 2 retries)
  if (state.error && state.retryCount > 0 && state.retryCount <= 2) {
    return "sql_generate";
  }
  return END;
}

// --- Build graph ---

const workflow = new StateGraph(AgentState)
  .addNode("intent",       intentNode)
  .addNode("schema_load",  schemaLoadNode)
  .addNode("sql_generate", sqlGenerateNode)
  .addNode("sql_validate", sqlValidateNode)
  .addNode("safety_check", safetyCheckNode)
  .addNode("human_review", humanReviewNode)
  .addNode("execute",      executeNode)
  .addNode("clarify",      clarifyNode)
  .addNode("responder",    responderNode)

  .addEdge("__start__",    "intent")
  .addConditionalEdges("intent",       routeByIntent)
  .addConditionalEdges("schema_load",  routeAfterSchema)
  .addConditionalEdges("sql_generate", routeAfterGenerate)
  .addEdge("sql_validate", "safety_check")
  .addConditionalEdges("safety_check", routeAfterSafety)
  .addConditionalEdges("human_review", routeAfterReview)
  .addConditionalEdges("execute",      routeAfterExecute)
  .addEdge("clarify",   END)
  .addEdge("responder", END);

export const graph = workflow.compile({ checkpointer });
```

---

## 15. Visual Graph Flow

```
User Message
    │
    ▼
[intent] ──────────────────────────────────────────────┐
    │                                                   │
    │ greeting / out_of_scope                           │ clarify_needed
    ▼                                                   ▼
[responder] ──► END                               [clarify] ──► END
    │
    │ table_structure / sql_*
    ▼
[schema_load]
    │
    │ table_structure
    ├──────────────► [responder] ──► END
    │
    │ sql_* intents
    ▼
[sql_generate]  ◄──────────────────────────────────────┐
    │                                                   │ retry (max 2x)
    │ no SQL / error                                    │
    ├──────► [responder] ──► END                        │
    │                                                   │
    ▼                                                   │
[sql_validate]                                          │
    │                                                   │
    ▼                                                   │
[safety_check]                                          │
    │                                                   │
    │ isMutation=true                                   │
    ├──────► [human_review]                             │
    │            │ approved                             │
    │            ▼                                      │
    │         [execute] ─── error ───────────────────►─┘
    │            │ success
    │            ▼
    │           END
    │
    │ isMutation=false
    └──────► [execute] ─── error ─────────────────────►─┘
                 │ success
                 ▼
                END
```

---

## 16. Public Entry Point

```typescript
// lib/agent/index.ts
import { graph } from "./graph";
import { HumanMessage } from "@langchain/core/messages";
import type { AgentStateType } from "./state";

export interface AgentInput {
  userPrompt: string;
  threadId: string;
  dbDialect: AgentStateType["dbDialect"];
  approve?: boolean;  // set to true when resuming after human-review interrupt
}

export async function runAgent(input: AgentInput) {
  const config = {
    configurable: { thread_id: input.threadId },
  };

  // If resuming from an interrupt (user approved mutation)
  if (input.approve !== undefined) {
    const result = await graph.invoke(
      // Pass Command to resume with the approve decision
      { type: "resume", data: input.approve ? "approve" : "reject" },
      config
    );
    return result.finalResponse;
  }

  const result = await graph.invoke(
    {
      userPrompt: input.userPrompt,
      threadId: input.threadId,
      dbDialect: input.dbDialect,
      messages: [new HumanMessage(input.userPrompt)],
    },
    config
  );

  return result.finalResponse;
}
```

---

## 17. API Route Update (`app/api/generate/route.ts`)

```typescript
// app/api/generate/route.ts  — replaces the old pipeline call
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { getSession } from "@/lib/session";
import type { AgentStateType } from "@/lib/agent/state";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { prompt, approve } = body;
    const session = await getSession();

    if (!session.connection) {
      return NextResponse.json({ error: "No database connection" }, { status: 400 });
    }

    const result = await runAgent({
      userPrompt: prompt,
      threadId: session.id,
      dbDialect: session.connection.dialect as AgentStateType["dbDialect"],
      approve,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[agent] unhandled error:", err);
    return NextResponse.json(
      { type: "error", message: "Internal agent error. Please try again." },
      { status: 500 }
    );
  }
}
```

---

## 18. Conversation Memory — How It Works

LangGraph's `MemorySaver` automatically persists `AgentState` (including `messages`) between requests that share the same `thread_id`. The `messages` array uses `messagesStateReducer` which **appends** each new HumanMessage and AIMessage.

The SQL generation node uses `state.messages.slice(-8)` — the last 4 turns — to give the LLM context about previous queries and refinements. This is effectively a **sliding window memory** approach:

- User asks: "Show me top 5 customers by revenue" → SQL generated, stored in messages.
- User asks: "Now filter that to only Mumbai" → Agent sees previous SQL in context, generates a refined version.
- User asks: "Update those customers' status to premium" → Intent = `sql_modification`, goes through human-review.

If the message history grows too large, you can swap the slice window or use LangChain's `TokenTextSplitter` to summarize older turns before passing them as context.

---

## 19. Error Handling Reference

| Failure point | What happens | User sees |
|---|---|---|
| Schema introspection fails | `error` set, graph routes to `responder` | "Schema introspection failed: [reason]. Check your connection." |
| LLM returns no SQL block | `error` set, routes to `responder` | "Could not generate SQL. Try being more specific." |
| LLM API error / timeout | Exception caught in `sqlGenerateNode`, `error` set | "Internal agent error. Please try again." |
| SQL execution fails, retry < 2 | `retryCount++`, routes back to `sql_generate` with error context | Transparent — user just gets corrected SQL |
| SQL execution fails, retry ≥ 2 | `finalResponse.type = "error"` | "Query failed after 3 attempts: [DB error message]. SQL: ..." |
| Intent not recognized | Falls to `clarify_needed` | "I need a bit more context..." |
| Mutation query, user rejects | `humanApproved = false`, routes to `responder` | "Query execution cancelled by user." |

---

## 20. Connection String Examples for Testing

```bash
# PostgreSQL (local)
postgresql://postgres:postgres@localhost:5432/mydb

# PostgreSQL (Supabase cloud)
postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres

# MySQL (local)
mysql://root:root@localhost:3306/mydb

# MySQL (PlanetScale cloud)
mysql://[user]:[password]@[host].connect.psdb.cloud/[db]?ssl={"rejectUnauthorized":true}

# MariaDB (local)
mariadb://root:root@localhost:3306/mydb

# SQLite (local file)
sqlite:./data/local.db

# SQLite (in-memory for testing)
sqlite::memory:
```

---

## 21. Migration Steps (from current pipeline to agent)

1. **Install packages**
   ```bash
   npm install @langchain/langgraph@^1.4.1 @langchain/core langchain @langchain/groq zod
   ```

2. **Create `lib/agent/` directory** and add all files from this plan.

3. **Keep existing files unchanged** — `lib/schema.ts`, `lib/schema-format.ts`, `lib/sql-validator.ts`, `lib/database.ts` are all imported by agent nodes as-is.

4. **Update `app/api/generate/route.ts`** to call `runAgent()` instead of the old pipeline.

5. **Update `app/api/execute/route.ts`** (optional) — execution is now handled inside the agent via the `execute` node. The separate execute endpoint can remain as a fallback for cases where the user manually edits SQL in the editor and clicks Run.

6. **Update the frontend** to handle the new `finalResponse` shape — specifically handle `pendingApproval: true` to show the mutation confirmation dialog, and `type: "clarification"` to render the question.

7. **Test the retry loop** — deliberately send a query that references a non-existent column to verify the agent retries with the error context.

8. **Test memory** — ask a query, then ask a follow-up like "filter the results to last week" to verify the previous SQL is in context.

---

## 22. Future Extensions (easy to add as new nodes)

- **`rate-limit` node** — check usage before LLM call, return friendly message if over quota.
- **`result-insight` node** — after execute, ask the LLM to summarize query results in plain English.
- **`query-optimizer` node** — add EXPLAIN ANALYZE parsing and suggest index improvements.
- **`multi-step` node** — for complex requests, split into sub-queries and chain results.
- **`long-term memory store`** — replace `MemorySaver` with `PostgresSaver` when you want memory to survive server restarts.
- **Structured output for LLM** — replace regex SQL extraction with `llm.withStructuredOutput(zodSchema)` for more reliable parsing.
