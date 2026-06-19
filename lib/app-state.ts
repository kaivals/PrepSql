import { cookies, headers } from 'next/headers';
import { randomBytes } from 'crypto';
import type { DatabaseConnection, QueryHistoryItem, QueryMode, TimelineStep } from './types';
import { loadPersistedState, persistState, type PersistedAppState } from './app-state-persist';
import { supabase } from './supabase';

interface AppState extends PersistedAppState { }

const appStates = loadPersistedState();

function saveState(): void {
  persistState(appStates);
}

export async function getClientId(): Promise<string> {
  const headerStore = await headers();
  const headerClientId = headerStore.get('x-prepsql-client-id');
  if (headerClientId) {
    return headerClientId;
  }

  const cookieStore = await cookies();
  let clientId = cookieStore.get('prepsql-client')?.value;

  if (!clientId) {
    clientId = randomBytes(16).toString('hex');
    cookieStore.set('prepsql-client', clientId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return clientId;
}

export function stripPassword(connection: DatabaseConnection): DatabaseConnection {
  const { password: _, ...rest } = connection;
  return rest;
}

export async function getAppState(): Promise<AppState> {
  const clientId = await getClientId();

  if (!appStates.has(clientId)) {
    appStates.set(clientId, {
      connections: [],
      queryMode: 'crud',
      history: [],
    });
    saveState();
  }

  return appStates.get(clientId)!;
}

export async function getConnections(): Promise<DatabaseConnection[]> {
  const state = await getAppState();
  return state.connections;
}

export async function addConnection(connection: Omit<DatabaseConnection, 'id'>): Promise<DatabaseConnection> {
  const state = await getAppState();

  // Match duplicates by credentials only (NOT by name).
  // Same DB credentials = reconnect to existing entry (update password/name if changed).
  // Different credentials (different host, port, db, or user) = always a brand-new entry.
  const existing = state.connections.find((c) => {
    if (c.type !== connection.type) return false;
    if (c.type === 'sqlite') return c.filepath === connection.filepath;
    return (
      c.host === connection.host &&
      c.port === connection.port &&
      c.database === connection.database &&
      c.user === connection.user
    );
  });

  if (existing) {
    // Update mutable fields (password may have changed, user may have renamed it)
    if (connection.password !== undefined) existing.password = connection.password;
    if (connection.name && connection.name !== existing.name) existing.name = connection.name;
    state.activeConnectionId = existing.id;
    saveState();
    return existing;
  }

  const id = randomBytes(8).toString('hex');
  const newConnection: DatabaseConnection = { ...connection, id };
  state.connections.push(newConnection);
  state.activeConnectionId = id;
  saveState();
  return newConnection;
}

export async function removeConnection(id: string): Promise<void> {
  const state = await getAppState();
  state.connections = state.connections.filter((c) => c.id !== id);
  if (state.activeConnectionId === id) {
    state.activeConnectionId = state.connections[0]?.id;
  }
  saveState();
}

export async function setActiveConnection(id: string): Promise<void> {
  const state = await getAppState();
  if (state.connections.some((c) => c.id === id)) {
    state.activeConnectionId = id;
    saveState();
  }
}

export async function getConnection(): Promise<DatabaseConnection | undefined> {
  const state = await getAppState();
  if (!state.activeConnectionId) {
    return state.connections[0];
  }
  return state.connections.find((c) => c.id === state.activeConnectionId);
}

export async function setConnection(connection: DatabaseConnection): Promise<void> {
  const state = await getAppState();
  const idx = state.connections.findIndex((c) => c.id === connection.id);
  if (idx >= 0) {
    state.connections[idx] = connection;
  } else {
    state.connections.push(connection);
  }
  state.activeConnectionId = connection.id;
  saveState();
}

export async function getQueryMode(): Promise<QueryMode> {
  const state = await getAppState();
  return state.queryMode;
}

export async function setQueryMode(mode: QueryMode): Promise<void> {
  const state = await getAppState();
  state.queryMode = mode;
  saveState();
}

/**
 * Persist a query history record to the `query_history` Supabase table.
 * Called by /api/history/sync when the client queue drains a record.
 *
 * NOTE: The `session_id` column name is retained for compatibility with
 * existing rows — the DB column is intentionally NOT renamed (see
 * migration notes in the "session → app-state" refactor).
 */
export async function addToHistory(item: Omit<QueryHistoryItem, 'id'>): Promise<void> {
  const clientId = await getClientId();

  await supabase.from('query_history').insert({
    session_id: clientId,
    prompt: item.prompt || '',
    sql: item.sql,
    timestamp: new Date(item.timestamp).toISOString(),
    success: item.success,
    error: item.error || null,
    query_type: item.queryType || null,
    connection_id: item.connectionId || null,
    connection_name: item.connectionName || null,
    rows_affected: item.rowsAffected || 0,
    execution_time: item.executionTime || 0,
    rows_scanned: item.rowsScanned || 0,
    rows_returned: item.rowsReturned || 0,
    cpu_usage: item.cpuUsage || 0,
    memory_usage: item.memoryUsage || 0,
    indexes_used: item.indexesUsed || [],
    timeline: item.timeline || [],
  });
}

export async function getHistory(): Promise<QueryHistoryItem[]> {
  const clientId = await getClientId();

  const { data, error } = await supabase
    .from('query_history')
    .select('*')
    .eq('session_id', clientId)
    .order('timestamp', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[supabase] Failed to fetch history:', error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    prompt: row.prompt || '',
    sql: row.sql,
    timestamp: new Date(row.timestamp).getTime(),
    success: row.success,
    error: row.error || undefined,
    queryType: row.query_type || undefined,
    connectionId: row.connection_id || undefined,
    connectionName: row.connection_name || undefined,
    rowsAffected: row.rows_affected || undefined,
    executionTime: row.execution_time || undefined,
    rowsScanned: row.rows_scanned || undefined,
    rowsReturned: row.rows_returned || undefined,
    cpuUsage: row.cpu_usage || undefined,
    memoryUsage: row.memory_usage || undefined,
    indexesUsed: row.indexes_used || undefined,
    timeline: row.timeline || undefined,
  }));
}

export async function clearHistory(): Promise<void> {
  const clientId = await getClientId();

  const { error } = await supabase
    .from('query_history')
    .delete()
    .eq('session_id', clientId);

  if (error) {
    console.error('[supabase] Failed to clear history:', error.message);
  }
}

export async function getPendingTimeline(): Promise<TimelineStep[] | undefined> {
  const state = await getAppState();
  return state.pendingTimeline;
}

export async function setPendingTimeline(timeline: TimelineStep[]): Promise<void> {
  const state = await getAppState();
  state.pendingTimeline = timeline;
  saveState();
}

export async function clearPendingTimeline(): Promise<void> {
  const state = await getAppState();
  delete state.pendingTimeline;
  saveState();
}

export async function getAnthropicApiKey(): Promise<string | undefined> {
  const state = await getAppState();
  if (state.anthropicApiKey?.trim()) {
    return state.anthropicApiKey.trim();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  return undefined;
}

export async function setAnthropicApiKey(apiKey: string): Promise<void> {
  const state = await getAppState();
  state.anthropicApiKey = apiKey;
  saveState();
}

export async function clearAnthropicApiKey(): Promise<void> {
  const state = await getAppState();
  delete state.anthropicApiKey;
  saveState();
}

export async function getAnthropicKeyInfo(): Promise<{
  configured: boolean;
  source: 'env' | 'client' | 'none';
  maskedKey?: string;
}> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      configured: true,
      source: 'env',
      maskedKey: maskApiKey(process.env.ANTHROPIC_API_KEY),
    };
  }

  const state = await getAppState();
  const clientKey = state.anthropicApiKey?.trim();
  if (clientKey) {
    return {
      configured: true,
      source: 'client',
      maskedKey: maskApiKey(clientKey),
    };
  }

  return { configured: false, source: 'none' };
}

function maskApiKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

export async function getGroqApiKey(): Promise<string | undefined> {
  const state = await getAppState();
  if (state.groqApiKey?.trim()) {
    return state.groqApiKey.trim();
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    return process.env.GROQ_API_KEY.trim();
  }
  return undefined;
}

export async function setGroqApiKey(apiKey: string): Promise<void> {
  const state = await getAppState();
  state.groqApiKey = apiKey;
  saveState();
}

export async function clearGroqApiKey(): Promise<void> {
  const state = await getAppState();
  delete state.groqApiKey;
  saveState();
}

export async function getAiApiKey(): Promise<
  { provider: 'groq' | 'anthropic'; key: string } | undefined
> {
  const groqKey = await getGroqApiKey();
  if (groqKey?.trim()) {
    return { provider: 'groq', key: groqKey.trim() };
  }

  const anthropicKey = await getAnthropicApiKey();
  if (anthropicKey?.trim()) {
    return { provider: 'anthropic', key: anthropicKey.trim() };
  }

  return undefined;
}

export async function getAiKeyInfo(): Promise<{
  configured: boolean;
  provider?: 'groq' | 'anthropic';
  source: 'env' | 'client' | 'none';
  maskedKey?: string;
}> {
  const state = await getAppState();
  const groqKey = state.groqApiKey?.trim();
  if (groqKey) {
    return {
      configured: true,
      provider: 'groq',
      source: 'client',
      maskedKey: maskApiKey(groqKey),
    };
  }

  const clientKey = state.anthropicApiKey?.trim();
  if (clientKey) {
    return {
      configured: true,
      provider: 'anthropic',
      source: 'client',
      maskedKey: maskApiKey(clientKey),
    };
  }

  if (process.env.GROQ_API_KEY?.trim()) {
    return {
      configured: true,
      provider: 'groq',
      source: 'env',
      maskedKey: maskApiKey(process.env.GROQ_API_KEY),
    };
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      configured: true,
      provider: 'anthropic',
      source: 'env',
      maskedKey: maskApiKey(process.env.ANTHROPIC_API_KEY),
    };
  }

  return { configured: false, source: 'none' };
}

export async function setAiApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.startsWith('gsk_')) {
    await setGroqApiKey(trimmed);
    await clearAnthropicApiKey();
    return;
  }
  if (trimmed.startsWith('sk-ant-')) {
    await setAnthropicApiKey(trimmed);
    await clearGroqApiKey();
    return;
  }
  throw new Error('Invalid API key format. Use a Groq key (gsk_...) or Anthropic key (sk-ant-...).');
}

export async function clearAiApiKey(): Promise<void> {
  await clearGroqApiKey();
  await clearAnthropicApiKey();
}

export async function isAiConfigured(): Promise<boolean> {
  const config = await getAiApiKey();
  return !!config?.key;
}

export function validateConnection(connection: Partial<DatabaseConnection>): { valid: boolean; error?: string } {
  if (!connection.type) {
    return { valid: false, error: 'Database type is required' };
  }

  if (connection.type === 'sqlite') {
    if (!connection.filepath) {
      return { valid: false, error: 'Filepath is required for SQLite' };
    }
  } else {
    if (!connection.host) {
      return { valid: false, error: 'Host is required' };
    }
    if (!connection.user) {
      return { valid: false, error: 'User is required' };
    }
    if (!connection.database) {
      return { valid: false, error: 'Database name is required' };
    }
  }

  return { valid: true };
}
