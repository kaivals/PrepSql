'use client';

import { useState, useEffect, useRef } from 'react';
import { Database, Plus, Trash2, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionForm } from '@/components/ConnectionForm';
import type { DatabaseConnection } from '@/lib/types';

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
  // Must NOT depend on connections.length — that would reopen the modal
  // every time a connection is added or removed.
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Step 01 — Connect
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Your databases</h1>
          <p className="mt-2 max-w-lg text-muted-foreground">
            Add a Postgres, MySQL or SQLite connection. We introspect the schema and cache it for
            prompt grounding.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={onDemo} disabled={loading} className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Try demo DB
          </Button>
          <Button onClick={() => setShowModal(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New connection
          </Button>
        </div>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center">
          <Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-muted-foreground">No connections yet. Try the demo DB or add a new one.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="group relative cursor-pointer rounded-xl border border-border bg-white p-5 transition-shadow hover:shadow-md"
              onClick={() => onSelect(conn)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(conn)}
              role="button"
              tabIndex={0}
            >
              <div className="mb-6 flex items-start justify-between">
                <Database className="h-4 w-4 text-muted-foreground" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setTimeout(() => {
                      onDelete(conn.id);
                    }, 0);
                  }}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <h3 className="font-semibold">{conn.name}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{conn.type}</p>
              <p className="mt-2 truncate text-xs text-muted-foreground/70">{getConnectionPath(conn)}</p>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">New connection</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
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
