import type { DatabaseConnection, SchemaTable } from './types';
import { getOrCreatePool } from './database';
import type { SqliteAdapter } from './sqlite-adapter';
import { quotePgTable } from './pg-identifiers';

export async function introspectSchema(connection: DatabaseConnection): Promise<SchemaTable[]> {
  const pool = await getOrCreatePool(connection);

  if (connection.type === 'sqlite') {
    return introspectSQLite(pool);
  }
  if (connection.type === 'postgresql') {
    return introspectPostgres(pool);
  }
  return introspectMySQL(pool);
}

async function introspectSQLite(db: SqliteAdapter): Promise<SchemaTable[]> {
  const tables: { name: string }[] = await new Promise((resolve, reject) => {
    db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      (err: Error | null, rows: { name: string }[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  const result: SchemaTable[] = [];

  for (const table of tables) {
    const columns: { name: string; type: string }[] = await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(${table.name})`, (err: Error | null, rows: { name: string; type: string }[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const countRow: { count: number } = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as count FROM ${table.name}`, (err: Error | null, row: { count: number }) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    result.push({
      name: table.name,
      columns: columns.map((c) => ({ name: c.name, type: c.type })),
      rowCount: countRow?.count ?? 0,
    });
  }

  return result;
}

async function introspectPostgres(pool: any): Promise<SchemaTable[]> {
  const tablesResult = await pool.query(`
    SELECT tablename AS table_name
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  const result: SchemaTable[] = [];

  for (const row of tablesResult.rows) {
    const tableName = row.table_name as string;

    const columnsResult = await pool.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );

    const quotedTable = quotePgTable(tableName);
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quotedTable}`);

    result.push({
      name: tableName,
      columns: columnsResult.rows.map((c: { column_name: string; data_type: string }) => ({
        name: c.column_name,
        type: c.data_type,
      })),
      rowCount: countResult.rows[0]?.count ?? 0,
    });
  }

  return result;
}

async function introspectMySQL(pool: any): Promise<SchemaTable[]> {
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query('SHOW TABLES');
    const tableKey = Object.keys((tables as object[])[0] || {})[0] || 'Tables_in_db';
    const result: SchemaTable[] = [];

    for (const row of tables as Record<string, string>[]) {
      const tableName = row[tableKey];

      const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
      const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      const count = (countRows as { count: number }[])[0]?.count ?? 0;

      result.push({
        name: tableName,
        columns: (columns as { Field: string; Type: string }[]).map((c) => ({
          name: c.Field,
          type: c.Type,
        })),
        rowCount: typeof count === 'number' ? count : parseInt(String(count), 10),
      });
    }

    return result;
  } finally {
    connection.release();
  }
}
