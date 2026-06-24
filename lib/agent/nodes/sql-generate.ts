import { ChatGroq } from '@langchain/groq';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { buildSystemPrompt } from '../prompts/system';
import { getFewShotExamples } from '../prompts/few-shot';
import { getQueryMode, getGroqApiKey } from '../../app-state';
import type { AgentStateType } from '../state';
import { logQueryStep } from '../../query-logger';

export async function sqlGenerateNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  // Skip if schema introspection failed
  if (state.error && !state.retryCount) return {};

  const queryMode = await getQueryMode();
  const apiKey = await getGroqApiKey();

  const llm = new ChatGroq({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    maxTokens: 1024,
    apiKey,
    maxRetries: 0,
  });

  const systemPrompt = buildSystemPrompt({
    dbDialect: state.dbDialect,
    schemaFormatted: state.schemaFormatted,
    intent: state.intent,
    queryMode,
  });

  const fewShots = getFewShotExamples(state.intent, state.dbDialect);

  // Build the message list:
  // system → few-shot pairs → conversation history → current prompt
  const messages = [
    new SystemMessage(systemPrompt),
    ...fewShots,
    ...state.messages.slice(-8), // last 4 turns (8 messages) for context
    new HumanMessage(
      state.retryCount > 0
        ? `The previous SQL failed with error: "${state.error}"\nOriginal SQL:\n\`\`\`sql\n${state.lastFailedSQL}\n\`\`\`\n\nPlease fix the SQL. User's original request: ${state.userPrompt}`
        : state.userPrompt
    ),
  ];

  try {
    const response = await llm.invoke(messages);
    const raw = String(response.content);

    // Extract the last SQL block if multiple exist
    const sqlMatches = [...raw.matchAll(/```sql\s*([\s\S]*?)```/gi)];
    const generatedSQL = sqlMatches.length > 0 ? sqlMatches[sqlMatches.length - 1][1].trim() : '';

    // Extract explanation (remove all SQL blocks)
    const explanation = raw.replace(/```sql[\s\S]*?```/gi, '').trim();

    if (!generatedSQL) {
      return {
        error: null,
        finalResponse: {
          type: 'answer',
          message: raw.trim() || 'Could not generate SQL from your request. Try being more specific.',
        },
      };
    }

    // Track token usage from response metadata
    const usageMeta = (
      response as unknown as {
        usage_metadata?: { input_tokens: number; output_tokens: number };
      }
    ).usage_metadata;

    logQueryStep({
      type: state.retryCount > 0 ? 'optimization_rewrite' : 'initial_ai',
      sql: generatedSQL,
      success: true,
    });

    return {
      generatedSQL,
      explanation,
      error: null,
      finalResponse: {
        type: 'sql',
        sql: generatedSQL,
        explanation,
        usage: usageMeta
          ? {
              promptTokens: usageMeta.input_tokens,
              completionTokens: usageMeta.output_tokens,
            }
          : undefined,
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'LLM call failed';

    logQueryStep({
      type: state.retryCount > 0 ? 'optimization_rewrite' : 'initial_ai',
      sql: `-- Failed to generate SQL: ${errMsg}`,
      success: false,
      error: errMsg,
    });

    return {
      error: errMsg,
      finalResponse: {
        type: 'error',
        message: `SQL generation failed: ${errMsg}`,
      },
    };
  }
}
