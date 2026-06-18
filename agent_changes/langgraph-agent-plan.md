# LangGraph Text-to-SQL Agent Migration Walkthrough

We have successfully migrated the PrepSQL SQL generation pipeline from a linear structure to a stateful, intent-routing LangGraph agent using Groq's `llama-3.3-70b-versatile` LLM.

## Changes Made

### 1. Core Agent Infrastructure (`lib/agent/`)
- [state.ts](file:///home/jainam/Documents/PrepSql/lib/agent/state.ts): Created the LangGraph `AgentState` schema to model conversation memory, DB dialects, schema context, mutation flags, execution results, error status, and retry counts.
- [memory.ts](file:///home/jainam/Documents/PrepSql/lib/agent/memory.ts): Initialized an in-memory `MemorySaver` checkpointer to allow thread persistence.
- [graph.ts](file:///home/jainam/Documents/PrepSql/lib/agent/graph.ts): Configured the `StateGraph` wiring. Nodes are conditionally executed based on the user's intent. Renamed the `'intent'` node name to `'classify_intent'` to resolve conflicts with the state attribute of the same name.
- [index.ts](file:///home/jainam/Documents/PrepSql/lib/agent/index.ts): Exposed the `runAgent()` entry point. It uses the `__interrupt__` property on the execution state to identify human-in-the-loop approvals.

### 2. Node Implementations (`lib/agent/nodes/` & `lib/agent/prompts/`)
- [classify_intent](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/intent.ts): LLM intent classifier (greeting, analytics, clarify, retrieval, out-of-scope, etc.).
- [schema_load](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/schema-load.ts): Introspects DB schema and formats it for prompts. Includes a 5-minute cache.
- [sql_generate](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/sql-generate.ts): Calls the Groq LLM with few-shots and schema context to write the SQL.
- [sql_validate](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/sql-validate.ts): Fixes database-specific casing and quoting issues.
- [safety_check](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/safety-check.ts): Regex-based mutation detector.
- [human_review](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/human-review.ts): Suspends graph execution with `interrupt()` on mutation queries.
- [execute](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/execute.ts): Runs SQL queries against the connection pool. Handles retry-loop count increments.
- [responder](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/responder.ts) & [clarify](file:///home/jainam/Documents/PrepSql/lib/agent/nodes/clarify.ts): Build user responses for greetings, table explorations, or ambiguous inputs.
- [system](file:///home/jainam/Documents/PrepSql/lib/agent/prompts/system.ts) & [few-shot](file:///home/jainam/Documents/PrepSql/lib/agent/prompts/few-shot.ts): Dynamic system prompts and shot banks.

### 3. API & UI Integration
- [generate API Route](file:///home/jainam/Documents/PrepSql/app/api/generate/route.ts): Replaced the linear pipeline with a clean `runAgent()` call. Session IDs are mapped directly to `threadId` so conversation histories persist across API calls.
- [session.ts](file:///home/jainam/Documents/PrepSql/lib/session.ts): Exported `getSessionId()` to fetch thread IDs directly.
- [sqlite-adapter.ts](file:///home/jainam/Documents/PrepSql/lib/sqlite-adapter.ts): Modified to use an `eval()` require bypass workaround to prevent Next.js Turbopack from throwing ESM/CommonJS url-import errors on `node:sqlite`.
- [QueryInterface Component](file:///home/jainam/Documents/PrepSql/components/QueryInterface.tsx): Added an `onQueryResult` callback to display the agent's pre-executed query results, eliminating duplicate database execution calls.
- [page.tsx](file:///home/jainam/Documents/PrepSql/app/page.tsx): Updated to wire the `onQueryResult` callback to the main results display state.

---

## Verification Results

### 1. Compile Verification
Ran `pnpm tsc --noEmit` which completed successfully with **zero errors**.

### 2. End-to-End API Verification (SQLite `test.db`)

#### SELECT Query (Auto-Executed)
Sending a POST request to `/api/generate` with `"show all users"` successfully introspected the database, generated the SQL, ran it against the SQLite engine, and returned the actual results:
```json
{
  "type": "sql",
  "sql": "SELECT * FROM users;",
  "explanation": "Displays all columns for every row in the users table.",
  "usage": { "promptTokens": 625, "completionTokens": 22 },
  "result": {
    "columns": ["id", "name", "email", "role", "created_at"],
    "rows": [
      { "id": 1, "name": "Alice Smith", "email": "alice@example.com", "role": "admin", "created_at": "2026-06-16 10:23:54" },
      { "id": 2, "name": "Bob Johnson", "email": "bob@example.com", "role": "user", "created_at": "2026-06-16 10:23:54" },
      { "id": 3, "name": "Charlie Brown", "email": "charlie@example.com", "role": "user", "created_at": "2026-06-16 10:23:54" },
      { "id": 4, "name": "Diana Prince", "email": "diana@example.com", "role": "user", "created_at": "2026-06-16 10:23:54" }
    ],
    "rowCount": 4
  },
  "pendingApproval": false
}
```

#### Mutation Query (Suspended / Interrupted)
Sending a POST request to `/api/generate` with `"delete user with id 4"` correctly identified the mutation intent, paused execution, and returned a `pendingApproval: true` suspend response:
```json
{
  "type": "pending_approval",
  "pendingApproval": true,
  "sql": "DELETE FROM users WHERE id = 4;",
  "explanation": "Deletes the user record with the specified id, if it exists.",
  "isMutation": true,
  "mutationType": "DELETE",
  "identifierCorrections": [],
  "unmatchedIdentifiers": []
}
```

#### Resuming Approved Mutation (Executed)
Sending a POST request to `/api/generate` with `action: "approve"` resumed the suspended thread and completed the delete execution:
```json
{
  "type": "sql",
  "sql": "DELETE FROM users WHERE id = 4;",
  "explanation": "Deletes the user record with the specified id, if it exists.",
  "usage": { "promptTokens": 589, "completionTokens": 28 },
  "isMutation": true,
  "mutationType": "DELETE",
  "pendingApproval": false,
  "result": { "columns": [], "rows": [], "rowCount": 0 }
}
```
Re-running `"show all users"` confirmed that the user with `id: 4` (Diana Prince) was successfully removed from the database.
