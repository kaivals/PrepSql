import { NextResponse } from 'next/server';
import { addConnection, getConnections } from '@/lib/app-state';
import { testConnection } from '@/lib/database';
import { ensureDemoDatabase, getDemoConnection, DEMO_DB_NAME } from '@/lib/demo-db';

export async function POST() {
  try {
    const filepath = await ensureDemoDatabase();
    const demoConfig = getDemoConnection();

    const existing = await getConnections();
    const found = existing.find((c) => c.name === DEMO_DB_NAME && c.type === 'sqlite');

    if (found) {
      return NextResponse.json({
        success: true,
        message: 'Demo database already connected',
        connection: found,
        alreadyExists: true,
      });
    }

    const isValid = await testConnection({ ...demoConfig, filepath });
    if (!isValid) {
      return NextResponse.json({ error: 'Failed to initialize demo database' }, { status: 500 });
    }

    const connection = await addConnection({
      type: 'sqlite',
      name: DEMO_DB_NAME,
      filepath,
    });

    return NextResponse.json({
      success: true,
      message: 'Demo database ready',
      connection,
      alreadyExists: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create demo database' },
      { status: 500 }
    );
  }
}
