import type { DatabaseConnection } from './types';
import type { SavedConnection } from './connection-defaults';

export function canAutoConnect(saved: SavedConnection | null): boolean {
  if (!saved) return false;
  if (saved.type === 'sqlite') return !!saved.filepath;
  return !!(saved.host && saved.user && saved.database && saved.password);
}

export async function connectWithCredentials(
  saved: SavedConnection
): Promise<DatabaseConnection> {
  const payload: Omit<DatabaseConnection, 'id'> = {
    type: saved.type,
    name: saved.name || saved.type,
  };

  if (saved.type === 'sqlite') {
    payload.filepath = saved.filepath;
  } else {
    payload.host = saved.host;
    payload.port = saved.port;
    payload.user = saved.user;
    payload.password = saved.password ?? '';
    payload.database = saved.database;
  }

  const res = await fetch('/api/connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to connect');
  }

  const data = await res.json();
  return data.connection as DatabaseConnection;
}

/**
 * Load the saved connection credentials from the server-side store (MongoDB).
 * Returns null if no saved connection exists or on error.
 */
async function loadSavedConnectionFromServer(): Promise<SavedConnection | null> {
  try {
    const res = await fetch('/api/saved-connection', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.connection) return null;
    return data.connection as SavedConnection;
  } catch {
    return null;
  }
}

export async function ensureServerConnection(): Promise<DatabaseConnection | null> {
  const statusRes = await fetch('/api/connection', { credentials: 'same-origin' });
  if (!statusRes.ok) return null;

  const status = await statusRes.json();
  if (status.connected && status.connection) {
    return status.connection as DatabaseConnection;
  }

  if (status.connections?.length > 0) {
    const first = status.connections[0] as DatabaseConnection;
    await fetch('/api/connection', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: first.id }),
    });
    return first;
  }

  // Fallback: try to auto-reconnect using server-side saved credentials
  const saved = await loadSavedConnectionFromServer();
  if (!canAutoConnect(saved)) return null;

  try {
    return await connectWithCredentials(saved!);
  } catch {
    return null;
  }
}
