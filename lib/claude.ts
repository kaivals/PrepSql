import Anthropic from '@anthropic-ai/sdk';
import type { DatabaseConnection, QueryMode, TokenUsage } from './types';

export type AiProvider = 'groq' | 'anthropic';

interface GenerationResult {
  sql: string;
  explanation: string;
  usage?: TokenUsage;
}

interface AiConfig {
  provider: AiProvider;
  key: string;
}

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const dialectDescriptions = {
  sqlite: 'SQLite3 - supports basic SQL with some limitations',
  postgresql: 'PostgreSQL - supports advanced features like JSON, arrays, etc.',
  mysql: 'MySQL 8.0+ - supports JSON, window functions, CTEs',
  mariadb: 'MariaDB - MySQL compatible with additional features',
};

const modeGuidelines: Record<QueryMode, string> = {
  crud: 'Generate SELECT, INSERT, UPDATE, or DELETE as needed. Avoid DROP and TRUNCATE.',
  analytics: 'Generate analytical queries with aggregations, window functions, CTEs, and JOINs as appropriate.',
  schema: 'Generate DDL queries to modify tables (ALTER TABLE, CREATE TABLE, etc.) if requested, otherwise focus on schema analysis.',
};

function buildSystemPrompt(
  connection: DatabaseConnection,
  mode: QueryMode,
  schemaContext?: string
): string {
  const dialectInfo = dialectDescriptions[connection.type];
  const dbName = connection.name || connection.database || 'unknown';

  const pgIdentifierRules =
    connection.type === 'postgresql'
      ? `
PostgreSQL Identifier Rules (MANDATORY — violations cause runtime errors):
- PostgreSQL folds unquoted identifiers to lowercase at runtime.
- ALL table names and column names MUST be wrapped in double-quotes exactly as shown in the schema above.
- NEVER lowercase, NEVER transform, NEVER omit double-quotes from any identifier.
- Copy every identifier character-for-character from the schema context.
- Correct:   SELECT "userId", "createdAt" FROM "Users"
- Incorrect: SELECT userid, createdat FROM users  ← will fail with "column does not exist"
- Incorrect: SELECT "userid" FROM "users"          ← wrong casing, will fail
`
      : '';

  return `You are an expert SQL developer. Generate safe, efficient SQL queries based on user prompts.

Database Info:
- Type: ${dialectInfo}
- Name: ${dbName}

${schemaContext || 'No schema available.'}
${pgIdentifierRules}
Query mode: ${mode}
${modeGuidelines[mode]}

STRICT IDENTIFIER RULES:
1. ONLY use table names and column names that appear in the schema context above.
2. NEVER invent, guess, or transform identifier names — use them exactly as shown.
3. If you cannot fulfil the request with the available schema, say so in the explanation instead of guessing a table or column name.
4. Always generate valid SQL for the specified database dialect.
5. Keep queries efficient and readable.
6. Return ONLY the SQL query in a code block, followed by a brief explanation. DO NOT output conversational text before the code block.

Format your response EXACTLY as:
\`\`\`sql
[Your SQL query here]
\`\`\`

Explanation: [Brief explanation of what the query does]`;
}


function parseGenerationResponse(text: string, usage?: TokenUsage): GenerationResult {
  const sqlMatch = text.match(/```(?:sql)?\s*\n?([\s\S]*?)\n?\s*```/i);
  let sql = sqlMatch ? sqlMatch[1].trim() : text.split('Explanation:')[0].trim();
  
  // Clean up conversational text if fallback was used
  if (!sqlMatch && sql.toLowerCase().includes('select')) {
      const selectIdx = sql.toLowerCase().indexOf('select');
      if (selectIdx > 0) sql = sql.substring(selectIdx);
  } else if (!sqlMatch && sql.toLowerCase().includes('create index')) {
      const createIdx = sql.toLowerCase().indexOf('create index');
      if (createIdx > 0) sql = sql.substring(createIdx);
  }

  const explanationMatch = text.match(/Explanation:\s*([\s\S]*?)(?:\n|$)/i);
  const explanation = explanationMatch ? explanationMatch[1].trim() : 'SQL query generated';

  return { sql, explanation, usage };
}

async function generateWithGroq(
  apiKey: string,
  systemPrompt: string,
  prompt: string
): Promise<{ text: string; usage?: TokenUsage }> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || `Groq API error (${response.status})`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Unexpected response from Groq');
  }

  const usage = data.usage ? {
    promptTokens: data.usage.prompt_tokens || 0,
    completionTokens: data.usage.completion_tokens || 0,
  } : undefined;

  return { text, usage };
}

async function generateWithAnthropic(
  apiKey: string,
  systemPrompt: string,
  prompt: string
): Promise<{ text: string; usage?: TokenUsage }> {
  const client = new Anthropic({ apiKey: apiKey.trim() });

  try {
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
      system: systemPrompt,
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const usage = {
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };

    return { text: content.text, usage };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const msg = error.message.toLowerCase();
      if (msg.includes('credit balance') || msg.includes('billing')) {
        throw new Error(
          'Anthropic account has no credits. Add credits at console.anthropic.com/settings/billing, or switch to "Run SQL" mode below to query without AI.'
        );
      }
      throw new Error(`Claude API error: ${error.message}`);
    }
    throw error;
  }
}

export async function generateSQL(
  prompt: string,
  connection: DatabaseConnection,
  mode: QueryMode = 'crud',
  aiConfig?: AiConfig,
  schemaContext?: string
): Promise<GenerationResult> {
  if (!aiConfig?.key?.trim()) {
    throw new Error(
      'AI API key is not set. Add a Groq key (gsk_...) or Anthropic key in Settings, or set GROQ_API_KEY / ANTHROPIC_API_KEY in .env.local'
    );
  }

  const systemPrompt = buildSystemPrompt(connection, mode, schemaContext);
  const { text, usage } =
    aiConfig.provider === 'groq'
      ? await generateWithGroq(aiConfig.key, systemPrompt, prompt)
      : await generateWithAnthropic(aiConfig.key, systemPrompt, prompt);

  return parseGenerationResponse(text, usage);
}

export function validateSQLSafety(sql: string): { safe: boolean; warnings: string[]; isMutation: boolean } {
  const upperSQL = sql.toUpperCase();
  let isMutation = false;

  if (
    upperSQL.includes('DROP') ||
    upperSQL.includes('TRUNCATE') ||
    upperSQL.includes('DELETE') ||
    upperSQL.includes('INSERT') ||
    upperSQL.includes('UPDATE') ||
    upperSQL.includes('ALTER')
  ) {
    isMutation = true;
  }

  return {
    safe: true,
    warnings: [],
    isMutation,
  };
}
