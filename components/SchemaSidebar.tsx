'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ArrowLeft,
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

interface SchemaSidebarProps {
  connection: DatabaseConnection;
  onBack: () => void;
  onSelectQuery: (sql: string) => void;
  onSelectTable?: (tableName: string) => void;
  onEditTable?: (tableName: string) => void;
  refreshTrigger?: number;
  selectedTable?: string | null;
  defaultTab?: 'schema' | 'history' | 'indexes';
}

export function SchemaSidebar({
  connection,
  onBack,
  onSelectQuery,
  onSelectTable,
  onEditTable,
  refreshTrigger,
  selectedTable,
  defaultTab = 'schema',
}: SchemaSidebarProps) {
  const [tab, setTab] = useState<'schema' | 'history' | 'indexes'>(defaultTab);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // History is fetched from the server-side store via /api/history.
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

  // Fetch history from the server-side store.
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

  // Auto-update tab if defaultTab changes (e.g. NavigationSidebar clicked)
  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

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

  // DB type badge color
  const dbTypeColor = {
    postgresql: 'bg-blue-500/20 text-blue-300',
    mysql: 'bg-orange-500/20 text-orange-300',
    mariadb: 'bg-amber-500/20 text-amber-300',
    sqlite: 'bg-emerald-500/20 text-emerald-300',
  };

  return (
    <aside className="flex h-full w-full shrink-0 flex-col bg-[#0B0F1A]">
      {/* Connection info header */}
      <div className="border-b border-white/10 px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All connections
        </button>
        <h2 className="text-sm font-semibold leading-tight text-white">{connection.name}</h2>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={cn(
            'inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            dbTypeColor[connection.type as keyof typeof dbTypeColor] || 'bg-slate-500/20 text-slate-300'
          )}>
            {connection.type}
          </span>
          <span className="text-[11px] text-slate-500">
            {connection.host ? `${connection.host}:${connection.port}` : connection.filepath}
          </span>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-white/10">
        <button
          type="button"
          onClick={() => setTab('schema')}
          className={cn(
            'relative flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors',
            tab === 'schema' ? 'text-white' : 'text-slate-500 hover:text-slate-300'
          )}
        >
          <Table2 className="h-3.5 w-3.5" />
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
            tab === 'history' ? 'text-white' : 'text-slate-500 hover:text-slate-300'
          )}
        >
          <Clock className="h-3.5 w-3.5" />
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
            tab === 'indexes' ? 'text-white' : 'text-slate-500 hover:text-slate-300'
          )}
        >
          <Key className="h-3.5 w-3.5" />
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
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
            </div>
          ) : tables.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-500">No tables found</p>
          ) : (
            <div className="space-y-0.5">
              {tables.map((table) => (
                <div key={table.name}>
                  <div
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all duration-150',
                      selectedTable === table.name
                        ? 'bg-primary/15 text-white'
                        : 'text-slate-300 hover:bg-white/[0.06]'
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-slate-500 transition-transform duration-200',
                        expanded.has(table.name) && 'rotate-90'
                      )}
                    />
                    <Table2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="flex-1 truncate text-left text-[13px]">{table.name}</span>
                    <span className="text-[11px] tabular-nums text-slate-500">{table.rowCount}</span>
                  </button>
                  {expanded.has(table.name) && (
                    <div className="ml-9 space-y-0.5 pb-1.5">
                      {table.columns.map((col, ci) => (
                        <div
                          key={`${table.name}-${col.name}-${ci}`}
                          className="flex items-center justify-between rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-white/[0.04]"
                        >
                          <span className="text-slate-400">{col.name}</span>
                          <span className="font-mono text-[10px] text-slate-600">{col.type}</span>
                        </div>
                      ))}
                      {table.indexes && table.indexes.length > 0 && (
                        <div className="mt-2 border-t border-white/[0.06] pt-2">
                          <span className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Indexes
                          </span>
                          {table.indexes.map((idx) => (
                            <div
                              key={idx}
                              className="flex items-center px-2.5 py-1 text-xs text-slate-500"
                            >
                              <Key className="mr-2 h-2.5 w-2.5 text-slate-600" />
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
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
            </div>
          ) : tables.every((t) => !t.indexes || t.indexes.length === 0) ? (
            <p className="px-3 py-4 text-xs text-slate-500">No indexes found</p>
          ) : (
            <div className="space-y-2.5 p-1.5">
              {tables
                .filter((t) => t.indexes && t.indexes.length > 0)
                .map((table) => (
                  <div key={table.name} className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.03]">
                    <div className="border-b border-white/[0.06] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300">
                      {table.name}
                    </div>
                    <div className="space-y-0.5 p-1.5">
                      {table.indexes!.map((idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/[0.06]"
                        >
                          <Key className="h-3 w-3 shrink-0 text-slate-600" />
                          <span className="truncate">{idx}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )
        ) : tab === 'history' ? (
          historyLoading && history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
              <p className="text-xs text-slate-500">Loading history...</p>
            </div>
          ) : historyError && history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <p className="text-xs text-slate-500">{historyError}</p>
              <button
                type="button"
                onClick={() => loadHistoryPage(0)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/[0.06]"
              >
                Retry
              </button>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Clock className="mb-2 h-6 w-6 text-slate-600" />
              <p className="text-xs text-slate-500">No queries yet</p>
            </div>
          ) : (
            <div className="space-y-1.5 p-1.5">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectQuery(item.sql)}
                  className={cn(
                    'w-full rounded-lg border p-2.5 text-left transition-colors',
                    item.success
                      ? 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06]'
                      : 'border-red-500/20 bg-red-500/[0.06] hover:bg-red-500/10'
                  )}
                >
                  <div className="truncate font-mono text-[11px] text-slate-300">{item.sql.substring(0, 60)}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      item.success ? 'bg-emerald-500' : 'bg-red-500'
                    )} />
                    <span className="text-[10px] text-slate-500">{formatTime(item.timestamp)}</span>
                  </div>
                </button>
              ))}
              {hasMoreHistory && (
                <button
                  type="button"
                  onClick={loadMoreHistory}
                  disabled={historyLoading}
                  className="w-full rounded-lg border border-dashed border-white/10 py-2 text-xs text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-300 disabled:opacity-50"
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
