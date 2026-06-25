'use client';

import { useState, useEffect, useRef } from 'react';
import { Database, Plus, Trash2, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionForm } from '@/components/ConnectionForm';
import type { DatabaseConnection } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ConnectionsPageProps {
  connections: DatabaseConnection[];
  onSelect: (connection: DatabaseConnection) => void;
  onDelete: (id: string) => void;
  onDemo: () => void;
  onConnected: (connection: DatabaseConnection) => void;
  loading?: boolean;
  openFormOnLoad?: boolean;
}

export function ConnectionsPage({
  connections,
  onSelect,
  onDelete,
  onDemo,
  onConnected,
  loading = false,
  openFormOnLoad = true,
}: ConnectionsPageProps) {
  const [showModal, setShowModal] = useState(false);
  const didAutoOpen = useRef(false);

  // Auto-open only once on mount when there are no connections yet.
  useEffect(() => {
    if (didAutoOpen.current) return;
    didAutoOpen.current = true;
    if (openFormOnLoad && connections.length === 0) {
      setShowModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getConnectionPath = (conn: DatabaseConnection) => {
    if (conn.type === 'sqlite') return conn.filepath || '';
    return `${conn.host}:${conn.port}/${conn.database}`;
  };

  const dbTypeColor: Record<string, string> = {
    postgresql: 'bg-blue-50 text-blue-700 border-blue-200',
    mysql: 'bg-orange-50 text-orange-700 border-orange-200',
    mariadb: 'bg-amber-50 text-amber-700 border-amber-200',
    sqlite: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 lg:py-20">
      {/* Hero */}
      <div className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
            Step 01 — Connect
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your databases</h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-500">
            Add a Postgres, MySQL or SQLite connection. We introspect the schema and cache it for
            prompt grounding.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button variant="outline" onClick={onDemo} disabled={loading} className="gap-2 rounded-lg px-4 py-2 text-sm">
            <Zap className="h-3.5 w-3.5" />
            Try demo DB
          </Button>
          <Button onClick={() => setShowModal(true)} className="gap-2 rounded-lg px-4 py-2 text-sm">
            <Plus className="h-3.5 w-3.5" />
            New connection
          </Button>
        </div>
      </div>

      {/* Connection cards */}
      {connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Database className="h-7 w-7 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">No connections yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Try the demo DB or add a new connection.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="group relative cursor-pointer rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md"
              onClick={() => onSelect(conn)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(conn)}
              role="button"
              tabIndex={0}
            >
              <div className="mb-6 flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Database className="h-5 w-5 text-primary" />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setTimeout(() => {
                      onDelete(conn.id);
                    }, 0);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <h3 className="text-base font-semibold text-slate-900">{conn.name}</h3>
              <div className="mt-2 flex items-center gap-2">
                <span className={cn(
                  'inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                  dbTypeColor[conn.type] || 'bg-slate-50 text-slate-600 border-slate-200'
                )}>
                  {conn.type}
                </span>
              </div>
              <p className="mt-3 truncate font-mono text-xs text-slate-400">{getConnectionPath(conn)}</p>
            </div>
          ))}
        </div>
      )}

      {/* New Connection Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">New connection</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Connect to your database</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ConnectionForm
              prefillSaved={false}
              onConnected={(conn) => {
                onConnected(conn);
                setShowModal(false);
              }}
              isLoading={loading}
            />
          </div>
        </div>
      )}
    </div>
  );
}
