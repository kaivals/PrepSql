import { DatabaseSync } from 'node:sqlite';

export interface SqliteAdapter {
  all: (sql: string, callback: (err: Error | null, rows?: Record<string, unknown>[]) => void) => void;
  get: (sql: string, callback: (err: Error | null, row?: Record<string, unknown>) => void) => void;
  run: (sql: string, callback: (this: { changes: number }, err: Error | null) => void) => void;
  close: (callback?: () => void) => void;
  _db: DatabaseSync;
}

export function openSqlite(filepath: string): SqliteAdapter {
  const db = new DatabaseSync(filepath);

  return {
    _db: db,
    all(sql, cb) {
      try {
        const rows = db.prepare(sql).all() as Record<string, unknown>[];
        cb(null, rows);
      } catch (err) {
        cb(err as Error);
      }
    },
    get(sql, cb) {
      try {
        const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
        cb(null, row);
      } catch (err) {
        cb(err as Error);
      }
    },
    run(sql, cb) {
      try {
        const result = db.prepare(sql).run();
        cb.call({ changes: result.changes }, null);
      } catch (err) {
        cb.call({ changes: 0 }, err as Error);
      }
    },
    close(cb) {
      db.close();
      cb?.();
    },
  };
}

export function openSqliteSync(filepath: string): DatabaseSync {
  return new DatabaseSync(filepath);
}
