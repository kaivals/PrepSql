import { NextRequest, NextResponse } from 'next/server';
import {
  clearAnthropicApiKey,
  getAnthropicKeyInfo,
  setAnthropicApiKey,
} from '@/lib/session';

export async function GET() {
  const info = await getAnthropicKeyInfo();
  return NextResponse.json({
    configured: info.configured,
    source: info.source,
    maskedKey: info.maskedKey,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    if (!apiKey.trim().startsWith('sk-ant-')) {
      return NextResponse.json(
        { error: 'Invalid Anthropic API key format. Keys start with sk-ant-' },
        { status: 400 }
      );
    }

    await setAnthropicApiKey(apiKey.trim());
    const info = await getAnthropicKeyInfo();

    return NextResponse.json({
      success: true,
      configured: true,
      source: info.source,
      maskedKey: info.maskedKey,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save API key' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error:
            'API key is set in .env.local and cannot be removed from Settings. Remove ANTHROPIC_API_KEY from .env.local instead.',
        },
        { status: 400 }
      );
    }

    await clearAnthropicApiKey();
    return NextResponse.json({ success: true, configured: false, source: 'none' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove API key' },
      { status: 500 }
    );
  }
}
