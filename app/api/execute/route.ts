import { NextRequest, NextResponse } from 'next/server';
import { getConnection, addToHistory } from '@/lib/session';
import { getOrCreatePool, executeQuery } from '@/lib/database';

export async function POST(request: NextRequest) {
  let sql = '';
  try {
    const body = await request.json();
    sql = body.sql;

    if (!sql || typeof sql !== 'string') {
      return NextResponse.json({ error: 'SQL is required' }, { status: 400 });
    }

    // Get current connection
    const connection = await getConnection();
    if (!connection) {
      return NextResponse.json(
        { error: 'No database connection. Please connect first.' },
        { status: 400 }
      );
    }

    // Get or create connection pool
    const pool = await getOrCreatePool(connection);

    // Execute the query with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout (30s)')), 30000)
    );

    let result;
    try {
      result = await Promise.race([executeQuery(pool, sql), timeoutPromise]);
    } catch (timeoutError) {
      throw timeoutError;
    }

    // Limit results to 1000 rows
    if (result.rows.length > 1000) {
      result.rows = result.rows.slice(0, 1000);
    }

    // Add to history
    await addToHistory({
      prompt: '',
      sql,
      timestamp: Date.now(),
      success: true,
      rowsAffected: result.rowsAffected,
    });

    return NextResponse.json({
      columns: result.columns,
      rows: result.rows,
      rowsAffected: result.rowsAffected || 0,
      rowCount: result.rows.length,
      truncated: result.rows.length > 1000,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute query';

    const connection = await getConnection();
    if (connection && sql) {
      await addToHistory({
        prompt: '',
        sql,
        timestamp: Date.now(),
        success: false,
        error: errorMessage,
      });
    }

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
