'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Table2,
} from 'lucide-react';
import type { DatabaseConnection, QueryHistoryItem, SchemaTable } from '@/lib/types';
import { buildSelectPreview } from '@/lib/schema-format';
import { cn } from '@/lib/utils';

interface SchemaSidebarProps {
  connection: DatabaseConnection;
  onBack: () => void;
  onSelectQuery: (sql: string) => void;
  refreshTrigger?: number;
}

export function SchemaSidebar({
  connection,
  onBack,
  onSelectQuery,
  refreshTrigger,
}: SchemaSidebarProps) {
  const [tab, setTab] = useState<'schema' | 'history'>('schema');
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

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
  }, [connection.id]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await fetch('/api/history');
        if (res.ok) {
          const data = await res.json();
          setHistory(data.history || []);
        }
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    };
    loadHistory();
  }, [refreshTrigger]);

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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-white">
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
                    type="button"
                    onClick={() => toggleTable(table.name)}
                    onDoubleClick={() => onSelectQuery(buildSelectPreview(table, connection.type))}
                    title="Click to expand · Double-click to preview rows"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
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
                      {table.columns.map((col) => (
                        <div
                          key={col.name}
                          className="flex items-center justify-between px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <span>{col.name}</span>
                          <span className="text-muted-foreground/60">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
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
          </div>
        )}
      </div>
    </aside>
  );
}
