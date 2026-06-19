import { NextRequest, NextResponse } from 'next/server';
import { addToHistory } from '@/lib/app-state';

/**
 * POST /api/history/sync
 *
 * Server-side persistence target for the client HistoryQueue. The client
 * enqueues every executed query into localStorage and drains it here, one
 * record at a time. Returning a non-2xx status keeps the record in the queue
 * so the client retries automatically — no history is lost on transient
 * failures.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { item } = body ?? {};

    if (!item || typeof item !== 'object' || typeof item.sql !== 'string') {
      return NextResponse.json({ error: 'Invalid history item' }, { status: 400 });
    }

    await addToHistory({
      prompt: item.prompt || '',
      sql: item.sql,
      timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
      success: !!item.success,
      error: item.error || undefined,
      queryType: item.queryType,
      connectionId: item.connectionId,
      connectionName: item.connectionName,
      rowsAffected: item.rowsAffected,
      executionTime: item.executionTime,
      rowsScanned: item.rowsScanned,
      rowsReturned: item.rowsReturned,
      cpuUsage: item.cpuUsage,
      memoryUsage: item.memoryUsage,
      indexesUsed: item.indexesUsed,
      timeline: item.timeline,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync history' },
      { status: 500 },
    );
  }
}
