import { NextRequest, NextResponse } from 'next/server';
import { getConnection, getQueryMode, getAiApiKey } from '@/lib/session';
import { generateSQL, validateSQLSafety } from '@/lib/claude';
import { introspectSchema } from '@/lib/schema';
import { formatSchemaForPrompt } from '@/lib/schema-format';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Get current connection
    const connection = await getConnection();
    if (!connection) {
      return NextResponse.json(
        { error: 'No database connection. Please connect first.' },
        { status: 400 }
      );
    }

    const mode = await getQueryMode();
    const aiConfig = await getAiApiKey();
    const tables = await introspectSchema(connection);
    const schemaContext = formatSchemaForPrompt(tables, connection.type);
    const result = await generateSQL(prompt, connection, mode, aiConfig, schemaContext);

    // Validate for obvious safety issues
    const safety = validateSQLSafety(result.sql);

    return NextResponse.json({
      sql: result.sql,
      explanation: result.explanation,
      usage: result.usage,
      safetyWarnings: safety.warnings,
      safetyOk: safety.safe,
      isMutation: safety.isMutation,
    });
  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate SQL' },
      { status: 500 }
    );
  }
}
