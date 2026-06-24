import type { AgentStateType } from '../state';
import type { SchemaTable } from '../../types';
import { introspectSchema } from '../../schema';
import { formatSchemaForPrompt } from '../../schema-format';
import { getConnection } from '../../app-state';

// ---------------------------------------------------------------------------
// Simple in-memory cache with 5-minute TTL
// Key: `${connectionId}:${dbDialect}`
// ---------------------------------------------------------------------------
interface CacheEntry {
  schemaInfo: SchemaTable[];
  formatted: string;
  ts: number;
}

const schemaCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Schema introspection node.
 *
 * Loads the database schema via the existing `introspectSchema` utility and
 * formats it for the LLM prompt. Results are cached in-memory for 5 minutes
 * to avoid hammering the database on every conversational turn.
 *
 * Skips work when:
 * - Schema is already populated in state (`schemaInfo` + `schemaFormatted`).
 * - The classified intent does not require schema (greeting, out_of_scope,
 *   clarify_needed).
 */
export async function schemaLoadNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  // ── Already loaded this turn ──────────────────────────────────────────────
  if (state.schemaInfo && state.schemaFormatted) {
    return {};
  }

  // ── Intents that don't need schema ────────────────────────────────────────
  const noSchemaNeeded: AgentStateType['intent'][] = [
    'greeting',
    'out_of_scope',
    'clarify_needed',
  ];
  if (noSchemaNeeded.includes(state.intent)) {
    return {};
  }

  try {
    // Retrieve the active database connection (includes password)
    const connection = await getConnection();
    if (!connection) {
      return {
        error: 'No active database connection. Please connect to a database first.',
      };
    }

    // ── Check cache ───────────────────────────────────────────────────────────
    const cacheKey = `${connection.id}:${state.dbDialect}`;
    const cached = schemaCache.get(cacheKey);

    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return {
        schemaInfo: cached.schemaInfo,
        schemaFormatted: cached.formatted,
      };
    }

    // ── Introspect and format ─────────────────────────────────────────────────
    const schemaInfo: SchemaTable[] = await introspectSchema(connection);
    const schemaFormatted = formatSchemaForPrompt(schemaInfo, state.dbDialect);

    // Populate cache
    schemaCache.set(cacheKey, {
      schemaInfo,
      formatted: schemaFormatted,
      ts: Date.now(),
    });

    return { schemaInfo, schemaFormatted };
  } catch (err) {
    return {
      error: `Schema introspection failed: ${(err as Error).message}. Check your database connection.`,
    };
  }
}

export function clearSchemaCache(connectionId?: string) {
  if (connectionId) {
    for (const key of schemaCache.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        schemaCache.delete(key);
      }
    }
  } else {
    schemaCache.clear();
  }
}
