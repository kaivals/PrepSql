import Anthropic from '@anthropic-ai/sdk';
import type { DatabaseConnection, QueryMode } from './types';
import { formatSchemaForPrompt } from './schema-format';

interface GenerationResult {
  sql: string;
  explanation: string;
}

const dialectDescriptions = {
  sqlite: 'SQLite3 - supports basic SQL with some limitations',
  postgresql: 'PostgreSQL - supports advanced features like JSON, arrays, etc.',
  mysql: 'MySQL 8.0+ - supports JSON, window functions, CTEs',
  mariadb: 'MariaDB - MySQL compatible with additional features',
};

const modeGuidelines: Record<QueryMode, string> = {
  readonly: 'Only generate SELECT queries. No INSERT, UPDATE, DELETE, DROP, or DDL.',
  crud: 'Generate SELECT, INSERT, UPDATE, or DELETE as needed. Avoid DROP and TRUNCATE.',
  analytics: 'Generate analytical queries with aggregations, window functions, CTEs, and JOINs as appropriate.',
};

export async function generateSQL(
  prompt: string,
  connection: DatabaseConnection,
  mode: QueryMode = 'readonly',
  apiKey?: string,
  schemaContext?: string
): Promise<GenerationResult> {
  if (!apiKey?.trim()) {
    throw new Error(
      'Anthropic API key is not set. Add your key in the settings panel below, or set ANTHROPIC_API_KEY in .env.local'
    );
  }

  const client = new Anthropic({ apiKey: apiKey.trim() });

  const dialectInfo = dialectDescriptions[connection.type];
  const dbName = connection.name || connection.database || 'unknown';

  const systemPrompt = `You are an expert SQL developer. Generate safe, efficient SQL queries based on user prompts.

Database Info:
- Type: ${dialectInfo}
- Name: ${dbName}

${schemaContext || 'Schema not available — introspect tables before assuming names.'}

Query mode: ${mode}
${modeGuidelines[mode]}

Important guidelines:
1. Always generate valid SQL for the specified database dialect
2. Use proper escaping and parameterization concepts
3. Keep queries efficient and readable
4. When uncertain about schema, make reasonable assumptions and note them
5. Return ONLY the SQL query in a code block, followed by a brief explanation

Format your response as:
\`\`\`sql
[Your SQL query here]
\`\`\`

Explanation: [Brief explanation of what the query does]`;

  try {
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: systemPrompt,
    });

    // Extract the response
    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const text = content.text;

    // Parse the SQL from code block
    const sqlMatch = text.match(/```(?:sql)?\n([\s\S]*?)\n```/);
    const sql = sqlMatch ? sqlMatch[1].trim() : text.split('Explanation:')[0].trim();

    // Extract explanation
    const explanationMatch = text.match(/Explanation:\s*([\s\S]*?)(?:\n|$)/);
    const explanation = explanationMatch ? explanationMatch[1].trim() : 'SQL query generated';

    return {
      sql,
      explanation,
    };
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

export function validateSQLSafety(sql: string): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const upperSQL = sql.toUpperCase();

  // Check for dangerous patterns
  if (upperSQL.includes('DROP')) {
    warnings.push('Query contains DROP statement - destructive operation');
  }
  if (upperSQL.includes('TRUNCATE')) {
    warnings.push('Query contains TRUNCATE - will delete all data');
  }
  if (upperSQL.includes('DELETE') && !upperSQL.includes('WHERE')) {
    warnings.push('DELETE query without WHERE clause - will delete all rows');
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}
