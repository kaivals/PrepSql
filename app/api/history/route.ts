import { NextRequest, NextResponse } from 'next/server';
import { getHistory, clearHistory } from '@/lib/app-state';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.has('limit')
      ? Math.min(Math.max(parseInt(searchParams.get('limit')!, 10) || 50, 1), 500)
      : 50;
    const offset = searchParams.has('offset')
      ? Math.max(parseInt(searchParams.get('offset')!, 10) || 0, 0)
      : 0;

    const { items, total } = await getHistory({ limit, offset });
    return NextResponse.json({ history: items, total });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get history' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await clearHistory();
    return NextResponse.json({ success: true, message: 'History cleared' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear history' },
      { status: 500 }
    );
  }
}
