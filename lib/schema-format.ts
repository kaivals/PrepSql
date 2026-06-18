import type { SchemaTable, SchemaColumn } from './types';
import { quotePgTable, quotePgColumn } from './pg-identifiers';

/**
 * Format the introspected schema into a descriptive string for the AI prompt.
 *
 * For PostgreSQL, every table name and every column name is shown already wrapped
 * in double-quotes so the AI can copy-paste them verbatim into the generated SQL
 * without any case transformation.
 */
export function formatSchemaForPrompt(tables: SchemaTable[], dbType: string): string {
  if (tables.length === 0) {
    return 'No tables found in schema.';
  }

  const isPg = dbType === 'postgresql';

  const lines = tables.map((table) => {
    // Show the identifier exactly as the AI must write it in SQL.
    const tableRef = isPg ? quotePgTable(table.name) : table.name;

    const cols = table.columns
      .map((c: SchemaColumn) => {
        const colRef = isPg ? quotePgColumn(c.name) : c.name;
        const flags: string[] = [];
        if (c.primaryKey) flags.push('PK');
        if (c.autoIncrement) flags.push('auto');
        if (!c.nullable) flags.push('NOT NULL');
        if (c.unique && !c.primaryKey) flags.push('UNIQUE');
        if (c.foreignKey) flags.push(`FK→${isPg ? quotePgTable(c.foreignKey.table) : c.foreignKey.table}.${isPg ? quotePgColumn(c.foreignKey.column) : c.foreignKey.column}`);
        const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
        return `  - ${colRef} (${c.type})${flagStr}`;
      })
      .join('\n');

    return `Table ${tableRef} (${table.rowCount} rows):\n${cols}`;
  });

  const pgNote = isPg
    ? `\n\nCRITICAL POSTGRESQL RULE: Every table name and column name shown above is already wrapped in double-quotes. You MUST copy them VERBATIM into your SQL — including the double-quotes. Never lowercase, never remove quotes. Example: SELECT "userId", "createdAt" FROM "Users" WHERE "isActive" = true`
    : '';

  return `Database schema (exact identifier casing — do NOT alter):\n\n${lines.join('\n\n')}${pgNote}`;
}

/**
 * Build a simple SELECT * preview for a single table, using properly quoted identifiers.
 */
export function buildSelectPreview(table: SchemaTable, dbType: string, limit = 10): string {
  const tableRef = dbType === 'postgresql' ? quotePgTable(table.name) : table.name;
  return `SELECT * FROM ${tableRef} LIMIT ${limit}`;
}
