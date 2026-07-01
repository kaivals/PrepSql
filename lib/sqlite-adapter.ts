import { createRequire } from "module";
import { createClient } from "@libsql/client/web";
const req = createRequire(import.meta.url);
const { DatabaseSync } = eval("req('node:sqlite')");

export interface SqliteAdapter {
  all: (
    sql: string,
    callback: (err: Error | null, rows: any[]) => void,
  ) => void;
  get: {
    (sql: string, callback: (err: Error | null, row: any) => void): void;
    (
      sql: string,
      params: any[],
      callback: (err: Error | null, row: any) => void,
    ): void;
  };
  run: (
    sql: string,
    callback: (this: { changes: number }, err: Error | null) => void,
  ) => void;
  exec: (sql: string, callback: (err: Error | null) => void) => void;
  close: (callback?: () => void) => void;
  _db: any;
}

export function openSqlite(filepath: string): SqliteAdapter {
  const db = new DatabaseSync(filepath);
  db.exec("PRAGMA foreign_keys = ON;");

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
    get(
      sql: string,
      paramsOrCallback: any | ((err: Error | null, row: any) => void),
      callback?: (err: Error | null, row: any) => void,
    ) {
      let cb: (err: Error | null, row: any) => void;
      let params: any[] = [];
      if (typeof paramsOrCallback === "function") {
        cb = paramsOrCallback;
      } else {
        params = paramsOrCallback;
        cb = callback!;
      }
      try {
        let row;
        if (Array.isArray(params) && params.length > 0) {
          if (sql.includes("$1")) {
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
  const db = new DatabaseSync(filepath);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function openLibSql(url: string, authToken?: string): SqliteAdapter {
  // Map 'libsql://' to 'https://' to ensure stable HTTP requests in serverless environments
  const httpsUrl = url.startsWith("libsql://")
    ? url.replace("libsql://", "https://")
    : url;

  const client = createClient({ url: httpsUrl, authToken });

  return {
    _db: client,
    all(sql: string, cb: (err: Error | null, rows: any[]) => void) {
      client
        .execute(sql)
        .then((res) => {
          const rows = res.rows.map((row) => {
            const obj: Record<string, any> = {};
            res.columns.forEach((col, idx) => {
              obj[col] = (row as any)[idx];
            });
            return obj;
          });
          cb(null, rows);
        })
        .catch((err) => cb(err, []));
    },
    get(
      sql: string,
      paramsOrCallback: any | ((err: Error | null, row: any) => void),
      callback?: (err: Error | null, row: any) => void,
    ) {
      let cb: (err: Error | null, row: any) => void;
      let params: any[] = [];
      if (typeof paramsOrCallback === "function") {
        cb = paramsOrCallback;
      } else {
        params = paramsOrCallback;
        cb = callback!;
      }

      let args: any = params;
      if (Array.isArray(params) && params.length > 0 && sql.includes("$1")) {
        const bindParams: Record<string, any> = {};
        params.forEach((val, idx) => {
          bindParams[`$${idx + 1}`] = val;
        });
        args = bindParams;
      }

      client
        .execute({ sql, args })
        .then((res) => {
          if (res.rows.length === 0) return cb(null, null);
          const obj: Record<string, any> = {};
          res.columns.forEach((col, idx) => {
            obj[col] = (res.rows[0] as any)[idx];
          });
          cb(null, obj);
        })
        .catch((err) => cb(err, null));
    },
    run(
      sql: string,
      cb: (this: { changes: number }, err: Error | null) => void,
    ) {
      client
        .execute(sql)
        .then((res) => cb.call({ changes: Number(res.rowsAffected) }, null))
        .catch((err) => cb.call({ changes: 0 }, err));
    },
    exec(sql: string, cb: (err: Error | null) => void) {
      client
        .executeMultiple(sql)
        .then(() => cb(null))
        .catch((err) => cb(err));
    },
    close(cb?: () => void) {
      try {
        client.close();
      } catch {}
      cb?.();
    },
  };
}
