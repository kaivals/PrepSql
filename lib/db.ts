import { getDb } from './mongodb';
import type { DatabaseConnection, QueryHistoryItem, QueryMode, TimelineStep } from './types';

// ── Collection names ──────────────────────────────────────────────────────────

const COLLECTIONS = {
  QUERY_HISTORY: 'query_history',
  ANALYSIS_RESULTS: 'analysis_results',
  CHAT_MESSAGES: 'chat_messages',
  SAVED_CONNECTION: 'saved_connection',
  APP_SETTINGS: 'app_settings',
  CONNECTIONS: 'connections',
  API_KEYS: 'api_keys',
  SESSIONS: 'sessions',
} as const;

// ── Index creation (call once at startup) ──────────────────────────────────────

export async function ensureIndexes(): Promise<void> {
  const db = getDb();

  await db.collection(COLLECTIONS.QUERY_HISTORY).createIndex(
    { sessionId: 1, timestamp: -1 },
  );
  await db.collection(COLLECTIONS.ANALYSIS_RESULTS).createIndex(
    { sessionId: 1, createdAt: -1 },
  );
  await db.collection(COLLECTIONS.CHAT_MESSAGES).createIndex(
    { connectionId: 1 },
    { unique: true },
  );
  await db.collection(COLLECTIONS.APP_SETTINGS).createIndex(
    { sessionId: 1, key: 1 },
    { unique: true },
  );
  await db.collection(COLLECTIONS.SAVED_CONNECTION).createIndex(
    { sessionId: 1 },
    { unique: true },
  );
  await db.collection(COLLECTIONS.CONNECTIONS).createIndex(
    { sessionId: 1 },
  );
  await db.collection(COLLECTIONS.API_KEYS).createIndex(
    { sessionId: 1 },
    { unique: true },
  );
  await db.collection(COLLECTIONS.SESSIONS).createIndex(
    { sessionId: 1 },
    { unique: true },
  );
}

// ── Query History ──────────────────────────────────────────────────────────────

export async function insertQueryHistory(
  sessionId: string,
  item: Omit<QueryHistoryItem, 'id'>,
): Promise<QueryHistoryItem> {
  const db = getDb();
  const doc = {
    ...item,
    sessionId,
    createdAt: new Date(item.timestamp),
  };
  const result = await db.collection(COLLECTIONS.QUERY_HISTORY).insertOne(doc);
  return { ...item, id: result.insertedId.toString() };
}

export async function getQueryHistory(
  sessionId: string,
  options?: { limit?: number; offset?: number; connectionId?: string },
): Promise<{ items: QueryHistoryItem[]; total: number }> {
  const db = getDb();
  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;

  const filter: any = { sessionId };
  if (options?.connectionId) {
    filter.connectionId = options.connectionId;
  }

  const [items, totalCountResult] = await Promise.all([
    db
      .collection(COLLECTIONS.QUERY_HISTORY)
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
    db.collection(COLLECTIONS.QUERY_HISTORY).countDocuments(filter),
  ]);

  const mapped: QueryHistoryItem[] = items.map((doc: any) => ({
    id: doc._id.toString(),
    prompt: doc.prompt || '',
    sql: doc.sql,
    timestamp: doc.timestamp,
    success: doc.success,
    error: doc.error || undefined,
    queryType: doc.queryType,
    connectionId: doc.connectionId,
    connectionName: doc.connectionName,
    rowsAffected: doc.rowsAffected,
    executionTime: doc.executionTime,
    rowsScanned: doc.rowsScanned,
    rowsReturned: doc.rowsReturned,
    cpuUsage: doc.cpuUsage,
    memoryUsage: doc.memoryUsage,
    indexesUsed: doc.indexesUsed,
    timeline: doc.timeline,
  }));

  return { items: mapped, total: totalCountResult };
}

export async function clearQueryHistory(sessionId: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.QUERY_HISTORY).deleteMany({ sessionId });
}

// ── Analysis Results ──────────────────────────────────────────────────────────

export interface AnalysisResultDoc {
  id: string;
  sessionId: string;
  connectionId?: string | null;
  action: string;
  targetSql: string | null;
  result: Record<string, unknown>;
  createdAt: Date;
}

export async function insertAnalysisResult(
  sessionId: string,
  action: string,
  targetSql: string | null,
  result: Record<string, unknown>,
  connectionId?: string | null,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.ANALYSIS_RESULTS).insertOne({
    sessionId,
    connectionId: connectionId || null,
    action,
    targetSql,
    result,
    createdAt: new Date(),
  });
}

export async function getAnalysisResults(
  sessionId: string,
  limit = 10,
  connectionId?: string | null,
  action?: string | null,
): Promise<AnalysisResultDoc[]> {
  const db = getDb();
  const query: Record<string, any> = { sessionId };
  if (connectionId) {
    query.connectionId = connectionId;
  }
  if (action) {
    query.action = action;
  }
  const items = await db
    .collection(COLLECTIONS.ANALYSIS_RESULTS)
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return items.map((doc: any) => ({
    id: doc._id.toString(),
    sessionId: doc.sessionId,
    connectionId: doc.connectionId || null,
    action: doc.action,
    targetSql: doc.targetSql,
    result: doc.result,
    createdAt: doc.createdAt,
  }));
}

// ── Chat Messages ──────────────────────────────────────────────────────────────

export interface ChatMessageDoc {
  connectionId: string;
  messages: any[];
  updatedAt: Date;
}

export async function getChatMessages(
  connectionId: string,
): Promise<ChatMessageDoc | null> {
  const db = getDb();
  const doc = await db.collection(COLLECTIONS.CHAT_MESSAGES).findOne({ connectionId });
  if (!doc) return null;
  return {
    connectionId: doc.connectionId,
    messages: doc.messages,
    updatedAt: doc.updatedAt,
  };
}

export async function saveChatMessages(
  connectionId: string,
  messages: any[],
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.CHAT_MESSAGES).updateOne(
    { connectionId },
    {
      $set: {
        messages,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

// ── Saved Connection ──────────────────────────────────────────────────────────

export interface SavedConnectionDoc {
  sessionId: string;
  type: 'postgresql' | 'sqlite' | 'mysql' | 'mariadb';
  name: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  filepath?: string;
  updatedAt: Date;
}

export async function getSavedConnection(
  sessionId: string,
): Promise<SavedConnectionDoc | null> {
  const db = getDb();
  const doc = await db.collection(COLLECTIONS.SAVED_CONNECTION).findOne({ sessionId });
  return doc as unknown as SavedConnectionDoc | null;
}

export async function saveSavedConnection(
  sessionId: string,
  data: Omit<SavedConnectionDoc, 'sessionId' | 'updatedAt'>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.SAVED_CONNECTION).updateOne(
    { sessionId },
    {
      $set: {
        ...data,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function clearSavedConnection(sessionId: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.SAVED_CONNECTION).deleteOne({ sessionId });
}

// ── App Settings / Preferences ────────────────────────────────────────────────

export async function getAppSetting(
  sessionId: string,
  key: string,
): Promise<any | null> {
  const db = getDb();
  const doc = await db.collection(COLLECTIONS.APP_SETTINGS).findOne({ sessionId, key });
  return doc ? doc.value : null;
}

export async function setAppSetting(
  sessionId: string,
  key: string,
  value: any,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.APP_SETTINGS).updateOne(
    { sessionId, key },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function getAllAppSettings(
  sessionId: string,
): Promise<Record<string, any>> {
  const db = getDb();
  const docs = await db
    .collection(COLLECTIONS.APP_SETTINGS)
    .find({ sessionId })
    .toArray();
  const result: Record<string, any> = {};
  for (const doc of docs) {
    result[(doc as any).key] = (doc as any).value;
  }
  return result;
}

// ── Connections ───────────────────────────────────────────────────────────────

export interface ConnectionDoc {
  id: string;
  sessionId: string;
  type: 'postgresql' | 'sqlite' | 'mysql' | 'mariadb';
  name: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  filepath?: string;
  updatedAt: Date;
}

export async function getConnections(
  sessionId: string,
): Promise<ConnectionDoc[]> {
  const db = getDb();
  const docs = await db
    .collection(COLLECTIONS.CONNECTIONS)
    .find({ sessionId })
    .sort({ updatedAt: 1 })
    .toArray();
  return docs as unknown as ConnectionDoc[];
}

export async function addConnection(
  sessionId: string,
  data: Omit<ConnectionDoc, 'sessionId' | 'updatedAt'>,
): Promise<ConnectionDoc> {
  const db = getDb();
  const doc = { ...data, sessionId, updatedAt: new Date() };
  await db.collection(COLLECTIONS.CONNECTIONS).insertOne(doc);
  return doc;
}

export async function updateConnection(
  sessionId: string,
  id: string,
  updates: Partial<Omit<ConnectionDoc, 'id' | 'sessionId'>>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.CONNECTIONS).updateOne(
    { sessionId, id },
    { $set: { ...updates, updatedAt: new Date() } },
  );
}

export async function removeConnection(
  sessionId: string,
  id: string,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.CONNECTIONS).deleteOne({ sessionId, id });
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export interface ApiKeysDoc {
  sessionId: string;
  groqApiKey?: string;
  anthropicApiKey?: string;
  updatedAt: Date;
}

export async function getApiKeys(
  sessionId: string,
): Promise<ApiKeysDoc | null> {
  const db = getDb();
  const doc = await db.collection(COLLECTIONS.API_KEYS).findOne({ sessionId });
  if (!doc) return null;
  return {
    sessionId: doc.sessionId,
    groqApiKey: doc.groqApiKey,
    anthropicApiKey: doc.anthropicApiKey,
    updatedAt: doc.updatedAt,
  };
}

export async function saveApiKeys(
  sessionId: string,
  keys: { groqApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.API_KEYS).updateOne(
    { sessionId },
    {
      $set: {
        ...keys,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

// ── Session Data (query mode, pending timeline) ───────────────────────────────

export interface SessionDataDoc {
  sessionId: string;
  queryMode: QueryMode;
  activeConnectionId?: string;
  pendingTimeline?: TimelineStep[];
  updatedAt: Date;
}

export async function getSessionData(
  sessionId: string,
): Promise<SessionDataDoc | null> {
  const db = getDb();
  const doc = await db.collection(COLLECTIONS.SESSIONS).findOne({ sessionId });
  if (!doc) return null;
  return {
    sessionId: doc.sessionId,
    queryMode: doc.queryMode || 'crud',
    activeConnectionId: doc.activeConnectionId,
    pendingTimeline: doc.pendingTimeline,
    updatedAt: doc.updatedAt,
  };
}

export async function saveSessionData(
  sessionId: string,
  data: Partial<Omit<SessionDataDoc, 'sessionId' | 'updatedAt'>>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTIONS.SESSIONS).updateOne(
    { sessionId },
    {
      $set: {
        ...data,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}
