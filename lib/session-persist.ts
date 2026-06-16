import fs from 'fs';
import path from 'path';
import type { DatabaseConnection, QueryHistoryItem, QueryMode } from './types';

export interface PersistedSessionData {
  connections: DatabaseConnection[];
  activeConnectionId?: string;
  queryMode: QueryMode;
  history: QueryHistoryItem[];
  anthropicApiKey?: string;
  groqApiKey?: string;
}

const SESSIONS_FILE = path.join(process.cwd(), 'data', 'sessions.json');

function ensureDataDir() {
  const dir = path.dirname(SESSIONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadPersistedSessions(): Map<string, PersistedSessionData> {
  try {
    ensureDataDir();
    if (!fs.existsSync(SESSIONS_FILE)) {
      return new Map();
    }
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, PersistedSessionData>;
    return new Map(Object.entries(parsed));
  } catch (error) {
    console.error('[session] Failed to load persisted sessions:', error);
    return new Map();
  }
}

export function persistSessions(sessions: Map<string, PersistedSessionData>): void {
  try {
    ensureDataDir();
    const data = Object.fromEntries(sessions.entries());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[session] Failed to persist sessions:', error);
  }
}
