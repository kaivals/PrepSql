import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import type { DatabaseConnection, QueryHistoryItem, QueryMode } from './types';
import { loadPersistedSessions, persistSessions, type PersistedSessionData } from './session-persist';

interface SessionData extends PersistedSessionData { }

const sessions = loadPersistedSessions();

function saveSessions(): void {
  persistSessions(sessions);
}

async function getSessionId(): Promise<string> {
  const cookieStore = await cookies();
  let sessionId = cookieStore.get('prepsql-session')?.value;

  if (!sessionId) {
    sessionId = randomBytes(16).toString('hex');
    cookieStore.set('prepsql-session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return sessionId;
}

export function stripPassword(connection: DatabaseConnection): DatabaseConnection {
  const { password: _, ...rest } = connection;
  return rest;
}

export async function getSession(): Promise<SessionData> {
  const sessionId = await getSessionId();

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      connections: [],
      queryMode: 'crud',
      history: [],
    });
    saveSessions();
  }

  return sessions.get(sessionId)!;
}

export async function getConnections(): Promise<DatabaseConnection[]> {
  const session = await getSession();
  return session.connections;
}

export async function addConnection(connection: Omit<DatabaseConnection, 'id'>): Promise<DatabaseConnection> {
  const session = await getSession();

  // Match duplicates by credentials only (NOT by name).
  // Same DB credentials = reconnect to existing entry (update password/name if changed).
  // Different credentials (different host, port, db, or user) = always a brand-new entry.
  const existing = session.connections.find((c) => {
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
    session.activeConnectionId = existing.id;
    saveSessions();
    return existing;
  }

  const id = randomBytes(8).toString('hex');
  const newConnection: DatabaseConnection = { ...connection, id };
  session.connections.push(newConnection);
  session.activeConnectionId = id;
  saveSessions();
  return newConnection;
}

export async function removeConnection(id: string): Promise<void> {
  const session = await getSession();
  session.connections = session.connections.filter((c) => c.id !== id);
  if (session.activeConnectionId === id) {
    session.activeConnectionId = session.connections[0]?.id;
  }
  saveSessions();
}

export async function setActiveConnection(id: string): Promise<void> {
  const session = await getSession();
  if (session.connections.some((c) => c.id === id)) {
    session.activeConnectionId = id;
    saveSessions();
  }
}

export async function getConnection(): Promise<DatabaseConnection | undefined> {
  const session = await getSession();
  if (!session.activeConnectionId) {
    return session.connections[0];
  }
  return session.connections.find((c) => c.id === session.activeConnectionId);
}

export async function setConnection(connection: DatabaseConnection): Promise<void> {
  const session = await getSession();
  const idx = session.connections.findIndex((c) => c.id === connection.id);
  if (idx >= 0) {
    session.connections[idx] = connection;
  } else {
    session.connections.push(connection);
  }
  session.activeConnectionId = connection.id;
  saveSessions();
}

export async function getQueryMode(): Promise<QueryMode> {
  const session = await getSession();
  return session.queryMode;
}

export async function setQueryMode(mode: QueryMode): Promise<void> {
  const session = await getSession();
  session.queryMode = mode;
  saveSessions();
}

export async function addToHistory(item: Omit<QueryHistoryItem, 'id'>): Promise<void> {
  const session = await getSession();
  const id = randomBytes(8).toString('hex');
  session.history.unshift({ id, ...item });

  if (session.history.length > 50) {
    session.history = session.history.slice(0, 50);
  }
  saveSessions();
}

export async function getHistory(): Promise<QueryHistoryItem[]> {
  const session = await getSession();
  return session.history;
}

export async function clearHistory(): Promise<void> {
  const session = await getSession();
  session.history = [];
  saveSessions();
}

export async function getAnthropicApiKey(): Promise<string | undefined> {
  const session = await getSession();
  if (session.anthropicApiKey?.trim()) {
    return session.anthropicApiKey.trim();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  return undefined;
}

export async function setAnthropicApiKey(apiKey: string): Promise<void> {
  const session = await getSession();
  session.anthropicApiKey = apiKey;
  saveSessions();
}

export async function clearAnthropicApiKey(): Promise<void> {
  const session = await getSession();
  delete session.anthropicApiKey;
  saveSessions();
}

export async function getAnthropicKeyInfo(): Promise<{
  configured: boolean;
  source: 'env' | 'session' | 'none';
  maskedKey?: string;
}> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      configured: true,
      source: 'env',
      maskedKey: maskApiKey(process.env.ANTHROPIC_API_KEY),
    };
  }

  const session = await getSession();
  const sessionKey = session.anthropicApiKey?.trim();
  if (sessionKey) {
    return {
      configured: true,
      source: 'session',
      maskedKey: maskApiKey(sessionKey),
    };
  }

  return { configured: false, source: 'none' };
}

function maskApiKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

export async function getGroqApiKey(): Promise<string | undefined> {
  const session = await getSession();
  if (session.groqApiKey?.trim()) {
    return session.groqApiKey.trim();
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    return process.env.GROQ_API_KEY.trim();
  }
  return undefined;
}

export async function setGroqApiKey(apiKey: string): Promise<void> {
  const session = await getSession();
  session.groqApiKey = apiKey;
  saveSessions();
}

export async function clearGroqApiKey(): Promise<void> {
  const session = await getSession();
  delete session.groqApiKey;
  saveSessions();
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
  source: 'env' | 'session' | 'none';
  maskedKey?: string;
}> {
  const session = await getSession();
  const groqKey = session.groqApiKey?.trim();
  if (groqKey) {
    return {
      configured: true,
      provider: 'groq',
      source: 'session',
      maskedKey: maskApiKey(groqKey),
    };
  }

  const sessionKey = session.anthropicApiKey?.trim();
  if (sessionKey) {
    return {
      configured: true,
      provider: 'anthropic',
      source: 'session',
      maskedKey: maskApiKey(sessionKey),
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
