'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Table2,
  Key,
  AlertCircle,
} from 'lucide-react';
import type { DatabaseConnection, QueryHistoryItem, SchemaTable } from '@/lib/types';
import { buildSelectPreview } from '@/lib/schema-format';
import { cn } from '@/lib/utils';

interface SchemaSidebarProps {
  connection: DatabaseConnection;
  onBack: () => void;
  onSelectQuery: (sql: string) => void;
  onSelectTable?: (tableName: string) => void;
  refreshTrigger?: number;
  selectedTable?: string | null;
}

export function SchemaSidebar({
  connection,
  onBack,
  onSelectQuery,
  onSelectTable,
  refreshTrigger,
  selectedTable,
}: SchemaSidebarProps) {
  const [tab, setTab] = useState<'schema' | 'history' | 'indexes'>('schema');
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // History is fetched from the server-side MongoDB store via /api/history.
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const HISTORY_PAGE_SIZE = 5;
  const [loading, setLoading] = useState(true);

  // Refs for scrolling table items into view
  const tableItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Fetch schema tables
  useEffect(() => {
    const loadSchema = async () => {
      try {
        const res = await fetch('/api/schema');
        if (res.ok) {
          const data = await res.json();
          setTables(data.tables || []);
        }
      } catch (err) {
        console.error('Failed to load schema:', err);
      } finally {
        setLoading(false);
      }
    };
    loadSchema();
  }, [connection.id, refreshTrigger]);

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

  // Fetch history from the server-side MongoDB store.
  const loadHistoryPage = useCallback(async (offset: number, append = false) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `/api/history?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        throw new Error('Failed to load history');
      }
      const data = await res.json();
      const items: QueryHistoryItem[] = data.history || [];
      setHasMoreHistory(items.length >= HISTORY_PAGE_SIZE);
      setHistory((prev) => (append ? [...prev, ...items] : items));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load history page when switching to history tab or when refreshTrigger changes
  useEffect(() => {
    if (tab === 'history') {
      loadHistoryPage(0);
    }
  }, [tab, refreshTrigger, loadHistoryPage]);

  const loadMoreHistory = () => {
    loadHistoryPage(history.length, true);
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
    <aside className="flex h-full w-full shrink-0 flex-col bg-white">
      <div className="border-b border-border p-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All connections
        </button>
        <h2 className="font-semibold leading-tight">{connection.name}</h2>
        <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {connection.type}
        </p>
      </div>

      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setTab('schema')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm font-medium transition-colors',
            tab === 'schema'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Table2 className="h-3.5 w-3.5" />
          Schema
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm font-medium transition-colors',
            tab === 'history'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          History
        </button>
        <button
          type="button"
          onClick={() => setTab('indexes')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm font-medium transition-colors',
            tab === 'indexes'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Key className="h-3.5 w-3.5" />
          Indexes
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'schema' ? (
          loading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading schema...</p>
          ) : tables.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No tables found</p>
          ) : (
            <div className="space-y-0.5">
              {tables.map((table) => (
                <div key={table.name}>
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
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      selectedTable === table.name
                        ? 'bg-primary/10 font-medium text-foreground'
                        : 'hover:bg-muted/60'
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                        expanded.has(table.name) && 'rotate-90'
                      )}
                    />
                    <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-left">{table.name}</span>
                    <span className="text-xs text-muted-foreground">{table.rowCount}</span>
                  </button>
                  {expanded.has(table.name) && (
                    <div className="ml-7 space-y-0.5 pb-1">
                      {table.columns.map((col, ci) => (
                        <div
                          key={`${table.name}-${col.name}-${ci}`}
                          className="flex items-center justify-between px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <span>{col.name}</span>
                          <span className="text-muted-foreground/60">{col.type}</span>
                        </div>
                      ))}
                      {table.indexes && table.indexes.length > 0 && (
                        <div className="mt-2 border-t border-border pt-1">
                          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Indexes
                          </span>
                          {table.indexes.map((idx) => (
                            <div
                              key={idx}
                              className="flex items-center px-2 py-0.5 text-xs text-muted-foreground"
                            >
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
            <p className="p-3 text-sm text-muted-foreground">Loading indexes...</p>
          ) : tables.every((t) => !t.indexes || t.indexes.length === 0) ? (
            <p className="p-3 text-sm text-muted-foreground">No indexes found</p>
          ) : (
            <div className="space-y-3 p-1">
              {tables
                .filter((t) => t.indexes && t.indexes.length > 0)
                .map((table) => (
                  <div key={table.name} className="rounded-md border border-border">
                    <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold">
                      {table.name}
                    </div>
                    <div className="space-y-0.5 p-1.5">
                      {table.indexes!.map((idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                        >
                          <Key className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">{idx}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )
        ) : tab === 'history' ? (
          // History tab — server-driven with loading/error/empty states
          historyLoading && history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              <p className="text-xs text-muted-foreground">Loading history...</p>
            </div>
          ) : historyError && history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <p className="text-xs text-muted-foreground">{historyError}</p>
              <button
                type="button"
                onClick={() => loadHistoryPage(0)}
                className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
              >
                Retry
              </button>
            </div>
          ) : history.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No queries yet</p>
          ) : (
            <div className="space-y-1 p-1">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectQuery(item.sql)}
                  className={cn(
                    'w-full rounded-md border p-2 text-left text-xs transition-colors',
                    item.success
                      ? 'border-border hover:bg-muted/50'
                      : 'border-red-200 bg-red-50 hover:bg-red-100'
                  )}
                >
                  <div className="truncate font-mono">{item.sql.substring(0, 50)}</div>
                  <div className="mt-1 text-muted-foreground">{formatTime(item.timestamp)}</div>
                </button>
              ))}
              {hasMoreHistory && (
                <button
                  type="button"
                  onClick={loadMoreHistory}
                  disabled={historyLoading}
                  className="w-full rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
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
