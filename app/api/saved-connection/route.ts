import { NextResponse } from 'next/server';
import { getClientId } from '@/lib/app-state';
import * as db from '@/lib/db';

/**
 * GET /api/saved-connection
 * Returns the saved connection credentials for auto-reconnect.
 */
export async function GET() {
  try {
    const clientId = await getClientId();
    const saved = await db.getSavedConnection(clientId);
    if (!saved) {
      return NextResponse.json({ connection: null });
    }
    return NextResponse.json({
      connection: {
        type: saved.type,
        name: saved.name,
        host: saved.host,
        port: saved.port,
        user: saved.user,
        password: saved.password,
        database: saved.database,
        filepath: saved.filepath,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load saved connection' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/saved-connection
 * Clears the saved connection (e.g., when all connections are deleted).
 */
export async function DELETE() {
  try {
    const clientId = await getClientId();
    await db.clearSavedConnection(clientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear saved connection' },
      { status: 500 },
    );
  }
}
