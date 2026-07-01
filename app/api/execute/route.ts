import { NextRequest, NextResponse } from "next/server";
import { getConnection, addToHistory } from "@/lib/app-state";
import { getOrCreatePool, executeQuery } from "@/lib/database";
import { runWithQueryLogger, getLoggedSteps } from "@/lib/query-logger";
import { classifyQuery } from "@/lib/history-classify";
import { calculateQueryTelemetry } from "@/lib/telemetry";

export async function POST(request: NextRequest) {
  const { result, steps } = await runWithQueryLogger(async () => {
    let sql = "";
    try {
      const body = await request.json();
      sql = body.sql;

      if (!sql || typeof sql !== "string") {
        return { error: "SQL is required", status: 400 };
      }

      // Get current connection
      const connection = await getConnection();
      if (!connection) {
        return {
          error: "No database connection. Please connect first.",
          status: 400,
        };
      }

      // Get or create connection pool
      const pool = await getOrCreatePool(connection);

      // Execute the query with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout (30s)")), 30000),
      );

      const isLocalSQLite =
        connection.type === "sqlite" &&
        connection.filepath &&
        !connection.filepath.startsWith("libsql://") &&
        !connection.filepath.startsWith("https://") &&
        !connection.filepath.startsWith("http://");

      const startCpu = isLocalSQLite ? process.cpuUsage() : null;
      const startMem = isLocalSQLite ? process.memoryUsage().heapUsed : null;

      const startTime = performance.now();
      let queryResult: any;
      try {
        queryResult = await Promise.race([
          executeQuery(pool, sql),
          timeoutPromise,
        ]);
      } catch (timeoutError) {
        throw timeoutError;
      }
      const executionTime = Math.round(performance.now() - startTime);

      // Limit results to 1000 rows
      const originalRowCount = queryResult.rows ? queryResult.rows.length : 0;
      if (queryResult.rows && queryResult.rows.length > 1000) {
        queryResult.rows = queryResult.rows.slice(0, 1000);
      }

      const rowsReturned = queryResult.rows ? queryResult.rows.length : 0;

      const cpuDiff = isLocalSQLite ? process.cpuUsage(startCpu!) : null;
      const memDiff = isLocalSQLite
        ? process.memoryUsage().heapUsed - startMem!
        : null;

      const { cpuUsage, memoryUsage, rowsScanned, indexesUsed } =
        await calculateQueryTelemetry(
          connection,
          pool,
          sql,
          executionTime,
          rowsReturned,
          queryResult,
          cpuDiff,
          memDiff,
        );

      const timeline = getLoggedSteps();

      // Persist this execution to MongoDB as query history — the single
      // source of truth for the History sidebar and the Analytics tab.
      await addToHistory({
        prompt: "",
        sql,
        timestamp: Date.now(),
        success: true,
        queryType: classifyQuery(sql),
        connectionId: connection.id,
        connectionName: connection.name,
        rowsAffected: queryResult.rowsAffected || 0,
        executionTime,
        rowsScanned,
        rowsReturned,
        cpuUsage,
        memoryUsage,
        indexesUsed,
        timeline,
      });

      return {
        response: {
          columns: queryResult.columns,
          rows: queryResult.rows,
          rowsAffected: queryResult.rowsAffected || 0,
          rowCount: queryResult.rows.length,
          truncated: originalRowCount > 1000,
          executionTime,
          rowsScanned,
          cpuUsage,
          memoryUsage,
          indexesUsed,
          timeline,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to execute query";
      console.error("[api/execute] execution failed:", errorMessage);

      // Persist failed executions too, so they appear in history.
      if (sql) {
        try {
          const connection = await getConnection();
          await addToHistory({
            prompt: "",
            sql,
            timestamp: Date.now(),
            success: false,
            error: errorMessage,
            queryType: classifyQuery(sql),
            connectionId: connection?.id,
            connectionName: connection?.name,
            executionTime: 0,
            timeline: getLoggedSteps(),
          });
        } catch {
          // Don't let history persistence mask the original error.
        }
      }

      return { error: errorMessage, status: 400 };
    }
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json(result.response);
}
