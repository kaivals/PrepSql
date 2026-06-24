import { NextRequest, NextResponse } from 'next/server';
import { getClientId } from '@/lib/app-state';
import * as db from '@/lib/db';

/**
 * GET /api/chat?connectionId=xxx
 * Returns the persisted chat messages for a given connection.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 });
    }

    const doc = await db.getChatMessages(connectionId);
    return NextResponse.json({ messages: doc?.messages || [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load chat' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/chat
 * Saves chat messages for a given connection (upsert).
 * Body: { connectionId, messages }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { connectionId, messages } = body;

    if (!connectionId || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'connectionId and messages array are required' },
        { status: 400 },
      );
    }

    await db.saveChatMessages(connectionId, messages);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save chat' },
      { status: 500 },
    );
  }
}
