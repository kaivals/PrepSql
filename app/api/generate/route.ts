import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import { getSessionId } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, action } = body;

    if (!prompt && !action) {
      return NextResponse.json({ error: 'Prompt or action is required' }, { status: 400 });
    }

    const threadId = await getSessionId();

    const response = await runAgent({
      prompt: prompt || '',
      threadId,
      action,
    });

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Agent execution/generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agent execution failed' },
      { status: 500 }
    );
  }
}

