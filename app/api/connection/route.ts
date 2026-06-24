import { NextRequest, NextResponse } from 'next/server';
import {
  getClientId,
  getConnections,
  addConnection,
  removeConnection,
  setActiveConnection,
  getConnection,
  validateConnection,
  stripPassword,
} from '@/lib/app-state';
import { testConnection } from '@/lib/database';
import { saveSavedConnection } from '@/lib/db';
import type { DatabaseConnection } from '@/lib/types';

export async function GET() {
  try {
    const connections = await getConnections();
    const active = await getConnection();
    return NextResponse.json({
      connections: connections.map(stripPassword),
      connection: active ? stripPassword(active) : null,
      connected: !!active,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get connections' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Omit<DatabaseConnection, 'id'> & { activate?: boolean };

    const validation = validateConnection(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    await testConnection({
      ...body,
      password: typeof body.password === 'string' ? body.password : '',
    });

    const connection = await addConnection({
      type: body.type,
      name: body.name || body.type,
      host: body.host,
      port: body.port,
      user: body.user,
      password: typeof body.password === 'string' ? body.password : '',
      database: body.database,
      filepath: body.filepath,
    });

    // Persist credentials for auto-reconnect on page reload.
    const clientId = await getClientId();
    await saveSavedConnection(clientId, {
      type: connection.type,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: connection.database,
      filepath: connection.filepath,
    });

    return NextResponse.json({
      success: true,
      message: 'Connected successfully',
      connection: stripPassword(connection),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set connection' },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Connection id is required' }, { status: 400 });
    }

    await setActiveConnection(id);
    const connection = await getConnection();

    return NextResponse.json({ connection: connection ? stripPassword(connection) : null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to activate connection' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      await removeConnection(id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove connection' },
      { status: 500 }
    );
  }
}
