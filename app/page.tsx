'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ConnectionsPage } from '@/components/ConnectionsPage';
import { SchemaSidebar } from '@/components/SchemaSidebar';
import { QueryInterface } from '@/components/QueryInterface';
import { SchemaEditor } from '@/components/SchemaEditor';
import { AnalyticsPage } from '@/components/AnalyticsPage';
import { Toast } from '@/components/Toast';
import { SettingsModal } from '@/components/SettingsModal';
import { ensureServerConnection } from '@/lib/client-connection';
import type { DatabaseConnection, QueryMode, QueryResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type View = 'connections' | 'workspace';

// ── Client-side helpers for preferences (backed by /api/preferences) ─────────

async function loadPreferences(): Promise<Record<string, any>> {
  try {
    const res = await fetch('/api/preferences', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      return data.preferences || {};
    }
  } catch {
    // ignore
  }
  return {};
}

function savePreference(key: string, value: any): void {
  try {
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ preferences: { [key]: value } }),
    });
  } catch {
    // fire-and-forget
  }
}

function clearSavedConnectionAPI(): void {
  try {
    fetch('/api/saved-connection', { method: 'DELETE', credentials: 'same-origin' });
  } catch {
    // fire-and-forget
  }
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
  const [initializing, setInitializing] = useState(true);
  const saveWidthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load sidebar width from server-side preferences on mount
  useEffect(() => {
    loadPreferences().then((prefs) => {
      if (prefs.sidebarWidth) {
        const width = parseInt(prefs.sidebarWidth, 10);
        if (width >= 240 && width <= 600) {
          setSidebarWidth(width);
        }
      }
    });
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
      // Debounce saving to API
      if (saveWidthTimer.current) clearTimeout(saveWidthTimer.current);
      saveWidthTimer.current = setTimeout(() => {
        savePreference('sidebarWidth', String(newWidth));
      }, 500);
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
        const m = data.mode || 'readonly';
        setMode(m === 'history' ? 'crud' : m);
      }
    } catch (err) {
      console.error('Failed to load mode:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const prefs = await loadPreferences();
      const savedView = prefs['prepsql-view'];
      const shouldRedirect = savedView === 'workspace';
      await loadConnections(shouldRedirect, true);
      await loadMode();
      setInitializing(false);
    };
    init();
  }, [loadConnections, loadMode]);

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

  const setViewPref = (newView: View) => {
    setView(newView);
    savePreference('prepsql-view', newView);
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
    setViewPref('workspace');
  };

  const handleDeleteConnection = async (id: string) => {
    if (!confirm('Remove this connection?')) return;

    if (connections.length <= 1) {
      clearSavedConnectionAPI();
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
        setViewPref('workspace');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnected = async (_connection: DatabaseConnection) => {
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

      // History is now persisted server-side by /api/execute.
      // Trigger a refresh so the sidebar and analytics pick up the new entry.
      setHistoryRefresh((prev) => prev + 1);

      const upperSql = sql.toUpperCase();
      if (upperSql.includes('UPDATE ') || upperSql.includes('DELETE ')) {
        const action = upperSql.includes('UPDATE ') ? 'Update' : 'Delete';
        showNotification(`${action} successful. Rows affected: ${data.rowsAffected || 0}`, 'success');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Query execution failed';
      setResult({ columns: [], rows: [], rowCount: 0 });

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
    setViewPref('connections');
    setActiveConnection(null);
    setResult(null);
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="text-sm text-muted-foreground">Loading PrepSQL...</p>
        </div>
      </div>
    );
  }

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
          connectionId={activeConnection?.id}
          refreshTrigger={historyRefresh}
          onPickTable={(tableName) => setSelectedTable(tableName)}
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
                setViewPref('connections');
                setResult(null);
              }}
              onSelectQuery={(sql) => {
                handleExecuteQuery(sql);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              onSelectTable={(tbl) => setSelectedTable(tbl)}
              refreshTrigger={historyRefresh}
              selectedTable={selectedTable}
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
