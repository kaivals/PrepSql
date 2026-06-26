# PrepSQL Codebase Context & AI Integration Guide

PrepSQL is a modern Next.js web application designed to generate and execute SQL queries from natural language prompts using AI. It provides multi-database support (PostgreSQL, MySQL, MariaDB, SQLite) and incorporates schema introspection, safety checks, and an automated SQL validation layer to handle identifier casing issues.

---

## 1. Directory Structure

Here is an overview of the key directories and files in the codebase:

```text
├── app/
│   ├── api/
│   │   ├── connection/          # GET, POST, PATCH, DELETE database connections
│   │   ├── demo/                # Sets up a demo SQLite database in the session
│   │   ├── execute/             # Runs query execution against the connected DB
│   │   ├── generate/            # AI SQL generation, validation, and auto-correction
│   │   ├── history/             # Query history management (GET, DELETE)
│   │   └── mode/                # Retrieves/sets Query mode (readonly, crud, etc.)
│   ├── globals.css              # Main stylesheet (Tailwind CSS 4.0 configuration)
│   ├── layout.tsx               # Next.js Root Layout
│   └── page.tsx                 # Main application client component
├── components/
│   ├── AnalyticsPage.tsx        # Dashboard showing query efficiency, latencies, and slow query logs
│   ├── ApiKeySetup.tsx          # Warning state inline card for missing Groq/Anthropic API keys
│   ├── AppHeader.tsx            # Header showing logo and user settings avatar
│   ├── ConnectionForm.tsx       # Form input for MySQL, PostgreSQL, SQLite (local and remote Turso)
│   ├── ConnectionsPage.tsx      # Overview of active connection list with trigger modal
│   ├── NavigationSidebar.tsx    # Framer-style left navigation bar to switch app view sections
│   ├── QueryInterface.tsx       # AI prompt chat input, raw SQL execution tab, and results table
│   ├── ResultsTable.tsx         # Interactive data grid for query results with CSV export option
│   ├── SQLEditor.tsx            # Code snippet box displaying generated SQL queries
│   ├── SchemaEditor.tsx         # Database table schema builder, supporting column add/edit/delete
│   ├── SchemaSidebar.tsx        # Multi-tab (Schema, Indexes, History) panel with Pencil edit triggers
│   ├── SettingsModal.tsx        # Modal overlay configuration for LLM provider API keys
│   └── Toast.tsx                # Translucent toast overlay notifications for alerts/success/confirmations
├── lib/
│   ├── api-key-storage.ts       # Utility to sync LLM API keys with server cookies
│   ├── claude.ts                # Main AI integration (System prompts, Groq/Anthropic APIs)
│   ├── client-connection.ts     # Client-side helper for credentials and reconnecting
│   ├── connection-defaults.ts   # Port defaults, localStorage keys, and saved connection loaders
│   ├── database.ts              # Connection pools manager for PostgreSQL, MySQL, SQLite
│   ├── pg-identifiers.ts        # Helper to double-quote PostgreSQL identifiers
│   ├── schema-format.ts         # Introspected schema formatter for system prompts
│   ├── schema.ts                # Database introspector for all supported dialects
│   ├── session.ts               # Server sessions Manager for connection configs and api keys
│   ├── sql-validator.ts         # Post-generation casing corrector and PostgreSQL identifier quoter
│   ├── sqlite-adapter.ts        # Sync-to-Async adapter wrapper for Node.js native DatabaseSync
│   └── types.ts                 # TypeScript type declarations
```

---

## 2. Core Database Operations

The application leverages distinct drivers to connect to and introspect client databases:
* **PostgreSQL**: Handled using the `pg` Pool client.
* **MySQL/MariaDB**: Handled using the `mysql2/promise` client.
* **SQLite**: Uses the built-in `node:sqlite` module (specifically `DatabaseSync` in newer Node versions). The `lib/sqlite-adapter.ts` file adapts the synchronous `DatabaseSync` APIs into asynchronous, callback-based signatures compatible with standard query execution models.

All connection pools are cached in-memory and mapped by their connection details inside [lib/database.ts](file:///home/jainam/Documents/PrepSql/lib/database.ts) to minimize handshake latency.

### Query Performance Telemetry & Analytics
For SELECT queries, the backend automatically runs `EXPLAIN` planning queries to retrieve actual metrics rather than generic simulations:
* **SQLite / Turso**: Runs `EXPLAIN QUERY PLAN`. If a table scan (`SCAN`) is detected, it executes a fast row-count query (`SELECT COUNT(*)`) on that table to determine the exact number of rows scanned; otherwise it estimates rows scanned based on rows returned.
* **PostgreSQL**: Runs `EXPLAIN (FORMAT JSON)` and sums the estimated rows across all scan nodes (e.g., `Seq Scan`, `Index Scan`).
* **MySQL / MariaDB**: Runs `EXPLAIN FORMAT=JSON` and parses the plan to sum `rows_examined_per_scan`.

For resource usage (CPU/Memory):
* **Local SQLite**: Monitored in real-time using native Node process hooks (`process.cpuUsage()` and `process.memoryUsage()`) before and after query execution.
* **Remote Databases**: Estimated client-side processing metrics based on row count and execution speed, clearly marked in the UI via descriptive hover tooltips.

---

## 3. AI SQL Generation & Validation Pipeline

The SQL generation process goes through a five-stage pipeline to ensure that the generated SQL conforms to the exact database schema, handles casing differences, and enforces query safety.

```mermaid
graph TD
    A[User Prompt] --> B[Introspect DB Schema]
    B --> C[Format Schema into Context]
    C --> D[Call LLM API <br> Anthropic/Groq]
    D --> E[Parse Raw Response]
    E --> F[Validate and Correct Casing]
    F --> G[Verify Execution Safety]
    G --> H[Return final SQL to Client]
```

### Stage 1: Live Introspection (`lib/schema.ts`)
When a generation request starts, the backend executes schema queries tailored to the active database dialect to map out all tables, columns, types, primary keys, foreign keys, and indexes:
* **PostgreSQL**: Queries are run against `pg_catalog.pg_class`, `pg_catalog.pg_attribute`, and `pg_catalog.pg_constraint` rather than `information_schema`. This ensures that **original casing** (e.g. `userId` or `createdAt` in camelCase/mixedCase) is preserved, as `information_schema` normalizes all identifier names to lowercase.
* **SQLite**: Queries use `PRAGMA table_info`, `PRAGMA foreign_key_list`, and `PRAGMA index_list`.
* **MySQL**: Queries use `information_schema.COLUMNS` and `information_schema.KEY_COLUMN_USAGE`.

### Stage 2: Schema Formatting (`lib/schema-format.ts`)
The introspected schema metadata is formatted into a clear, structured text representation.
* For **PostgreSQL**, every table and column name is pre-wrapped in double-quotes (e.g. `Table "Users"` and `- "userId" (varchar)`).
* Crucially, a mandatory PostgreSQL warning is appended instructing the AI model to copy all identifiers **verbatim** including the double-quotes to prevent PostgreSQL runtime errors caused by automatic lowercasing.

### Stage 3: LLM Invocation & Parsing (`lib/claude.ts`)
The system prompt is dynamically assembled combining database metadata, query mode rules (e.g., `readonly` disallows mutations; `schema` allows DDL), and the schema context:
* The user prompt is sent to either **Anthropic (Claude 3.5 Sonnet)** or **Groq (Llama 3.1 8B)**.
* The model output is parsed to extract the SQL query block (delimited by ` ```sql `) and the explanation.

### Stage 4: Post-Generation Casing Correction (`lib/sql-validator.ts`)
Even with strong prompting rules, LLMs sometimes lowercase mixed-cased columns or omit double-quotes. PrepSQL runs a custom tokenizer that parses the SQL string:
1. It ignores string literals (`'...'`), already double-quoted regions (`"..."`), backticks (`` `...` ``), and positional parameters (`$1`).
2. Bare identifiers are extracted and matched case-insensitively against the real schema.
3. If there is a casing mismatch, it automatically replaces the identifier with the exact casing from the schema.
4. For PostgreSQL, if a bare identifier is identified as a schema table or column, it is automatically wrapped in double-quotes.

### Stage 5: Execution Safety Check (`lib/claude.ts`)
Before returning the final SQL to the client, the backend analyzes the queries to flag mutations (e.g. `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`). If a mutation is detected, it is marked as `isMutation: true` and surfaced in the client. Depending on the connection mode settings, client-side safety warnings are displayed to prompt the user before execution.

---

## 4. Main API Endpoints

### `POST /api/generate`
Generates an SQL query based on the user's natural language request.
* **Payload**:
  ```json
  { "prompt": "Show me the top 3 products ordered by price" }
  ```
* **Response**:
  ```json
  {
    "sql": "SELECT * FROM products ORDER BY price DESC LIMIT 3",
    "explanation": "Retrieves the highest-priced products by sorting price in descending order and limiting to 3 rows.",
    "usage": { "promptTokens": 512, "completionTokens": 96 },
    "safetyOk": true,
    "isMutation": false,
    "identifierCorrections": [],
    "unmatchedIdentifiers": []
  }
  ```

### `POST /api/execute`
Executes an SQL query against the active database.
* **Payload**:
  ```json
  { "sql": "SELECT * FROM products ORDER BY price DESC LIMIT 3" }
  ```
* **Response**:
  ```json
  {
    "columns": ["id", "name", "price", "stock", "category"],
    "rows": [
      { "id": 2, "name": "Mechanical Keyboard", "price": 89.99, "stock": 80, "category": "Electronics" },
      { "id": 1, "name": "Wireless Mouse", "price": 29.99, "stock": 150, "category": "Electronics" },
      { "id": 3, "name": "USB-C Hub", "price": 19.99, "stock": 200, "category": "Electronics" }
    ],
    "rowCount": 3
  }
  ```

---

## 5. UI Theme & Design System

PrepSQL implements a cohesive developer-focused interface tailored for high readability and layout density.

### A. Design Aesthetic: "Blue Aurora Glassmorphism with #F9FAFB Base"
- **Background**:
  - Base Layout: Cool near-white base (`#F9FAFB`)
  - Backdrops: Soft blue (`#93C5FD`/35%), ice cyan (`#A5F3FC`/28%), pale lavender (`#C4B5F4`/22%), and whisper blue (`#BFDBFE`/30%) ambient background blobs, heavily blurred (`blur-[100px] to blur-[130px]`).
- **Glass Panels (Sidebars, Header, Cards, Popovers)**:
  - Background: Semi-translucent white (`rgba(255, 255, 255, 0.60)`) for static cards and sidebars, and highly opaque white (`rgba(255, 255, 255, 0.95)`) for floating popovers and dropdowns to block underlying text from bleeding through.
  - Blur Effect: `backdrop-filter: blur(20px)`
  - Border Edge: White translucent borders (`rgba(255, 255, 255, 0.80)`)
  - Shadow: Soft blue-shadow (`0 4px 24px rgba(59, 130, 246, 0.08)`)
- **Typography / Foregrounds**:
  - Headings: Slate (`#0F172A`) for high contrast
  - Body Text: Slate-gray (`#334155`)
  - Muted Labels: Muted slate-gray (`#94A3B8`)
- **CTAs & Accents**:
  - Active Connection & Primary CTAs: Premium Blue (`#3B82F6`)
  - Hover Action: Darker Blue (`#2563EB`)
  - Success Indicator: Emerald (`#10B981`)
  - Error Indicator: Red (`#EF4444`)

### B. Typography Pairings
- **UI Elements**: **Geist Sans** (with **Inter** fallback) for premium developer-tool layout density and high readability.
- **SQL Editors & Schemas**: **Geist Mono** (with **JetBrains Mono** / **Fira Code** fallbacks) for vertical spacing and layout precision.

### C. Sidebar Integration
- Schema edits are initiated inline by clicking the **Pencil (Edit)** icon next to any table in the `SchemaSidebar.tsx`. The icon is always visible (at a lower opacity) to make the feature easily discoverable, and highlights to full opacity on hover, launching the `SchemaEditor.tsx` in the main workspace panel.

### D. Integrated User Profile Dropdown
- The upper-right portion of the header features a unified, click-outside-aware user avatar dropdown trigger.
- Instead of multiple separate profile and logout buttons, the interface provides a single, cohesive menu with exactly two selections:
  - **Profile**: Triggers the `SettingsModal` to manage AI API configurations (uses the Lucide `User` icon).
  - **Sign out**: Closes the active session and redirects the user back to the connection page (uses the Lucide `LogOut` icon).
- Both options are styled with corresponding Lucide icons and hover states matching the light teal glassmorphic theme.
