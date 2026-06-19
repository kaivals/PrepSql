/**
 * HistoryQueue — a localStorage-backed, durable store + outbox for query
 * history records.
 *
 * Design:
 *  - Every executed query is persisted to localStorage IMMEDIATELY and kept
 *    there PERMANENTLY. localStorage is the source of truth that the UI reads
 *    from, so history survives page refresh, browser restart, and crashes.
 *  - Separately, a background drain loop works off those records: each one is
 *    POSTed to /api/history/sync, which inserts a copy into the `query_history`
 *    table. A record leaves `pending` (the transient sync queue) after the DB
 *    confirms the insert — but it NEVER leaves `records` (the permanent store).
 *  - On failure (network / DB down) the record stays in `pending` with a bumped
 *    retry counter and is retried automatically with backoff.
 *  - On app startup, the store is restored from localStorage and syncing of
 *    any pending records resumes.
 *
 * Persisted shape:
 *   { records: QueryHistoryItem[]      // permanent, source of truth (newest first)
 *     pending: PendingEntry[]          // records awaiting DB sync (transient)
 *   }
 */
import type { QueryHistoryItem } from './types';

const STORAGE_KEY = 'prepsql-history-queue';
const SYNC_ENDPOINT = '/api/history/sync';

/** Cap on how many records we keep in localStorage (safety against runaway). */
const MAX_RECORDS = 500;
/** Stop exponential backoff from growing beyond this many milliseconds. */
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes
/** Drain tick used when the head item is still waiting on its backoff timer. */
const IDLE_POLL_MS = 15_000;

interface PendingEntry {
  id: string;
  retries: number;
  /** Epoch ms of the next allowed sync attempt (for backoff). */
  nextAttemptAt: number;
}

/** Legacy persisted shape (pre-permanent-storage). Kept only for migration. */
interface LegacyQueueEntry {
  item: QueryHistoryItem;
  retries: number;
  nextAttemptAt: number;
}

interface PersistedState {
  records: QueryHistoryItem[];
  pending: PendingEntry[];
}

type QueueListener = () => void;

class HistoryQueue {
  private records: QueryHistoryItem[] = [];
  private pending: PendingEntry[] = [];
  private syncing = false;
  private listeners: Set<QueueListener> = new Set();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  /**
   * Restore the store from localStorage. Safe to call multiple times.
   * Call once on app startup; init() kicks off the drain loop so any records
   * left pending from a previous session get retried automatically.
   */
  init(): void {
    if (typeof window === 'undefined') return;
    if (this.initialized) return;
    this.initialized = true;

    this.loadFromStorage();
    // Kick off the drain loop so any records left over from a previous
    // session (page refresh / browser restart) get retried automatically.
    this.scheduleDrain(0);
  }

  // ── localStorage I/O ──────────────────────────────────────────────────────

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      // Migration: old shape was an array of { item, retries, nextAttemptAt }.
      // Those were unsynced records — move them into BOTH records (kept
      // permanently) and pending (re-synced).
      if (Array.isArray(parsed)) {
        const legacy = (parsed as LegacyQueueEntry[]).filter((e) => e && e.item && e.item.id);
        const now = Date.now();
        this.records = legacy.map((e) => e.item);
        this.pending = legacy.map((e) => ({
          id: e.item.id,
          retries: e.retries || 0,
          nextAttemptAt: e.nextAttemptAt || now,
        }));
        this.persist();
        return;
      }

      // Current shape.
      const state = parsed as PersistedState;
      if (Array.isArray(state.records)) {
        this.records = state.records.filter((r) => r && r.id);
      }
      if (Array.isArray(state.pending)) {
        this.pending = state.pending.filter((p) => p && p.id);
      }
      // Drop any pending entries whose record no longer exists (e.g. after a
      // bounded-clear removed the oldest records).
      const recordIds = new Set(this.records.map((r) => r.id));
      this.pending = this.pending.filter((p) => recordIds.has(p.id));
    } catch {
      this.records = [];
      this.pending = [];
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      const state: PersistedState = { records: this.records, pending: this.pending };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — keep going in-memory; the record
      // is already displayed via listeners and will be retried this session.
    }
  }

  // ── pub/sub (drives instant UI updates) ───────────────────────────────────

  /** Subscribe to store changes. Returns an unsubscribe function. */
  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  // ── read API used by the UI ───────────────────────────────────────────────

  /**
   * All permanently-stored records, newest first. These are the records
   * displayed to the user.
   */
  getItems(): QueryHistoryItem[] {
    return [...this.records].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * A single page of records (newest first) for paginated rendering, e.g. the
   * sidebar History list which loads 5 at a time. `limit` is the page size,
   * `offset` is how many records to skip. Returns `{ items, hasMore }`.
   */
  getPage(offset: number, limit: number): { items: QueryHistoryItem[]; hasMore: boolean } {
    const sorted = [...this.records].sort((a, b) => b.timestamp - a.timestamp);
    const items = sorted.slice(offset, offset + limit);
    return { items, hasMore: offset + limit < sorted.length };
  }

  /** Total number of permanently-stored records. */
  getCount(): number {
    return this.records.length;
  }

  /** Number of records still pending a successful DB sync. */
  getPendingCount(): number {
    return this.pending.length;
  }

  // ── mutation API ──────────────────────────────────────────────────────────

  /**
   * Add a record permanently to localStorage and queue it for background sync.
   * Triggers the drain loop and notifies listeners.
   * Deduplicates by id so a re-render never double-inserts.
   */
  enqueue(item: QueryHistoryItem): void {
    if (typeof window === 'undefined') return;
    if (this.records.some((r) => r.id === item.id)) return;

    this.records.push(item);

    // Bound growth: drop the OLDEST records if over capacity.
    if (this.records.length > MAX_RECORDS) {
      this.records.sort((a, b) => a.timestamp - b.timestamp);
      const droppedIds = new Set(
        this.records.splice(0, this.records.length - MAX_RECORDS).map((r) => r.id),
      );
      // Don't keep trying to sync records we've discarded.
      this.pending = this.pending.filter((p) => !droppedIds.has(p.id));
    }

    this.pending.push({ id: item.id, retries: 0, nextAttemptAt: 0 });

    this.persist();
    this.notify();
    this.scheduleDrain(0);
  }

  /**
   * Remove a record's pending entry after the DB has confirmed the insert.
   * The record itself stays in `records` (permanent). Called only from the
   * drain loop on a successful sync.
   */
  private removeFromPending(id: string): void {
    const idx = this.pending.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this.pending.splice(idx, 1);
    this.persist();
    this.notify();
  }

  /**
   * Clear all stored records (used after a successful "Clear History" which
   * also wipes the server-side table). Pending unsynced records are discarded.
   */
  clear(): void {
    this.records = [];
    this.pending = [];
    this.persist();
    this.notify();
  }

  // ── background sync loop ──────────────────────────────────────────────────

  /** Begin draining pending records. Idempotent; `init()` calls this automatically. */
  startSync(): void {
    this.init();
  }

  private scheduleDrain(delay: number): void {
    if (typeof window === 'undefined') return;
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drain();
    }, delay);
  }

  /** Process eligible pending records one at a time until empty/backed-off. */
  private async drain(): Promise<void> {
    if (this.syncing || typeof window === 'undefined') return;
    if (this.pending.length === 0) return;

    this.syncing = true;
    try {
      // Always operate on the oldest eligible record (FIFO), so order is
      // preserved on the server when records sync after recovery.
      const now = Date.now();
      const idx = this.pending.findIndex((e) => e.nextAttemptAt <= now);
      if (idx === -1) {
        // Everything is in backoff — re-check after a short poll.
        const head = this.pending[0];
        const wait = Math.min(
          IDLE_POLL_MS,
          Math.max(0, head ? head.nextAttemptAt - now : IDLE_POLL_MS),
        );
        this.scheduleDrain(wait);
        return;
      }

      const entry = this.pending[idx];
      const record = this.records.find((r) => r.id === entry.id);
      if (!record) {
        // Record was cleared — drop its pending entry and move on.
        this.removeFromPending(entry.id);
        return;
      }

      let success = false;
      try {
        const res = await fetch(SYNC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ item: record }),
        });
        success = res.ok;
      } catch {
        success = false; // network failure — treat as retryable
      }

      if (success) {
        this.removeFromPending(entry.id);
      } else {
        entry.retries += 1;
        const backoff = Math.min(MAX_DELAY_MS, 1000 * Math.pow(2, entry.retries - 1));
        entry.nextAttemptAt = Date.now() + backoff;
        this.persist();
        console.warn(
          `[history-queue] sync failed for ${entry.id}, retry #${entry.retries} in ${backoff}ms`,
        );
      }
    } finally {
      this.syncing = false;
      if (this.pending.length > 0) {
        this.scheduleDrain(0);
      }
    }
  }
}

/** Singleton instance — import and use everywhere (client-side only). */
export const historyQueue = new HistoryQueue();
