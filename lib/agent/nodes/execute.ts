// lib/agent/nodes/execute.ts
// Query execution node — wraps lib/database.ts with correct pool-based API.
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { getOrCreatePool, executeQuery } from "../../database";
import { getConnection, getGroqApiKey } from "../../app-state";
import { ChatGroq } from "@langchain/groq";
import type { AgentStateType } from "../state";
import { clearSchemaCache } from "./schema-load";
import { calculateQueryTelemetry } from "../../telemetry";

function sanitizeText(text: string): string {
  if (!text) return "";
  let sanitized = text;

  // Redact Unix absolute paths
  sanitized = sanitized.replace(
    /\/[a-zA-Z0-9_\-\.]+([/a-zA-Z0-9_\-\.]+)+/g,
    "[REDACTED_PATH]",
  );

  // Redact Windows absolute paths
  sanitized = sanitized.replace(
    /[a-zA-Z]:\\[a-zA-Z0-9_\-\.\\]+/g,
    "[REDACTED_PATH]",
  );

  // Redact IP addresses
  sanitized = sanitized.replace(
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    "[REDACTED_IP]",
  );

  // Redact email addresses
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    "[REDACTED_EMAIL]",
  );

  return sanitized;
}

function sanitizeSql(sql: string): string {
  if (!sql) return "";
  let sanitized = sql;

  // Redact string literals in SQL to prevent leaking sensitive criteria
  sanitized = sanitized.replace(/'[^']*'/g, "'[REDACTED]'");
  sanitized = sanitized.replace(/"[^"]*"/g, '"[REDACTED]"');

  return sanitizeText(sanitized);
}

async function invokeWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateFriendlyErrorExplanation(
  userPrompt: string,
  dbDialect: string,
  failedSQL: string,
  rawError: string,
): Promise<string> {
  try {
    const apiKey = await getGroqApiKey();
    const llm = new ChatGroq({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      maxTokens: 512,
      apiKey,
      maxRetries: 0,
    });

    const systemPrompt = `You are a helpful SQL Assistant. A user's query failed to execute on the database.
Your job is to explain why it failed in a friendly, constructive, and non-technical/conceptual way to the user, and suggest how they can write a better or more specific instruction to solve it.

CRITICAL SECURITY RULES:
- NEVER reveal any sensitive information like database file paths, system paths (e.g. "/home/..."), IP addresses, database connection credentials, or internal system configurations.
- Do not output raw stack traces.
- Keep the tone helpful, professional, and clear.
- Explain the issue conceptually (e.g., "The requested column or relation does not seem to match the database structure" rather than leaking physical database files or paths).`;

    const sanitizedPrompt = sanitizeText(userPrompt);
    const sanitizedSql = sanitizeSql(failedSQL);
    const sanitizedError = sanitizeText(rawError);

    const userMsg = `Context:
- User's Request: "${sanitizedPrompt}"
- Database Dialect: ${dbDialect}
- Generated SQL that failed: \`${sanitizedSql}\`
- Database Error Message: "${sanitizedError}"

Please write a brief explanation of why the query failed without disclosing sensitive system details, and suggest how the user can rewrite their prompt to make it work.`;

    const response = await invokeWithTimeout(
      llm.invoke([new SystemMessage(systemPrompt), new HumanMessage(userMsg)]),
      4000,
    );

    return String(response.content).trim();
  } catch (e) {
    return `We couldn't fulfill this request. The query failed with a database error. Please verify your instructions and database schema.`;
  }
}

export async function executeNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  // Skip if mutation was rejected
  if (state.isMutation && state.humanApproved === false) return {};
  // Skip if no SQL to execute or there's already an error
  if (!state.generatedSQL || state.error) return {};

  try {
    // 1. Get the active database connection (includes type, host, port, etc.)
    const connection = await getConnection();
    if (!connection) {
      return {
        error:
          "No active database connection. Please connect to a database first.",
        finalResponse: {
          type: "error",
          message:
            "No active database connection. Please connect to a database first.",
        },
      };
    }

    // 2. Get or create a connection pool from the connection config
    //    getOrCreatePool expects Omit<DatabaseConnection, 'id'>
    const { id: _id, ...poolConfig } = connection;
    const pool = await getOrCreatePool(poolConfig);

    const isLocalSQLite =
      connection.type === "sqlite" &&
      connection.filepath &&
      !connection.filepath.startsWith("libsql://") &&
      !connection.filepath.startsWith("https://") &&
      !connection.filepath.startsWith("http://");

    const startCpu = isLocalSQLite ? process.cpuUsage() : null;
    const startMem = isLocalSQLite ? process.memoryUsage().heapUsed : null;

    // 3. Execute the query — executeQuery takes (DatabaseClient, sql: string)
    const startTime = performance.now();
    const result = await executeQuery(pool, state.generatedSQL);
    const executionTime = Math.round(performance.now() - startTime);

    const cpuDiff = isLocalSQLite ? process.cpuUsage(startCpu!) : null;
    const memDiff = isLocalSQLite
      ? process.memoryUsage().heapUsed - startMem!
      : null;

    const rowsReturned = result.rows ? result.rows.length : 0;

    const telemetry = await calculateQueryTelemetry(
      connection,
      pool,
      state.generatedSQL,
      executionTime,
      rowsReturned,
      result,
      cpuDiff,
      memDiff,
    );

    // Clear schema cache if the query was DDL or mutation to ensure schema is fresh
    if (state.intent === "sql_schema" || state.isMutation) {
      clearSchemaCache(connection.id);
    }

    const rowsSummary =
      result.rows && result.rows.length > 0
        ? result.rows
            .slice(0, 5)
            .map((r) => {
              const str = JSON.stringify(r);
              return str.length > 300 ? str.slice(0, 300) + "..." : str;
            })
            .join("\n")
        : "No rows returned.";

    const aiMessage = new AIMessage(
      `SQL:\n\`\`\`sql\n${state.generatedSQL}\n\`\`\`\n\nExplanation: ${state.explanation}\n\nExecution Result (sample):\n${rowsSummary}`,
    );

    return {
      messages: [aiMessage],
      executionResult: {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rows.length,
      },
      finalResponse: {
        ...state.finalResponse!,
        type: "sql",
        result: {
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rows.length,
          executionTime,
          rowsScanned: telemetry.rowsScanned,
          rowsReturned,
          cpuUsage: telemetry.cpuUsage,
          memoryUsage: telemetry.memoryUsage,
          indexesUsed: telemetry.indexesUsed,
        },
      },
    };
  } catch (err) {
    const errMsg = (err as Error).message;

    // If within retry budget, signal re-generation
    if (state.retryCount < 2) {
      const errorContext = new HumanMessage(
        `The previous SQL query failed with this error:
     
Error: ${errMsg}

Failed SQL:
\`\`\`sql
${state.generatedSQL}
\`\`\`

Please analyze the error and generate a corrected SQL query. 
Do not repeat the same query.`,
      );

      return {
        messages: [errorContext],
        generatedSQL: "",
        error: errMsg,
        retryCount: state.retryCount + 1,
        lastFailedSQL: state.generatedSQL,
      };
    }

    // Exhausted retries — generate friendly explain response for user
    const friendlyExplain = await generateFriendlyErrorExplanation(
      state.userPrompt,
      state.dbDialect,
      state.generatedSQL,
      errMsg,
    );

    const aiMessage = new AIMessage(`SQL execution failed: ${friendlyExplain}`);

    return {
      messages: [aiMessage],
      error: errMsg,
      retryCount: state.retryCount + 1,
      lastFailedSQL: state.generatedSQL,
      finalResponse: {
        type: "error",
        message: friendlyExplain,
        sql: state.generatedSQL,
      },
    };
  }
}
