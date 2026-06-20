/**
 * null-check.ts
 *
 * Reusable validation layer that checks for existing NULL values before
 * any NOT NULL migration is executed. Generates safe UPDATE statements to
 * backfill NULLs with appropriate default values before applying the
 * NOT NULL constraint.
 *
 * Works across PostgreSQL, MySQL, MariaDB, and SQLite.
 */

import type { DatabaseType } from './types';

/** A column that needs NULL backfill before a NOT NULL constraint can be applied. */
export interface NullColumnInfo {
  /** Escaped column name (ready for SQL). */
  column: string;
  /** Unescaped column name. */
  columnName: string;
  /** Number of rows containing NULL in this column. */
  nullCount: number;
  /** The SQL type of the column. */
  type: string;
  /** SQL statement to backfill NULLs. */
  backfillSql: string;
  /** Human-readable description of what the backfill does. */
  description: string;
}

export interface NullCheckResult {
  /** Columns that have NULL values and need backfill. */
  columns: NullColumnInfo[];
  /** Whether any backfill is needed. */
  needsBackfill: boolean;
}

/**
 * Given a column's SQL type, return a sensible default expression to use
 * when backfilling NULL values.
 */
export function getDefaultExpression(type: string, dbType: DatabaseType): string {
  const upper = type.toUpperCase();

  // Timestamp / datetime types
  if (
    upper.includes('TIMESTAMP') ||
    upper.includes('DATETIME') ||
    upper.includes('DATE')
  ) {
    return dbType === 'postgresql' ? 'NOW()' : dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  }

  // Boolean
  if (upper.includes('BOOL')) {
    return dbType === 'mysql' || dbType === 'mariadb' ? '0' : 'FALSE';
  }

  // Integer / numeric types
  if (
    upper.includes('INT') ||
    upper.includes('SERIAL') ||
    upper.includes('BIGINT') ||
    upper.includes('SMALLINT') ||
    upper.includes('NUMERIC') ||
    upper.includes('DECIMAL') ||
    upper.includes('REAL') ||
    upper.includes('DOUBLE') ||
    upper.includes('FLOAT')
  ) {
    return '0';
  }

  // JSON types
  if (upper.includes('JSON')) {
    return dbType === 'postgresql' ? "'{}'::jsonb" : "'{}'";
  }

  // Default: empty string
  return "''";
}

/**
 * Quote an identifier for the given database type.
 */
function escapeIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql' || dbType === 'mariadb') {
    return `\`${name.replace(/`/g, '``')}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Check which columns in a table contain NULL values.
 *
 * @param pool - Database client (Pool, mysql.Pool, or SqliteAdapter)
 * @param dbType - The database type
 * @param tableName - The table to check
 * @param columnChecks - Array of { columnName, type } to check for NULLs
 * @returns NullCheckResult with details about columns needing backfill
 */
export async function checkNulls(
  pool: any,
  dbType: DatabaseType,
  tableName: string,
  columnChecks: { columnName: string; type: string }[]
): Promise<NullCheckResult> {
  const tblEscaped = escapeIdentifier(tableName, dbType);
  const result: NullColumnInfo[] = [];

  for (const { columnName, type } of columnChecks) {
    const colEscaped = escapeIdentifier(columnName, dbType);

    let nullCount: number;
    try {
      nullCount = await countNulls(pool, dbType, tblEscaped, colEscaped);
    } catch {
      // If we can't query the table, skip this column — the ALTER will fail
      // naturally and the user will see the error.
      continue;
    }

    if (nullCount > 0) {
      const defaultExpr = getDefaultExpression(type, dbType);
      const backfillSql = `UPDATE ${tblEscaped} SET ${colEscaped} = ${defaultExpr} WHERE ${colEscaped} IS NULL;`;
      result.push({
        column: colEscaped,
        columnName,
        nullCount,
        type,
        backfillSql,
        description: `Set ${nullCount} NULL ${columnName} value(s) to ${defaultExpr}`,
      });
    }
  }

  return {
    columns: result,
    needsBackfill: result.length > 0,
  };
}

/**
 * Count the number of NULL values in a specific column.
 */
async function countNulls(
  pool: any,
  dbType: DatabaseType,
  tblEscaped: string,
  colEscaped: string
): Promise<number> {
  const sql = `SELECT COUNT(*) AS count FROM ${tblEscaped} WHERE ${colEscaped} IS NULL`;

  if (dbType === 'sqlite') {
    return new Promise<number>((resolve, reject) => {
      pool.get(sql, (err: Error | null, row: any) => {
        if (err) reject(err);
        else resolve(row?.count ?? 0);
      });
    });
  }

  if (dbType === 'postgresql') {
    const res = await pool.query(sql);
    return parseInt(res.rows[0]?.count, 10) || 0;
  }

  // MySQL / MariaDB
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(sql);
    return parseInt((rows as any[])[0]?.count, 10) || 0;
  } finally {
    connection.release();
  }
}
