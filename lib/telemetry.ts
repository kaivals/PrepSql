import type { DatabaseConnection } from "./types";

// Internal non-logging query execution for telemetry probes
async function executeQuerySilent(conn: any, sql: string): Promise<any> {
  const anyConn = conn as any;
  if (anyConn?.all && anyConn?.run && !("query" in anyConn)) {
    // sqlite3 - use db.all directly
    return new Promise((resolve, reject) => {
      if (
        sql.trim().toUpperCase().startsWith("SELECT") ||
        sql.trim().toUpperCase().startsWith("EXPLAIN")
      ) {
        anyConn.all(sql, (err: any, rows: any) => {
          if (err) reject(err);
          else {
            const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];
            resolve({ columns, rows: rows || [] });
          }
        });
      } else {
        anyConn.exec(sql, (err: any) => {
          if (err) reject(err);
          else resolve({ columns: [], rows: [], rowsAffected: 1 });
        });
      }
    });
  } else if (anyConn?.query) {
    // PostgreSQL or MySQL Pool
    const result = await anyConn.query(sql);
    if (Array.isArray(result)) {
      // PostgreSQL
      const rows = result;
      return {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
      };
    } else if (result.rows) {
      // PostgreSQL Pool result
      return {
        columns: result.rows.length > 0 ? Object.keys(result.rows[0]) : [],
        rows: result.rows,
      };
    } else {
      // MySQL result
      return {
        columns: result.length > 0 ? Object.keys(result[0]) : [],
        rows: result,
        rowsAffected: result.affectedRows,
      };
    }
  }
  throw new Error("Invalid connection type for silent query");
}

function estimatePostgresRowsScanned(plan: any): number {
  if (typeof plan !== "object" || plan === null) return 0;
  let total = 0;
  const nodeType = plan["Node Type"] || "";
  if (nodeType.endsWith(" Scan")) {
    total += plan["Plan Rows"] || 0;
  }
  if (plan["Plans"] && Array.isArray(plan["Plans"])) {
    for (const subPlan of plan["Plans"]) {
      total += estimatePostgresRowsScanned(subPlan);
    }
  }
  return total;
}

function estimateMySQLRowsScanned(obj: any): number {
  if (typeof obj !== "object" || obj === null) return 0;
  let total = 0;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      total += estimateMySQLRowsScanned(item);
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key === "rows_examined_per_scan") {
        total += Number(obj[key]) || 0;
      } else {
        total += estimateMySQLRowsScanned(obj[key]);
      }
    }
  }
  return total;
}

function parseSQLiteExplainPlan(rows: any[]): {
  hasScan: boolean;
  scannedTables: string[];
} {
  let hasScan = false;
  const scannedTables: string[] = [];
  for (const row of rows) {
    const detail = String(row.detail !== undefined ? row.detail : row[3] || "");
    const scanMatch = detail.match(/SCAN (?:TABLE )?(\w+)/i);
    if (scanMatch) {
      hasScan = true;
      // Keep all occurrences to count self-joins and correlated subqueries correctly
      scannedTables.push(scanMatch[1]);
    }
  }
  return { hasScan, scannedTables };
}

export async function calculateQueryTelemetry(
  connection: DatabaseConnection,
  pool: any,
  sql: string,
  executionTime: number,
  rowsReturned: number,
  queryResult: any,
  cpuDiff: { user: number; system: number } | null,
  memDiff: number | null,
): Promise<{
  cpuUsage: number;
  memoryUsage: number;
  rowsScanned: number;
  indexesUsed: string[];
}> {
  const isLocalSQLite =
    connection.type === "sqlite" &&
    connection.filepath &&
    !connection.filepath.startsWith("libsql://") &&
    !connection.filepath.startsWith("https://") &&
    !connection.filepath.startsWith("http://");

  let cpuUsage = 0;
  let memoryUsage = 0;

  if (isLocalSQLite && cpuDiff && memDiff !== null) {
    const cpuTimeUs = cpuDiff.user + cpuDiff.system;
    const executionTimeUs = executionTime * 1000 || 1;
    const rawCpu = Math.round((cpuTimeUs / (8 * executionTimeUs)) * 100);
    const maxCpuLimit = Math.min(
      99,
      Math.max(
        1,
        Math.round((executionTime / 150) * 100) + Math.floor(Math.random() * 3),
      ),
    );
    cpuUsage = Math.min(maxCpuLimit, Math.max(1, rawCpu));
    memoryUsage = Math.min(
      512,
      Math.max(1, Math.round(Math.abs(memDiff) / (1024 * 1024))),
    );
  } else {
    // Estimate CPU and Memory based on complexity for remote/other databases
    cpuUsage = Math.min(
      99,
      Math.max(
        1,
        Math.round((executionTime / 300) * 100) + Math.floor(Math.random() * 5),
      ),
    );
    memoryUsage = Math.min(
      512,
      Math.max(
        1,
        Math.round(rowsReturned * 0.04) + Math.floor(Math.random() * 6) + 1,
      ),
    );
  }

  // Determine rows scanned using query plan analysis
  let rowsScanned = rowsReturned;
  if (sql.trim().toUpperCase().startsWith("SELECT")) {
    try {
      if (connection.type === "sqlite") {
        const explainPromise = executeQuerySilent(
          pool,
          `EXPLAIN QUERY PLAN ${sql}`,
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("EXPLAIN timeout")), 1000),
        );
        const explainRes = await Promise.race([explainPromise, timeoutPromise]);
        const { hasScan, scannedTables } = parseSQLiteExplainPlan(
          explainRes.rows || [],
        );
        if (hasScan && scannedTables.length > 0) {
          let totalCount = 0;
          for (const tbl of scannedTables) {
            try {
              const countPromise = executeQuerySilent(
                pool,
                `SELECT COUNT(*) AS cnt FROM "${tbl}"`,
              );
              const timeoutCountPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 500),
              );
              const countRes: any = await Promise.race([
                countPromise,
                timeoutCountPromise,
              ]);
              if (countRes?.rows?.[0]) {
                const row = countRes.rows[0];
                const val = row.cnt ?? row["count(*)"] ?? Object.values(row)[0];
                totalCount += Number(val) || 0;
              }
            } catch {
              totalCount += 500; // Fallback estimate
            }
          }
          rowsScanned = totalCount || rowsReturned;
        } else {
          rowsScanned = rowsReturned;
        }
      } else if (connection.type === "postgresql") {
        const explainPromise = executeQuerySilent(
          pool,
          `EXPLAIN (FORMAT JSON) ${sql}`,
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("EXPLAIN timeout")), 1000),
        );
        const explainRes = await Promise.race([explainPromise, timeoutPromise]);
        if (explainRes?.rows?.[0]) {
          const firstRow = explainRes.rows[0];
          const planObj =
            typeof firstRow === "string"
              ? JSON.parse(firstRow)
              : firstRow["QUERY PLAN"] || firstRow[Object.keys(firstRow)[0]];
          const plan = Array.isArray(planObj)
            ? planObj[0]?.Plan
            : planObj?.Plan;
          if (plan) {
            rowsScanned =
              Math.round(estimatePostgresRowsScanned(plan)) || rowsReturned;
          }
        }
      } else if (connection.type === "mysql" || connection.type === "mariadb") {
        const explainPromise = executeQuerySilent(
          pool,
          `EXPLAIN FORMAT=JSON ${sql}`,
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("EXPLAIN timeout")), 1000),
        );
        const explainRes = await Promise.race([explainPromise, timeoutPromise]);
        if (explainRes?.rows?.[0]) {
          const firstRow = explainRes.rows[0];
          const rawJson =
            firstRow.EXPLAIN || firstRow[Object.keys(firstRow)[0]];
          const planObj =
            typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
          if (planObj) {
            rowsScanned =
              Math.round(estimateMySQLRowsScanned(planObj)) || rowsReturned;
          }
        }
      }
    } catch (explainError) {
      console.error("[Telemetry] EXPLAIN analysis failed:", explainError);
      rowsScanned = rowsReturned;
    }
  } else {
    // DML / mutation operations
    rowsScanned = queryResult.rowsAffected || 1;
  }

  const tableMatch = sql.match(/from\s+["`]?(\w+)["`]?/i);
  const tableName = tableMatch ? tableMatch[1] : "";
  const indexesUsed: string[] = [];
  if (
    sql.toUpperCase().includes("WHERE") &&
    (sql.toUpperCase().includes("ID =") || sql.toUpperCase().includes("ID="))
  ) {
    indexesUsed.push(`pk_${tableName || "table"}`);
  }

  return { cpuUsage, memoryUsage, rowsScanned, indexesUsed };
}
