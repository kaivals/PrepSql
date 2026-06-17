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
    const columns: any[] = await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info("${table.name}")`, (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const fks: any[] = await new Promise((resolve, reject) => {
      db.all(`PRAGMA foreign_key_list("${table.name}")`, (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const fkMap = new Map<string, { table: string; column: string }>();
    fks.forEach((fk) => {
      fkMap.set(fk.from, { table: fk.table, column: fk.to });
    });

    const indexesList: { name: string; unique: number }[] = await new Promise((resolve, reject) => {
      db.all(`PRAGMA index_list("${table.name}")`, (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const uniqueCols = new Set<string>();
    for (const idx of indexesList) {
      if (idx.unique === 1) {
        const idxCols: any[] = await new Promise((resolve, reject) => {
          db.all(`PRAGMA index_info("${idx.name}")`, (err: Error | null, rows: any[]) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
        idxCols.forEach((col) => {
          uniqueCols.add(col.name);
        });
      }
    }

    const sqlRow: any = await new Promise((resolve, reject) => {
      db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name=$1`, [table.name], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    const tableSql = (sqlRow?.sql || '').toLowerCase();

    const countRow: { count: number } = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as count FROM "${table.name}"`, (err: Error | null, row: { count: number }) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    result.push({
      name: table.name,
      columns: columns.map((c) => {
        const isPk = c.pk > 0;
        const isAuto = isPk && tableSql.includes('autoincrement');
        return {
          name: c.name,
          type: c.type,
          nullable: c.notnull === 0,
          defaultValue: c.dflt_value,
          primaryKey: isPk,
          unique: uniqueCols.has(c.name),
          autoIncrement: isAuto,
          foreignKey: fkMap.get(c.name) || null,
        };
      }),
      rowCount: countRow?.count ?? 0,
      indexes: indexesList.map((i) => i.name),
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
      `SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default,
          (SELECT EXISTS(
              SELECT 1 FROM information_schema.table_constraints tc 
              JOIN information_schema.key_column_usage kcu 
                  ON tc.constraint_name = kcu.constraint_name
              WHERE tc.table_schema = 'public' 
                  AND tc.table_name = c.table_name 
                  AND kcu.column_name = c.column_name 
                  AND tc.constraint_type = 'PRIMARY KEY'
          )) AS is_primary,
          (SELECT EXISTS(
              SELECT 1 FROM information_schema.table_constraints tc 
              JOIN information_schema.key_column_usage kcu 
                  ON tc.constraint_name = kcu.constraint_name
              WHERE tc.table_schema = 'public' 
                  AND tc.table_name = c.table_name 
                  AND kcu.column_name = c.column_name 
                  AND tc.constraint_type = 'UNIQUE'
          )) AS is_unique,
          (column_default LIKE 'nextval(%' OR column_default LIKE 'identity%') AS is_identity
       FROM information_schema.columns c
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );

    const fksResult = await pool.query(
      `SELECT 
          kcu.column_name, 
          ccu.table_name AS foreign_table, 
          ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc 
       JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_schema = 'public' 
          AND tc.table_name = $1`,
      [tableName]
    );

    const fkMap = new Map<string, { table: string; column: string }>();
    fksResult.rows.forEach((fk: any) => {
      fkMap.set(fk.column_name, { table: fk.foreign_table, column: fk.foreign_column });
    });

    const quotedTable = quotePgTable(tableName);
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quotedTable}`);

    const indexesResult = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
      [tableName]
    );

    result.push({
      name: tableName,
      columns: columnsResult.rows.map((c: any) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        defaultValue: c.column_default,
        primaryKey: c.is_primary,
        unique: c.is_unique,
        autoIncrement: c.is_identity,
        foreignKey: fkMap.get(c.column_name) || null,
      })),
      rowCount: countResult.rows[0]?.count ?? 0,
      indexes: indexesResult.rows.map((i: { indexname: string }) => i.indexname),
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

      const [columns] = await connection.query(
        `SELECT 
            COLUMN_NAME, 
            DATA_TYPE, 
            IS_NULLABLE, 
            COLUMN_DEFAULT, 
            COLUMN_KEY, 
            EXTRA
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [tableName]
      );

      const [fks] = await connection.query(
        `SELECT 
            COLUMN_NAME, 
            REFERENCED_TABLE_NAME AS foreign_table, 
            REFERENCED_COLUMN_NAME AS foreign_column
         FROM information_schema.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = ? 
            AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [tableName]
      );

      const fkMap = new Map<string, { table: string; column: string }>();
      (fks as any[]).forEach((fk) => {
        fkMap.set(fk.COLUMN_NAME, { table: fk.foreign_table, column: fk.foreign_column });
      });

      const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      const count = (countRows as { count: number }[])[0]?.count ?? 0;

      const [indexesRows] = await connection.query(`SHOW INDEX FROM \`${tableName}\``);
      const indexNames = Array.from(new Set((indexesRows as any[]).map((r) => r.Key_name)));

      result.push({
        name: tableName,
        columns: (columns as any[]).map((c) => ({
          name: c.COLUMN_NAME,
          type: c.DATA_TYPE,
          nullable: c.IS_NULLABLE === 'YES',
          defaultValue: c.COLUMN_DEFAULT,
          primaryKey: c.COLUMN_KEY === 'PRI',
          unique: c.COLUMN_KEY === 'UNI',
          autoIncrement: c.EXTRA.includes('auto_increment'),
          foreignKey: fkMap.get(c.COLUMN_NAME) || null,
        })),
        rowCount: typeof count === 'number' ? count : parseInt(String(count), 10),
        indexes: indexNames,
      });
    }

    return result;
  } finally {
    connection.release();
  }
}
