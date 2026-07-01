import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import type {
  DatabaseConnection,
  QueryHistoryItem,
  QueryMode,
  TimelineStep,
} from "./types";
import * as db from "./db";

// ── Client / session identification ───────────────────────────────────────────
//
// A stable clientId (stored in an httpOnly cookie) identifies the browser
// session. All persistent data is partitioned by this id inside MongoDB.

export async function getClientId(): Promise<string> {
  const headerStore = await headers();
  const headerClientId = headerStore.get("x-prepsql-client-id");
  if (headerClientId) {
    return headerClientId;
  }

  const cookieStore = await cookies();
  let clientId = cookieStore.get("prepsql-client")?.value;

  if (!clientId) {
    clientId = randomBytes(16).toString("hex");
    cookieStore.set("prepsql-client", clientId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return clientId;
}

export function stripPassword(
  connection: DatabaseConnection,
): DatabaseConnection {
  const { password: _, ...rest } = connection;
  return rest;
}

// ── Connections ───────────────────────────────────────────────────────────────

export async function getConnections(): Promise<DatabaseConnection[]> {
  const clientId = await getClientId();
  const docs = await db.getConnections(clientId);
  return docs.map(docToConnection);
}

export async function addConnection(
  connection: Omit<DatabaseConnection, "id">,
): Promise<DatabaseConnection> {
  const clientId = await getClientId();
  const existing = (await db.getConnections(clientId)).find((c) => {
    if (c.type !== connection.type) return false;
    if (c.type === "sqlite") return c.filepath === connection.filepath;
    return (
      c.host === connection.host &&
      c.port === connection.port &&
      c.database === connection.database &&
      c.user === connection.user
    );
  });

  if (existing) {
    // Update mutable fields (password may have changed, user may have renamed it)
    const updates: Partial<db.ConnectionDoc> = {};
    if (connection.password !== undefined)
      updates.password = connection.password;
    if (connection.name && connection.name !== existing.name)
      updates.name = connection.name;
    if (Object.keys(updates).length > 0) {
      await db.updateConnection(clientId, existing.id, updates);
    }
    await db.saveSessionData(clientId, { activeConnectionId: existing.id });

    const updated: DatabaseConnection = {
      ...docToConnection(existing),
      ...updates,
    } as DatabaseConnection;
    return updated;
  }

  const id = randomBytes(8).toString("hex");
  const newConnection: DatabaseConnection = { ...connection, id };
  await db.addConnection(clientId, connectionToDoc(newConnection, id));
  await db.saveSessionData(clientId, { activeConnectionId: id });
  return newConnection;
}

export async function removeConnection(id: string): Promise<void> {
  const clientId = await getClientId();
  await db.removeConnection(clientId, id);

  // Reassign active connection if the removed one was active
  const session = await db.getSessionData(clientId);
  if (session?.activeConnectionId === id) {
    const remaining = await db.getConnections(clientId);
    await db.saveSessionData(clientId, {
      activeConnectionId: remaining[0]?.id,
    });
  }
}

export async function setActiveConnection(id: string): Promise<void> {
  const clientId = await getClientId();
  const connections = await db.getConnections(clientId);
  if (connections.some((c) => c.id === id)) {
    await db.saveSessionData(clientId, { activeConnectionId: id });
  }
}

export async function getConnection(): Promise<DatabaseConnection | undefined> {
  const clientId = await getClientId();
  const [session, connections] = await Promise.all([
    db.getSessionData(clientId),
    db.getConnections(clientId),
  ]);

  if (!session?.activeConnectionId) {
    return connections.length > 0 ? docToConnection(connections[0]) : undefined;
  }
  const active = connections.find((c) => c.id === session.activeConnectionId);
  return active ? docToConnection(active) : undefined;
}

export async function setConnection(
  connection: DatabaseConnection,
): Promise<void> {
  const clientId = await getClientId();
  const existing = (await db.getConnections(clientId)).find(
    (c) => c.id === connection.id,
  );
  if (existing) {
    await db.updateConnection(
      clientId,
      connection.id,
      connectionToDoc(connection, connection.id),
    );
  } else {
    await db.addConnection(
      clientId,
      connectionToDoc(connection, connection.id),
    );
  }
  await db.saveSessionData(clientId, { activeConnectionId: connection.id });
}

// ── Query Mode ────────────────────────────────────────────────────────────────

export async function getQueryMode(): Promise<QueryMode> {
  const clientId = await getClientId();
  const session = await db.getSessionData(clientId);
  return session?.queryMode || "crud";
}

export async function setQueryMode(mode: QueryMode): Promise<void> {
  const clientId = await getClientId();
  await db.saveSessionData(clientId, { queryMode: mode });
}

// ── Query History (MongoDB-backed) ────────────────────────────────────────────
//
// Query history is the single source of truth for execution metrics
// (executionTime, rowsScanned, cpuUsage, etc.) and survives page reloads
// because it is persisted server-side in MongoDB.

export async function addToHistory(
  item: Omit<QueryHistoryItem, "id">,
): Promise<void> {
  const clientId = await getClientId();
  await db.insertQueryHistory(clientId, item);
}

export async function getHistory(options?: {
  limit?: number;
  offset?: number;
  connectionId?: string;
}): Promise<{ items: QueryHistoryItem[]; total: number }> {
  const clientId = await getClientId();
  return db.getQueryHistory(clientId, options);
}

export async function clearHistory(): Promise<void> {
  const clientId = await getClientId();
  await db.clearQueryHistory(clientId);
}

// ── Pending Timeline (for mutation approval flow) ─────────────────────────────

export async function getPendingTimeline(): Promise<
  { steps: TimelineStep[]; threadId: string } | undefined
> {
  const clientId = await getClientId();
  const session = await db.getSessionData(clientId);
  if (!session?.pendingTimeline) return undefined;
  // Handle legacy format (array) or new format (object with steps and threadId)
  if (Array.isArray(session.pendingTimeline)) {
    return { steps: session.pendingTimeline, threadId: "" };
  }
  return session.pendingTimeline as { steps: TimelineStep[]; threadId: string };
}

export async function setPendingTimeline(data: {
  steps: TimelineStep[];
  threadId: string;
}): Promise<void> {
  const clientId = await getClientId();
  await db.saveSessionData(clientId, { pendingTimeline: data });
}

export async function clearPendingTimeline(): Promise<void> {
  const clientId = await getClientId();
  await db.saveSessionData(clientId, { pendingTimeline: undefined });
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export async function getAnthropicApiKey(): Promise<string | undefined> {
  const clientId = await getClientId();
  const keys = await db.getApiKeys(clientId);
  if (keys?.anthropicApiKey?.trim()) {
    return keys.anthropicApiKey.trim();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  return undefined;
}

export async function setAnthropicApiKey(apiKey: string): Promise<void> {
  const clientId = await getClientId();
  await db.saveApiKeys(clientId, { anthropicApiKey: apiKey });
}

export async function clearAnthropicApiKey(): Promise<void> {
  const clientId = await getClientId();
  await db.saveApiKeys(clientId, { anthropicApiKey: undefined });
}

export async function getAnthropicKeyInfo(): Promise<{
  configured: boolean;
  source: "env" | "client" | "none";
  maskedKey?: string;
}> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      configured: true,
      source: "env",
      maskedKey: maskApiKey(process.env.ANTHROPIC_API_KEY),
    };
  }

  const clientId = await getClientId();
  const keys = await db.getApiKeys(clientId);
  const clientKey = keys?.anthropicApiKey?.trim();
  if (clientKey) {
    return {
      configured: true,
      source: "client",
      maskedKey: maskApiKey(clientKey),
    };
  }

  return { configured: false, source: "none" };
}

function maskApiKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

export async function getGroqApiKey(): Promise<string | undefined> {
  const clientId = await getClientId();
  const keys = await db.getApiKeys(clientId);
  if (keys?.groqApiKey?.trim()) {
    return keys.groqApiKey.trim();
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    return process.env.GROQ_API_KEY.trim();
  }
  return undefined;
}

export async function setGroqApiKey(apiKey: string): Promise<void> {
  const clientId = await getClientId();
  await db.saveApiKeys(clientId, { groqApiKey: apiKey });
}

export async function clearGroqApiKey(): Promise<void> {
  const clientId = await getClientId();
  await db.saveApiKeys(clientId, { groqApiKey: undefined });
}

export async function getAiApiKey(): Promise<
  { provider: "groq" | "anthropic"; key: string } | undefined
> {
  const groqKey = await getGroqApiKey();
  if (groqKey?.trim()) {
    return { provider: "groq", key: groqKey.trim() };
  }

  const anthropicKey = await getAnthropicApiKey();
  if (anthropicKey?.trim()) {
    return { provider: "anthropic", key: anthropicKey.trim() };
  }

  return undefined;
}

export async function getAiKeyInfo(): Promise<{
  configured: boolean;
  provider?: "groq" | "anthropic";
  source: "env" | "client" | "none";
  maskedKey?: string;
}> {
  const clientId = await getClientId();
  const keys = await db.getApiKeys(clientId);

  const groqKey = keys?.groqApiKey?.trim();
  if (groqKey) {
    return {
      configured: true,
      provider: "groq",
      source: "client",
      maskedKey: maskApiKey(groqKey),
    };
  }

  const clientKey = keys?.anthropicApiKey?.trim();
  if (clientKey) {
    return {
      configured: true,
      provider: "anthropic",
      source: "client",
      maskedKey: maskApiKey(clientKey),
    };
  }

  if (process.env.GROQ_API_KEY?.trim()) {
    return {
      configured: true,
      provider: "groq",
      source: "env",
      maskedKey: maskApiKey(process.env.GROQ_API_KEY),
    };
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      configured: true,
      provider: "anthropic",
      source: "env",
      maskedKey: maskApiKey(process.env.ANTHROPIC_API_KEY),
    };
  }

  return { configured: false, source: "none" };
}

export async function setAiApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("gsk_")) {
    await setGroqApiKey(trimmed);
    await clearAnthropicApiKey();
    return;
  }
  if (trimmed.startsWith("sk-ant-")) {
    await setAnthropicApiKey(trimmed);
    await clearGroqApiKey();
    return;
  }
  throw new Error(
    "Invalid API key format. Use a Groq key (gsk_...) or Anthropic key (sk-ant-...).",
  );
}

export async function clearAiApiKey(): Promise<void> {
  await clearGroqApiKey();
  await clearAnthropicApiKey();
}

export async function isAiConfigured(): Promise<boolean> {
  const config = await getAiApiKey();
  return !!config?.key;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateConnection(connection: Partial<DatabaseConnection>): {
  valid: boolean;
  error?: string;
} {
  if (!connection.type) {
    return { valid: false, error: "Database type is required" };
  }

  if (connection.type === "sqlite") {
    if (!connection.filepath) {
      return { valid: false, error: "Filepath is required for SQLite" };
    }
  } else {
    if (!connection.host) {
      return { valid: false, error: "Host is required" };
    }
    if (!connection.user) {
      return { valid: false, error: "User is required" };
    }
    if (!connection.database) {
      return { valid: false, error: "Database name is required" };
    }
  }

  return { valid: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function docToConnection(doc: db.ConnectionDoc): DatabaseConnection {
  return {
    id: doc.id,
    type: doc.type,
    name: doc.name,
    host: doc.host,
    port: doc.port,
    user: doc.user,
    password: doc.password,
    database: doc.database,
    filepath: doc.filepath,
  };
}

function connectionToDoc(
  connection: DatabaseConnection,
  id: string,
): Omit<db.ConnectionDoc, "sessionId" | "updatedAt"> {
  return {
    id,
    type: connection.type,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    filepath: connection.filepath,
  };
}
