import { NextRequest, NextResponse } from 'next/server';
import { getHistory, clearHistory } from '@/lib/app-state';

export async function GET() {
  try {
    const history = await getHistory();
    return NextResponse.json({ history });
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
