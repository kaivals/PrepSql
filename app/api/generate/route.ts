import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import {
  getClientId,
  getPendingTimeline,
  setPendingTimeline,
  clearPendingTimeline,
  addToHistory,
  getConnection,
} from '@/lib/app-state';
import { runWithQueryLogger } from '@/lib/query-logger';
import { classifyQuery } from '@/lib/history-classify';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, action } = body;

    if (!prompt && !action) {
      return NextResponse.json({ error: 'Prompt or action is required' }, { status: 400 });
    }

    const clientId = await getClientId();
    const connection = await getConnection();
    const threadId = connection ? `${clientId}-${connection.id}` : clientId;

    // Fetch previous steps if we are resuming from an approval/rejection
    const previousSteps = action ? (await getPendingTimeline() || []) : [];

    const { result: response, steps } = await runWithQueryLogger(async () => {
      return await runAgent({
        prompt: prompt || '',
        threadId,
        action,
      });
    });

    const allSteps = [...previousSteps, ...steps];

    if (response) {
      if (response.type === 'pending_approval') {
        // Store steps for the next approval/rejection action
        await setPendingTimeline(allSteps);
      } else if (action === 'reject') {
        await clearPendingTimeline();
      } else if (response.type === 'sql') {
        const rowsCount = response.result?.rows?.length ?? 0;
        // Persist this AI-generated execution to MongoDB as query history.
        await addToHistory({
          prompt: prompt || 'AI Query',
          sql: response.sql || '',
          timestamp: Date.now(),
          success: true,
          queryType: classifyQuery(response.sql || ''),
          executionTime: response.result?.executionTime || 0,
          rowsAffected: response.result?.rowsAffected || 0,
          rowsScanned: response.result?.rowsScanned || rowsCount,
          rowsReturned: response.result?.rowsReturned || rowsCount,
          cpuUsage: response.result?.cpuUsage || 0,
          memoryUsage: response.result?.memoryUsage || 0,
          indexesUsed: response.result?.indexesUsed || (response.sql?.toUpperCase().includes('WHERE') ? ['pk_index'] : []),
          timeline: allSteps,
          connectionId: connection?.id,
          connectionName: connection?.name,
        });
        await clearPendingTimeline();
      } else if (response.type === 'error') {
        // Failed queries are recorded as well so they appear in history.
        await addToHistory({
          prompt: prompt || 'AI Query',
          sql: response.sql || '',
          timestamp: Date.now(),
          success: false,
          error: response.message || 'Execution failed',
          queryType: classifyQuery(response.sql || ''),
          executionTime: 0,
          rowsScanned: 0,
          rowsReturned: 0,
          cpuUsage: 0,
          memoryUsage: 0,
          indexesUsed: [],
          timeline: allSteps,
          connectionId: connection?.id,
          connectionName: connection?.name,
        });
        await clearPendingTimeline();
      }
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Agent execution/generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agent execution failed' },
      { status: 500 }
    );
  }
}
