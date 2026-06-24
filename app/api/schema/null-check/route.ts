import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/app-state';
import { getOrCreatePool } from '@/lib/database';
import { checkNulls, type NullCheckResult } from '@/lib/null-check';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table, columns } = body;

    if (!table || !Array.isArray(columns) || columns.length === 0) {
      return NextResponse.json(
        { error: 'Table name and columns array are required' },
        { status: 400 }
      );
    }

    const connection = await getConnection();
    if (!connection) {
      return NextResponse.json(
        { error: 'No database connection. Please connect first.' },
        { status: 400 }
      );
    }

    const pool = await getOrCreatePool(connection);
    const columnChecks = columns.map((c: { columnName: string; type: string }) => ({
      columnName: c.columnName,
      type: c.type,
    }));

    const result: NullCheckResult = await checkNulls(
      pool,
      connection.type,
      table,
      columnChecks
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check for NULL values';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
