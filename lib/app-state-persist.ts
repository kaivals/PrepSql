import fs from 'fs';
import path from 'path';
import type { DatabaseConnection, QueryHistoryItem, QueryMode, TimelineStep } from './types';

export interface PersistedAppState {
  connections: DatabaseConnection[];
  activeConnectionId?: string;
  queryMode: QueryMode;
  history: QueryHistoryItem[];
  anthropicApiKey?: string;
  groqApiKey?: string;
  pendingTimeline?: TimelineStep[];
}

const STATE_FILE = path.join(process.cwd(), 'data', 'app-state.json');
// Legacy path — migrated to STATE_FILE on first load.
const LEGACY_STATE_FILE = path.join(process.cwd(), 'data', 'sessions.json');

function ensureDataDir() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Attempt to migrate the legacy `data/sessions.json` file to the new
 * `data/app-state.json` location.  Called once at server startup.
 */
function migrateLegacyFile(): boolean {
  try {
    if (!fs.existsSync(LEGACY_STATE_FILE)) return false;
    if (fs.existsSync(STATE_FILE)) {
      // New file already exists — delete the legacy one.
      fs.unlinkSync(LEGACY_STATE_FILE);
      return false;
    }
    // Move (rename) the legacy file to the new path.
    fs.renameSync(LEGACY_STATE_FILE, STATE_FILE);
    console.log('[app-state] Migrated legacy sessions.json → app-state.json');
    return true;
  } catch (error) {
    console.error('[app-state] Failed to migrate legacy file:', error);
    return false;
  }
}

export function loadPersistedState(): Map<string, PersistedAppState> {
  try {
    ensureDataDir();
    migrateLegacyFile();

    if (!fs.existsSync(STATE_FILE)) {
      return new Map();
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, PersistedAppState>;
    return new Map(Object.entries(parsed));
  } catch (error) {
    console.error('[app-state] Failed to load persisted state:', error);
    return new Map();
  }
}

export function persistState(states: Map<string, PersistedAppState>): void {
  try {
    ensureDataDir();
    const data = Object.fromEntries(states.entries());
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[app-state] Failed to persist state:', error);
  }
}
