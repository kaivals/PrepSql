import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import {
  getSessionId,
  addToHistory,
  getPendingTimeline,
  setPendingTimeline,
  clearPendingTimeline,
} from '@/lib/session';
import { runWithQueryLogger } from '@/lib/query-logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, action } = body;

    if (!prompt && !action) {
      return NextResponse.json({ error: 'Prompt or action is required' }, { status: 400 });
    }

    const threadId = await getSessionId();

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
        await addToHistory({
          prompt: prompt || 'AI Query',
          sql: response.sql || '',
          timestamp: Date.now(),
          success: true,
          executionTime: response.result?.executionTime || 0,
          rowsAffected: response.result?.rowsAffected || 0,
          rowsScanned: rowsCount,
          rowsReturned: rowsCount,
          cpuUsage: Math.min(95, Math.max(5, Math.round(Math.random() * 20) + 5)),
          memoryUsage: Math.min(512, Math.max(16, Math.round(rowsCount * 0.05) + 32)),
          indexesUsed: response.sql?.toUpperCase().includes('WHERE') ? ['pk_index'] : [],
          timeline: allSteps,
        });
        await clearPendingTimeline();
      } else if (response.type === 'error') {
        await addToHistory({
          prompt: prompt || 'AI Query',
          sql: response.sql || '',
          timestamp: Date.now(),
          success: false,
          error: response.message || 'Execution failed',
          executionTime: 0,
          rowsScanned: 0,
          rowsReturned: 0,
          cpuUsage: 0,
          memoryUsage: 0,
          indexesUsed: [],
          timeline: allSteps,
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

