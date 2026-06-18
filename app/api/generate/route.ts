import { NextRequest, NextResponse } from 'next/server';
import { getConnection, getQueryMode, getAiApiKey } from '@/lib/session';
import { generateSQL, validateSQLSafety } from '@/lib/claude';
import { introspectSchema } from '@/lib/schema';
import { formatSchemaForPrompt } from '@/lib/schema-format';
import { validateAndCorrectSQL } from '@/lib/sql-validator';

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

    // 1. Fetch live schema metadata (uses pg_catalog for PG — exact identifier casing)
    const mode = await getQueryMode();
    const aiConfig = await getAiApiKey();
    const tables = await introspectSchema(connection);

    // 2. Build schema context string with all identifiers pre-quoted for the AI
    const schemaContext = formatSchemaForPrompt(tables, connection.type);

    // 3. Generate SQL via AI
    const result = await generateSQL(prompt, connection, mode, aiConfig, schemaContext);

    // 4. Post-generation validation: auto-correct identifier casing & PG quoting
    const validation = validateAndCorrectSQL(result.sql, tables, connection.type);
    const finalSql = validation.correctedSql;

    // 5. Safety check
    const safety = validateSQLSafety(finalSql);

    return NextResponse.json({
      sql: finalSql,
      explanation: result.explanation,
      usage: result.usage,
      safetyWarnings: safety.warnings,
      safetyOk: safety.safe,
      isMutation: safety.isMutation,
      // Surface auto-correction metadata for the UI
      identifierCorrections: validation.corrections,
      unmatchedIdentifiers: validation.unmatchedIdentifiers,
    });
  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate SQL' },
      { status: 500 }
    );
  }
}
