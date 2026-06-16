'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ConnectionsPage } from '@/components/ConnectionsPage';
import { SchemaSidebar } from '@/components/SchemaSidebar';
import { QueryInterface } from '@/components/QueryInterface';
import { Toast } from '@/components/Toast';
import { SettingsModal } from '@/components/SettingsModal';
import { ensureServerConnection } from '@/lib/client-connection';
import { syncApiKeyToServer } from '@/lib/api-key-storage';
import type { DatabaseConnection, QueryMode, QueryResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type View = 'connections' | 'workspace';

export default function Home() {
  const [view, setView] = useState<View>('connections');
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);
  const [mode, setMode] = useState<QueryMode>('readonly');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [toast, setToast] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userEmail] = useState('user@example.com');

  const loadConnections = useCallback(async () => {
    try {
      let res = await fetch('/api/connection', { credentials: 'same-origin' });
      let data = res.ok ? await res.json() : null;

      if (!data?.connected) {
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
          setView('workspace');
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
        setMode(data.mode || 'readonly');
      }
    } catch (err) {
      console.error('Failed to load mode:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await syncApiKeyToServer();
      await loadConnections();
      await loadMode();
    };
    init();
  }, [loadConnections, loadMode]);

  const showNotification = (message: string) => {
    setToast(message);
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
    setView('workspace');
  };

  const handleDeleteConnection = async (id: string) => {
    if (!confirm('Remove this connection?')) return;
    await fetch(`/api/connection?id=${id}`, { method: 'DELETE' });
    await loadConnections();
    if (activeConnection?.id === id) {
      setActiveConnection(null);
      setView('connections');
    }
  };

  const handleDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create demo DB');

      await loadConnections();
      if (data.connection) {
        setActiveConnection(data.connection);
        setView('workspace');
        showNotification('Demo database ready');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Demo setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConnected = async (connection: DatabaseConnection) => {
    await loadConnections();
    setActiveConnection(connection);
    setView('workspace');
    showNotification('Connected successfully');
  };

  const handleModeChange = async (newMode: QueryMode) => {
    setMode(newMode);
    await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    });
  };

  const handleExecuteQuery = async (sql: string) => {
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
      setHistoryRefresh((prev) => prev + 1);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Query execution failed';
      setResult({ columns: [], rows: [], rowCount: 0 });
      alert(`Error: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setView('connections');
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
        <Toast message={toast} visible={showToast} onDismiss={() => setShowToast(false)} />
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
              'absolute inset-y-0 left-0 z-40 transition-all duration-300 md:static md:overflow-hidden',
              sidebarOpen
                ? 'translate-x-0 w-72 md:w-80 border-r border-border'
                : '-translate-x-full w-72 md:translate-x-0 md:w-0 md:border-r-0'
            )}
          >
            <SchemaSidebar
              connection={activeConnection}
              onBack={() => {
                setView('connections');
                setResult(null);
              }}
              onSelectQuery={(sql) => {
                handleExecuteQuery(sql);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              refreshTrigger={historyRefresh}
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <QueryInterface
              onExecute={handleExecuteQuery}
              isLoading={loading}
              result={result}
              onOpenSettings={() => setShowSettings(true)}
            />
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
