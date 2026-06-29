'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ChevronRight,
  Clock,
  Table2,
  Key,
  AlertCircle,
  Pencil,
} from 'lucide-react';
import type { DatabaseConnection, QueryHistoryItem, SchemaTable } from '@/lib/types';
import { buildSelectPreview } from '@/lib/schema-format';
import { cn } from '@/lib/utils';
import { useSchema } from '@/hooks/useSchema';
import { useHistory } from '@/hooks/useHistory';

// Stable empty reference — avoids creating a new [] on every render
// which would cause an infinite loop in the accumulation useEffect.
const EMPTY_HISTORY: QueryHistoryItem[] = [];

interface SchemaSidebarProps {
  connection: DatabaseConnection;
  onSelectQuery: (sql: string) => void;
  onSelectTable?: (tableName: string) => void;
  onEditTable?: (tableName: string) => void;
  refreshTrigger?: number;
  selectedTable?: string | null;
  defaultTab?: 'schema' | 'history' | 'indexes';
}

export function SchemaSidebar({
  connection,
  onSelectQuery,
  onSelectTable,
  onEditTable,
  refreshTrigger,
  selectedTable,
  defaultTab = 'schema',
}: SchemaSidebarProps) {
  const [tab, setTab] = useState<'schema' | 'history' | 'indexes'>(defaultTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyOffset, setHistoryOffset] = useState(0);
  const [accumulatedHistory, setAccumulatedHistory] = useState<QueryHistoryItem[]>([]);
  const HISTORY_PAGE_SIZE = 5;

  // Refs for scrolling table items into view
  const tableItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Prevents the accumulation effect from re-running for an offset it already processed.
  const lastProcessedOffset = useRef<number | null>(null);

  // ── Schema query ──────────────────────────────────────────────────────────
  const {
    data: schemaData,
    isLoading: loading,
    refetch: refetchSchema,
  } = useSchema();
  const tables: SchemaTable[] = schemaData?.tables || [];

  // Refetch schema when connection or refreshTrigger changes
  useEffect(() => {
    refetchSchema();
  }, [connection.id, refreshTrigger, refetchSchema]);

  // ── History query ─────────────────────────────────────────────────────────
  const {
    data: historyPage = EMPTY_HISTORY,
    isLoading: historyLoading,
    isError: historyIsError,
    refetch: refetchHistory,
  } = useHistory({
    limit: HISTORY_PAGE_SIZE,
    offset: historyOffset,
    connectionId: connection.id,
    enabled: tab === 'history',
  });

  const historyError = historyIsError ? 'Failed to load history' : null;
  const hasMoreHistory = (historyPage as QueryHistoryItem[]).length >= HISTORY_PAGE_SIZE;

  // Accumulate pages as the user pages through history.
  // Guard with lastProcessedOffset so setting state here does NOT re-trigger
  // the effect on the next render (breaking the setState-inside-useEffect loop).
  useEffect(() => {
    if (historyLoading) return;
    if (lastProcessedOffset.current === historyOffset) return; // already processed
    lastProcessedOffset.current = historyOffset;

    if (historyOffset === 0) {
      setAccumulatedHistory(historyPage as QueryHistoryItem[]);
    } else {
      setAccumulatedHistory((prev) => [...prev, ...(historyPage as QueryHistoryItem[])]);
    }
  }, [historyPage, historyLoading, historyOffset]);

  // Reset and reload history when tab becomes active or refreshTrigger changes
  useEffect(() => {
    if (tab === 'history') {
      lastProcessedOffset.current = null; // allow offset 0 to be processed again
      setHistoryOffset(0);
      setAccumulatedHistory([]);
      refetchHistory();
    }
  }, [tab, refreshTrigger, refetchHistory]);

  // Auto-update tab if defaultTab changes (e.g. NavigationSidebar clicked)
  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  // Auto-expand and scroll when selectedTable changes
  useEffect(() => {
    if (selectedTable) {
      setExpanded((prev) => {
        if (prev.has(selectedTable)) return prev;
        const next = new Set(prev);
        next.add(selectedTable);
        return next;
      });
      requestAnimationFrame(() => {
        const el = tableItemRefs.current.get(selectedTable);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [selectedTable]);

  const loadMoreHistory = () => {
    setHistoryOffset((prev) => prev + HISTORY_PAGE_SIZE);
  };

  const toggleTable = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <aside className="flex h-full w-full shrink-0 flex-col bg-transparent border-r border-border">

      {/* Tab navigation */}
      <div className="flex border-b border-border shrink-0 bg-card/45 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setTab('schema')}
          className={cn(
            'relative flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors',
            tab === 'schema' ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Schema
          {tab === 'schema' && (
            <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={cn(
            'relative flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors',
            tab === 'history' ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          History
          {tab === 'history' && (
            <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('indexes')}
          className={cn(
            'relative flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors',
            tab === 'indexes' ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Indexes
          {tab === 'indexes' && (
            <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'schema' ? (
          loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : tables.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No tables found</p>
          ) : (
            <div className="space-y-0.5">
              {tables.map((table) => (
                <div key={table.name}>
                  <div
                    className={cn(
                      'group/table-row flex items-center justify-between rounded-md transition-colors',
                      selectedTable === table.name
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground hover:bg-muted/50'
                    )}
                  >
                    <button
                      ref={(el) => {
                        if (el) tableItemRefs.current.set(table.name, el);
                      }}
                      type="button"
                      onClick={() => {
                        toggleTable(table.name);
                        if (onSelectTable) onSelectTable(table.name);
                      }}
                      onDoubleClick={() => onSelectQuery(buildSelectPreview(table, connection.type))}
                      title="Click to select & expand · Double-click to preview rows"
                      className="flex flex-1 items-center gap-2 px-2 py-1.5 text-sm truncate text-left text-foreground"
                    >
                      <ChevronRight
                        className={cn(
                          'h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200',
                          expanded.has(table.name) && 'rotate-90'
                        )}
                      />
                      <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-[13px]">{table.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{table.rowCount}</span>
                    </button>
                    {onEditTable && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectTable) onSelectTable(table.name);
                          onEditTable(table.name);
                        }}
                        title="Edit table schema"
                        className="mr-1.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground opacity-60 hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {expanded.has(table.name) && (
                    <div className="ml-9 space-y-0.5 pb-1.5">
                      {table.columns.map((col, ci) => (
                        <div
                          key={`${table.name}-${col.name}-${ci}`}
                          className="flex items-center justify-between rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/20"
                        >
                          <span className="text-foreground/80">{col.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{col.type}</span>
                        </div>
                      ))}
                      {table.indexes && table.indexes.length > 0 && (
                        <div className="mt-2 border-t border-border pt-2">
                          <span className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Indexes
                          </span>
                          {table.indexes.map((idx) => (
                            <div
                              key={idx}
                              className="flex items-center px-2.5 py-1 text-xs text-muted-foreground"
                            >
                              <Key className="mr-2 h-2.5 w-2.5 text-muted-foreground/60" />
                              <span className="truncate">{idx}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : tab === 'indexes' ? (
          loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : tables.every((t) => !t.indexes || t.indexes.length === 0) ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No indexes found</p>
          ) : (
            <div className="space-y-2.5 p-1.5">
              {tables
                .filter((t) => t.indexes && t.indexes.length > 0)
                .map((table) => (
                  <div key={table.name} className="overflow-hidden rounded-lg border border-border bg-card/30">
                    <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground">
                      {table.name}
                    </div>
                    <div className="space-y-0.5 p-1.5">
                      {table.indexes!.map((idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                        >
                          <Key className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                          <span className="truncate">{idx}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )
        ) : tab === 'history' ? (
          historyLoading && accumulatedHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              <p className="text-xs text-muted-foreground">Loading history...</p>
            </div>
          ) : historyError && accumulatedHistory.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <p className="text-xs text-muted-foreground">{historyError}</p>
              <button
                type="button"
                onClick={() => { setHistoryOffset(0); refetchHistory(); }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
              >
                Retry
              </button>
            </div>
          ) : accumulatedHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Clock className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">No queries yet</p>
            </div>
          ) : (
            <div className="space-y-1.5 p-1.5">
              {accumulatedHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectQuery(item.sql)}
                  className={cn(
                    'w-full rounded-lg border p-2.5 text-left transition-colors',
                    item.success
                      ? 'border-border bg-card/40 hover:bg-card/75'
                      : 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
                  )}
                >
                  <div className="truncate font-mono text-[11px] text-foreground">{item.sql.substring(0, 60)}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      item.success ? 'bg-emerald-500' : 'bg-red-500'
                    )} />
                    <span className="text-[10px] text-muted-foreground">{formatTime(item.timestamp)}</span>
                  </div>
                </button>
              ))}
              {hasMoreHistory && (
                <button
                  type="button"
                  onClick={loadMoreHistory}
                  disabled={historyLoading}
                  className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                >
                  {historyLoading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </div>
          )
        ) : null}
      </div>
    </aside>
  );
}
