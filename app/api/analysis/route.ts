import { NextRequest, NextResponse } from 'next/server';
import { getClientId } from '@/lib/app-state';
import * as db from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, targetSql, result, connectionId } = body;

    if (!action || !result) {
      return NextResponse.json(
        { error: 'action and result are required' },
        { status: 400 }
      );
    }

    const clientId = await getClientId();
    await db.insertAnalysisResult(clientId, action, targetSql || null, result, connectionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save analysis' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const connectionId = url.searchParams.get('connectionId');
    const clientId = await getClientId();
    const analyses = await db.getAnalysisResults(clientId, 10, connectionId);
    return NextResponse.json({ analyses });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load analyses' },
      { status: 500 }
    );
  }
}
