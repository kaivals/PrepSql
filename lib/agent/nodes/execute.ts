// lib/agent/nodes/execute.ts
// Query execution node — wraps lib/database.ts with correct pool-based API.
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { getOrCreatePool, executeQuery } from '../../database';
import { getConnection } from '../../app-state';
import type { AgentStateType } from '../state';
import { clearSchemaCache } from './schema-load';

export async function executeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Skip if mutation was rejected
  if (state.isMutation && state.humanApproved === false) return {};
  // Skip if no SQL to execute or there's already an error
  if (!state.generatedSQL || state.error) return {};

  try {
    // 1. Get the active database connection (includes type, host, port, etc.)
    const connection = await getConnection();
    if (!connection) {
      return {
        error: 'No active database connection. Please connect to a database first.',
        finalResponse: {
          type: 'error',
          message: 'No active database connection. Please connect to a database first.',
        },
      };
    }

    // 2. Get or create a connection pool from the connection config
    //    getOrCreatePool expects Omit<DatabaseConnection, 'id'>
    const { id: _id, ...poolConfig } = connection;
    const pool = await getOrCreatePool(poolConfig);

    // 3. Execute the query — executeQuery takes (DatabaseClient, sql: string)
    const result = await executeQuery(pool, state.generatedSQL);

    // Clear schema cache if the query was DDL or mutation to ensure schema is fresh
    if (state.intent === 'sql_schema' || state.isMutation) {
      clearSchemaCache(connection.id);
    }

    const rowsSummary = result.rows && result.rows.length > 0
      ? result.rows.slice(0, 5).map((r) => {
          const str = JSON.stringify(r);
          return str.length > 300 ? str.slice(0, 300) + '...' : str;
        }).join('\n')
      : 'No rows returned.';

    const aiMessage = new AIMessage(
      `SQL:\n\`\`\`sql\n${state.generatedSQL}\n\`\`\`\n\nExplanation: ${state.explanation}\n\nExecution Result (sample):\n${rowsSummary}`
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
        type: 'sql',
        result: {
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rows.length,
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
Do not repeat the same query.`
      );

      return {
        messages: [errorContext],
        generatedSQL: "",
        error: errMsg,
        retryCount: state.retryCount + 1,
      };
    }

    const aiMessage = new AIMessage(`SQL execution failed: ${errMsg}`);

    // Exhausted retries — surface error to user
    return {
      messages: [aiMessage],
      error: errMsg,
      finalResponse: {
        type: 'error',
        message: `Query failed after ${state.retryCount + 1} attempts: ${errMsg}`,
        sql: state.generatedSQL,
      },
    };
  }
}
