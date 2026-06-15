import { Pool } from 'pg';
import mysql from 'mysql2/promise';
import type { DatabaseConnection } from './types';
import { openSqlite, type SqliteAdapter } from './sqlite-adapter';

type DatabaseConnectionConfig = Omit<DatabaseConnection, 'id'>;

type DatabaseClient = SqliteAdapter | Pool | mysql.Pool | null;

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

async function connectSQLite(filepath: string): Promise<SqliteAdapter> {
  const dbPath = filepath === ':memory:' ? ':memory:' : filepath;
  return openSqlite(dbPath);
}

// PostgreSQL connection
function connectPostgreSQL(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Pool {
  return new Pool(config);
}

// MySQL/MariaDB connection
async function connectMySQL(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<mysql.Pool> {
  return mysql.createPool(config);
}

export async function createConnection(config: DatabaseConnectionConfig): Promise<DatabaseClient> {
  try {
    if (config.type === 'sqlite') {
      if (!config.filepath) throw new Error('Filepath required for SQLite');
      return await connectSQLite(config.filepath);
    } else if (config.type === 'postgresql') {
      const pgConfig = {
        host: config.host!,
        port: config.port || 5432,
        user: config.user!,
        password: typeof config.password === 'string' ? config.password : '',
        database: config.database!,
      };
      console.log('[v0] Connecting to PostgreSQL:', { host: pgConfig.host, port: pgConfig.port, user: pgConfig.user, database: pgConfig.database });
      return connectPostgreSQL(pgConfig);
    } else if (config.type === 'mysql' || config.type === 'mariadb') {
      return await connectMySQL({
        host: config.host!,
        port: config.port || 3306,
        user: config.user!,
        password: config.password || '',
        database: config.database!,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[v0] Connection error:', msg);
    throw new Error(`Failed to connect: ${msg}`);
  }
}

export async function testConnection(config: DatabaseConnectionConfig): Promise<boolean> {
  let conn: DatabaseClient = null;
  try {
    conn = await createConnection(config);

    if (config.type === 'sqlite') {
      return await new Promise((resolve) => {
        (conn as SqliteAdapter).get('SELECT 1', (err) => {
          resolve(!err);
        });
      });
    } else if (config.type === 'postgresql' && conn instanceof Pool) {
      await (conn as Pool).query('SELECT 1');
      return true;
    } else if ((config.type === 'mysql' || config.type === 'mariadb') && conn instanceof Object) {
      const pool = conn as mysql.Pool;
      const connection = await pool.getConnection();
      await connection.query('SELECT 1');
      connection.release();
      return true;
    }
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[v0] Connection test failed:', msg);
    throw new Error(msg);
  } finally {
    if (config.type === 'sqlite') {
      (conn as SqliteAdapter).close();
    } else if (config.type === 'postgresql' && conn instanceof Pool) {
      await (conn as Pool).end().catch(() => {});
    } else if ((config.type === 'mysql' || config.type === 'mariadb') && conn instanceof Object) {
      const pool = conn as mysql.Pool;
      await pool.end().catch(() => {});
    }
  }
}

export async function executeQuery(conn: DatabaseClient, sql: string): Promise<QueryResult> {
  try {
    if (conn?.all && conn?.run && !('query' in conn)) {
      // sqlite3 duck typing
      return await executeSQLiteQuery(conn, sql);
    } else if (conn instanceof Pool) {
      return await executePostgresQuery(conn, sql);
    } else if (conn?.getConnection) {
      // mysql.Pool duck typing
      return await executeMySQLQuery(conn as mysql.Pool, sql);
    }
    throw new Error('Invalid connection type');
  } catch (error) {
    throw new Error(`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function executeSQLiteQuery(db: SqliteAdapter, sql: string): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    // Check if it's a SELECT query
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      db.all(sql, (err: any, rows: any) => {
        if (err) reject(err);
        else {
          const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];
          resolve({ columns, rows: rows || [] });
        }
      });
    } else {
      db.run(sql, function (this: { changes: number }, err: Error | null) {
        if (err) reject(err);
        else {
          resolve({
            columns: [],
            rows: [],
            rowsAffected: this.changes,
          });
        }
      });
    }
  });
}

async function executePostgresQuery(pool: Pool, sql: string): Promise<QueryResult> {
  const result = await pool.query(sql);
  const columns = result.fields ? result.fields.map((f) => f.name) : [];
  return {
    columns,
    rows: result.rows || [],
    rowsAffected: result.rowCount || 0,
  };
}

async function executeMySQLQuery(pool: mysql.Pool, sql: string): Promise<QueryResult> {
  const connection = await pool.getConnection();
  try {
    const [rows, fields] = await connection.query(sql);
    const columns = Array.isArray(fields) ? fields.map((f: any) => f.name) : [];
    return {
      columns,
      rows: Array.isArray(rows) ? rows : [],
      rowsAffected: Array.isArray(rows) ? rows.length : 0,
    };
  } finally {
    connection.release();
  }
}

// Connection pool management (for reuse)
const pools = new Map<string, DatabaseClient>();

export function getPoolKey(config: DatabaseConnectionConfig): string {
  if (config.type === 'sqlite') {
    return `sqlite:${config.filepath}`;
  }
  return `${config.type}:${config.host}:${config.port}:${config.database}`;
}

export async function getOrCreatePool(config: DatabaseConnectionConfig): Promise<DatabaseClient> {
  const key = getPoolKey(config);

  if (pools.has(key)) {
    return pools.get(key)!;
  }

  const conn = await createConnection(config);
  pools.set(key, conn);
  return conn;
}

export function closePool(config: DatabaseConnectionConfig): void {
  const key = getPoolKey(config);
  const conn = pools.get(key);

  if (conn) {
    if (conn && 'all' in conn && 'run' in conn) {
      (conn as SqliteAdapter).close();
    } else if (conn instanceof Pool) {
      (conn as Pool).end();
    } else if (conn?.end) {
      // mysql.Pool
      (conn as mysql.Pool).end();
    }
    pools.delete(key);
  }
}
