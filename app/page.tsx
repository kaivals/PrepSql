'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ConnectionsPage } from '@/components/ConnectionsPage';
import { SchemaSidebar } from '@/components/SchemaSidebar';
import { QueryInterface } from '@/components/QueryInterface';
import { SchemaEditor } from '@/components/SchemaEditor';
import { AnalyticsPage } from '@/components/AnalyticsPage';
import { Toast } from '@/components/Toast';
import { SettingsModal } from '@/components/SettingsModal';
import { ensureServerConnection } from '@/lib/client-connection';
import { syncApiKeyToServer } from '@/lib/api-key-storage';
import { loadSavedConnection, clearSavedConnection } from '@/lib/connection-defaults';
import { historyQueue } from '@/lib/history-queue';
import { classifyQuery } from '@/lib/history-classify';
import type { DatabaseConnection, QueryHistoryItem, QueryMode, QueryResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type View = 'connections' | 'workspace';

if (typeof window !== 'undefined' && !((window as any).__prepsql_fetch_overridden)) {
  (window as any).__prepsql_fetch_overridden = true;
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const CLIENT_KEY = 'prepsql-client-id';
    let clientId = localStorage.getItem(CLIENT_KEY);
    if (!clientId) {
      // One-time migration: move legacy key so existing users keep their
      // correlation to server-side query_history / analysis_results rows.
      const legacyId = localStorage.getItem('prepsql-session-id');
      if (legacyId) {
        clientId = legacyId;
        localStorage.removeItem('prepsql-session-id');
      } else {
        clientId = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
      }
      localStorage.setItem(CLIENT_KEY, clientId);
    }

    const newInit = { ...init } as RequestInit;
    const headers = new Headers(newInit.headers || {});
    headers.set('x-prepsql-client-id', clientId);
    newInit.headers = headers;

    return originalFetch(input, newInit);
  };
}

export default function Home() {
  const [view, setView] = useState<View>('connections');
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);
  const [mode, setMode] = useState<QueryMode>('crud');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [toast, setToast] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastConfig, setToastConfig] = useState<{
    onConfirm?: () => void;
    confirmText?: string;
    cancelText?: string;
    type?: 'success' | 'error' | 'confirm';
  }>({});
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [userEmail] = useState('user@example.com');
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);

  useEffect(() => {
    const saved = localStorage.getItem('sidebarWidth');
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= 240 && width <= 600) {
        setSidebarWidth(width);
      }
    }
  }, []);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 240 && newWidth <= 600) {
      setSidebarWidth(newWidth);
      localStorage.setItem('sidebarWidth', String(newWidth));
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const loadConnections = useCallback(async (autoRedirect = false, allowAutoConnect = true) => {
    try {
      let res = await fetch('/api/connection', { credentials: 'same-origin' });
      let data = res.ok ? await res.json() : null;

      if (!data?.connected && allowAutoConnect) {
        const reconnected = await ensureServerConnection();
        if (reconnected) {
          res = await fetch('/api/connection', { credentials: 'same-origin' });
          data = res.ok ? await res.json() : null;
        }
      }

      if (data) {
        setConnections(data.connections || []);
        if (data.connection && data.connections?.length > 0) {
          setActiveConnection(data.connection);
          if (autoRedirect) {
            setView('workspace');
          }
        } else {
          setActiveConnection(null);
        }
      }
    } catch (err) {
      console.error('Failed to load connections:', err);
    }
  }, []);

  const loadMode = useCallback(async () => {
    try {
      const res = await fetch('/api/mode');
      if (res.ok) {
        const data = await res.json();
        const mode = data.mode || 'readonly';
        // The top-level History tab was removed; fall back to CRUD for any
        // client whose persisted mode still points at it.
        setMode(mode === 'history' ? 'crud' : mode);
      }
    } catch (err) {
      console.error('Failed to load mode:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Restore the history queue from localStorage and resume syncing any
      // records left pending from a previous session (refresh / restart).
      historyQueue.init();
      await syncApiKeyToServer();
      const savedView = typeof window !== 'undefined' ? localStorage.getItem('prepsql-view') : null;
      const shouldRedirect = savedView === 'workspace';
      await loadConnections(shouldRedirect, true);
      await loadMode();
    };
    init();
  }, [loadConnections, loadMode]);

  /**
   * Persist an executed query to the localStorage history queue. The record
   * is saved synchronously (survives refresh/restart) and the background sync
   * loop pushes it to the database. Called for BOTH successful and failed runs.
   */
  const recordHistory = useCallback(
    (params: {
      sql: string;
      prompt?: string;
      success: boolean;
      error?: string;
      executionTime?: number;
      rowsAffected?: number;
      rowsScanned?: number;
      rowsReturned?: number;
      cpuUsage?: number;
      memoryUsage?: number;
      indexesUsed?: string[];
      timeline?: QueryHistoryItem['timeline'];
    }) => {
      console.debug('[history] recording query:', {
        sql: params.sql.slice(0, 60),
        success: params.success,
        executionTime: params.executionTime,
        rowsScanned: params.rowsScanned,
        rowsReturned: params.rowsReturned,
        cpuUsage: params.cpuUsage,
        memoryUsage: params.memoryUsage,
        indexesUsed: params.indexesUsed,
      });
      historyQueue.enqueue({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        prompt: params.prompt || '',
        sql: params.sql,
        timestamp: Date.now(),
        success: params.success,
        error: params.error,
        queryType: classifyQuery(params.sql),
        connectionId: activeConnection?.id,
        connectionName: activeConnection?.name,
        executionTime: params.executionTime,
        rowsAffected: params.rowsAffected,
        rowsScanned: params.rowsScanned,
        rowsReturned: params.rowsReturned,
        cpuUsage: params.cpuUsage,
        memoryUsage: params.memoryUsage,
        indexesUsed: params.indexesUsed,
        timeline: params.timeline,
      });
      setHistoryRefresh((prev) => prev + 1);
    },
    [activeConnection],
  );

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setToast(message);
    setToastConfig({ type });
    setShowToast(true);
  };

  const showConfirmation = (message: string, onConfirm: () => void) => {
    setToast(message);
    setToastConfig({
      type: 'confirm',
      onConfirm,
      confirmText: 'Execute',
      cancelText: 'Cancel',
    });
    setShowToast(true);
  };

  const handleSelectConnection = async (connection: DatabaseConnection) => {
    await fetch('/api/connection', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id: connection.id }),
    });
    setActiveConnection(connection);
    setResult(null);
    setSelectedTable(null);
    setView('workspace');
    if (typeof window !== 'undefined') {
      localStorage.setItem('prepsql-view', 'workspace');
    }
  };

  const handleDeleteConnection = async (id: string) => {
    if (!confirm('Remove this connection?')) return;

    // Clear from localStorage if it matches the saved connection or if it's the last connection
    const connToDelete = connections.find((c) => c.id === id);
    if (connToDelete) {
      const saved = loadSavedConnection();
      if (saved) {
        const isMatch =
          saved.type === connToDelete.type &&
          (connToDelete.type === 'sqlite'
            ? saved.filepath === connToDelete.filepath
            : saved.host === connToDelete.host &&
              saved.database === connToDelete.database &&
              saved.user === connToDelete.user);
        if (isMatch || connections.length <= 1) {
          clearSavedConnection();
        }
      }
    }

    await fetch(`/api/connection?id=${id}`, { method: 'DELETE' });
    await loadConnections(false, false);
  };

  const handleDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create demo DB');

      await loadConnections(false, false);
      if (data.connection) {
        setActiveConnection(data.connection);
        setView('workspace');
        if (typeof window !== 'undefined') {
          localStorage.setItem('prepsql-view', 'workspace');
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnected = async (_connection: DatabaseConnection) => {
    // Stay on the connections page so the user can see ALL their connections
    // and choose which one to open. Navigating to workspace happens only when
    // the user explicitly clicks a connection card (handleSelectConnection).
    await loadConnections(false, false);
  };

  const handleModeChange = async (newMode: QueryMode) => {
    setMode(newMode);
    await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    });
  };

  const handleExecuteQuery = async (sql: string, prompt?: string) => {
    const upperSql = sql.toUpperCase();
    const isMutation = upperSql.includes('UPDATE ') || upperSql.includes('DELETE ');

    if (isMutation) {
      const action = upperSql.includes('UPDATE ') ? 'UPDATE' : 'DELETE';
      showConfirmation(
        `Are you sure you want to execute this ${action} operation?\n\n${sql}`,
        () => executeQueryInternal(sql, prompt)
      );
      return;
    }

    await executeQueryInternal(sql, prompt);
  };

  const executeQueryInternal = async (sql: string, prompt?: string) => {
    setLoading(true);
    setResult(null);
    const startedAt = performance.now();

    try {
      await ensureServerConnection();

      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sql }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Query execution failed');
      }

      const data = await res.json();
      setResult(data);

      // Persist to the localStorage history queue immediately. The background
      // sync loop forwards it to the database; metrics come from the server.
      recordHistory({
        sql,
        prompt,
        success: true,
        executionTime: data.executionTime ?? Math.round(performance.now() - startedAt),
        rowsAffected: data.rowsAffected,
        rowsScanned: data.rowsScanned,
        rowsReturned: data.rowCount,
        cpuUsage: data.cpuUsage,
        memoryUsage: data.memoryUsage,
        indexesUsed: data.indexesUsed,
        timeline: data.timeline,
      });

      const upperSql = sql.toUpperCase();
      if (upperSql.includes('UPDATE ') || upperSql.includes('DELETE ')) {
        const action = upperSql.includes('UPDATE ') ? 'Update' : 'Delete';
        showNotification(`${action} successful. Rows affected: ${data.rowsAffected || 0}`, 'success');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Query execution failed';
      setResult({ columns: [], rows: [], rowCount: 0 });

      // Failed queries are recorded too — no history is ever lost.
      recordHistory({
        sql,
        prompt,
        success: false,
        error: errorMsg,
        executionTime: Math.round(performance.now() - startedAt),
        rowsAffected: 0,
        rowsScanned: 0,
        rowsReturned: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        indexesUsed: [],
      });

      const upperSql = sql.toUpperCase();
      if (upperSql.includes('UPDATE ') || upperSql.includes('DELETE ')) {
        showNotification(`Error: ${errorMsg}`, 'error');
      }
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setView('connections');
    if (typeof window !== 'undefined') {
      localStorage.setItem('prepsql-view', 'connections');
    }
    setActiveConnection(null);
    setResult(null);
  };

  if (view === 'workspace' && activeConnection) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <AppHeader
          userEmail={userEmail}
          showModeSwitcher
          mode={mode}
          onModeChange={handleModeChange}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettings(true)}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
        <Toast
          message={toast}
          visible={showToast}
          onDismiss={() => setShowToast(false)}
          onConfirm={toastConfig.onConfirm}
          confirmText={toastConfig.confirmText}
          cancelText={toastConfig.cancelText}
          type={toastConfig.type}
        />
        <SettingsModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
        />
        <div className="flex flex-1 overflow-hidden relative">
          {sidebarOpen && (
            <div
              className="absolute inset-0 z-30 bg-black/20 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              'absolute inset-y-0 left-0 z-40 md:static md:overflow-hidden relative max-w-[85vw] md:max-w-none',
              isResizing ? 'transition-none' : 'transition-all duration-300',
              sidebarOpen
                ? 'translate-x-0 w-72 md:w-[var(--sidebar-width)] border-r border-border'
                : '-translate-x-full w-72 md:translate-x-0 md:w-0 md:border-r-0'
            )}
            style={{
              '--sidebar-width': `${sidebarWidth}px`,
            } as React.CSSProperties}
          >
            <SchemaSidebar
              connection={activeConnection}
              onBack={() => {
                setView('connections');
                if (typeof window !== 'undefined') {
                  localStorage.setItem('prepsql-view', 'connections');
                }
                setResult(null);
              }}
              onSelectQuery={(sql) => {
                handleExecuteQuery(sql);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              onSelectTable={(tbl) => setSelectedTable(tbl)}
              refreshTrigger={historyRefresh}
            />
            {/* Resize Handle */}
            {sidebarOpen && (
              <div
                onMouseDown={startResizing}
                className="absolute top-0 right-0 bottom-0 w-2 -mr-1 cursor-col-resize group z-50 md:block hidden"
              >
                <div className="w-[2px] h-full mx-auto bg-transparent group-hover:bg-primary/40 group-active:bg-primary transition-colors" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            {mode === 'schema' ? (
              <SchemaEditor
                connection={activeConnection}
                selectedTable={selectedTable}
                showConfirmation={showConfirmation}
                showNotification={showNotification}
                onRefreshSchema={() => setHistoryRefresh((prev) => prev + 1)}
              />
            ) : mode === 'analytics' ? (
              <AnalyticsPage
                connection={activeConnection}
                showConfirmation={showConfirmation}
                showNotification={showNotification}
                onRefreshSchema={() => setHistoryRefresh((prev) => prev + 1)}
              />
            ) : (
              <QueryInterface
                connectionId={activeConnection?.id}
                onExecute={handleExecuteQuery}
                isLoading={loading}
                result={result}
                onOpenSettings={() => setShowSettings(true)}
                onQueryResult={(res) => setResult(res)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader userEmail={userEmail} onLogout={handleLogout} onOpenSettings={() => setShowSettings(true)} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <ConnectionsPage
        connections={connections}
        onSelect={handleSelectConnection}
        onDelete={handleDeleteConnection}
        onDemo={handleDemo}
        onConnected={handleConnected}
        loading={loading}
      />
    </div>
  );
}
