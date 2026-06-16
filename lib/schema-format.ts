import type { SchemaTable } from './types';
import { quotePgTable } from './pg-identifiers';

export function formatSchemaForPrompt(tables: SchemaTable[], dbType: string): string {
  if (tables.length === 0) {
    return 'No tables found in schema.';
  }

  const lines = tables.map((table) => {
    const cols = table.columns.map((c) => `  - ${c.name} (${c.type})`).join('\n');
    const quoted =
      dbType === 'postgresql' ? quotePgTable(table.name) : table.name;
    return `Table ${quoted} (${table.rowCount} rows):\n${cols}`;
  });

  const pgNote =
    dbType === 'postgresql'
      ? '\nIMPORTANT: This is a PostgreSQL database. Table and column names may be case-sensitive. You MUST double-quote ALL table names AND column names exactly as they appear in the schema (e.g. SELECT "createdAt" FROM "Users"). Failure to quote will cause case-folding errors.'
      : '';

  return `Database schema:\n\n${lines.join('\n\n')}${pgNote}`;
}

export function buildSelectPreview(table: SchemaTable, dbType: string, limit = 10): string {
  const tableRef = dbType === 'postgresql' ? quotePgTable(table.name) : table.name;
  return `SELECT * FROM ${tableRef} LIMIT ${limit}`;
}
