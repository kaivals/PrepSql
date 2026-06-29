import { NextRequest, NextResponse } from 'next/server';
import { getClientId } from '@/lib/app-state';
import { getTokenUsage, trackTokenUsage } from '@/lib/token-tracker';

export async function GET() {
  try {
    const clientId = await getClientId();
    const usage = await getTokenUsage(clientId);
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch token usage' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { promptTokens = 0, completionTokens = 0 } = body as {
      promptTokens: number;
      completionTokens: number;
    };

    const clientId = await getClientId();
    trackTokenUsage(clientId, promptTokens, completionTokens);

    // Small delay to allow the fire-and-forget write to settle before reading
    await new Promise((r) => setTimeout(r, 150));

    const usage = await getTokenUsage(clientId);
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update token usage' }, { status: 500 });
  }
}
