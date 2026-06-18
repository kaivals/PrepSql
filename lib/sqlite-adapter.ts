import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const { DatabaseSync } = eval("req('node:sqlite')");

export interface SqliteAdapter {
  all: (sql: string, callback: (err: Error | null, rows: any[]) => void) => void;
  get: {
    (sql: string, callback: (err: Error | null, row: any) => void): void;
    (sql: string, params: any[], callback: (err: Error | null, row: any) => void): void;
  };
  run: (sql: string, callback: (this: { changes: number }, err: Error | null) => void) => void;
  exec: (sql: string, callback: (err: Error | null) => void) => void;
  close: (callback?: () => void) => void;
  _db: any;
}

export function openSqlite(filepath: string): SqliteAdapter {
  const db = new DatabaseSync(filepath);

  return {
    _db: db,
    all(sql, cb) {
      try {
        const rows = db.prepare(sql).all() as any[];
        cb(null, rows);
      } catch (err) {
        cb(err as Error, []);
      }
    },
    get(sql: string, paramsOrCallback: any | ((err: Error | null, row: any) => void), callback?: (err: Error | null, row: any) => void) {
      let cb: (err: Error | null, row: any) => void;
      let params: any[] = [];
      if (typeof paramsOrCallback === 'function') {
        cb = paramsOrCallback;
      } else {
        params = paramsOrCallback;
        cb = callback!;
      }
      try {
        let row;
        if (Array.isArray(params) && params.length > 0) {
          if (sql.includes('$1')) {
            const bindParams: Record<string, any> = {};
            params.forEach((val, idx) => {
              bindParams[`$${idx + 1}`] = val;
            });
            row = db.prepare(sql).get(bindParams);
          } else {
            row = db.prepare(sql).get(...params);
          }
        } else {
          row = db.prepare(sql).get();
        }
        cb(null, row);
      } catch (err) {
        cb(err as Error, null);
      }
    },
    run(sql, cb) {
      try {
        const result = db.prepare(sql).run();
        cb.call({ changes: Number(result.changes) }, null);
      } catch (err) {
        cb.call({ changes: 0 }, err as Error);
      }
    },
    exec(sql, cb) {
      try {
        db.exec(sql);
        cb(null);
      } catch (err) {
        cb(err as Error);
      }
    },
    close(cb) {
      db.close();
      cb?.();
    },
  };
}

export function openSqliteSync(filepath: string): any {
  return new DatabaseSync(filepath);
}
