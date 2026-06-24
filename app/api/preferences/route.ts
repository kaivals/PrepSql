import { NextRequest, NextResponse } from 'next/server';
import { getClientId } from '@/lib/app-state';
import * as db from '@/lib/db';

/**
 * GET /api/preferences
 * Returns all persisted user preferences for the current session.
 */
export async function GET() {
  try {
    const clientId = await getClientId();
    const settings = await db.getAllAppSettings(clientId);
    return NextResponse.json({ preferences: settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load preferences' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/preferences
 * Sets one or more preferences for the current session.
 * Body: { preferences: Record<string, any> }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { preferences } = body;

    if (!preferences || typeof preferences !== 'object') {
      return NextResponse.json({ error: 'preferences object is required' }, { status: 400 });
    }

    const clientId = await getClientId();
    const promises = Object.entries(preferences).map(([key, value]) =>
      db.setAppSetting(clientId, key, value),
    );
    await Promise.all(promises);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save preferences' },
      { status: 500 },
    );
  }
}
