import { NextRequest, NextResponse } from 'next/server';
import { getConnection, getQueryMode, setQueryMode } from '@/lib/app-state';

export async function GET() {
  try {
    const mode = await getQueryMode();
    return NextResponse.json({ mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get mode' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode } = body;

    if (!['crud', 'analytics', 'schema'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }

    if (!(await getConnection())) {
      return NextResponse.json({ error: 'No database connection' }, { status: 400 });
    }

    await setQueryMode(mode);
    return NextResponse.json({ mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set mode' },
      { status: 500 }
    );
  }
}
