'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { POSTGRES_DEFAULTS } from '@/lib/connection-defaults';
import type { DatabaseConnection } from '@/lib/types';

interface Props {
  onConnected: (connection: DatabaseConnection) => void;
  isLoading?: boolean;
  autoConnect?: boolean;
  /** When true, pre-fill form from server-side saved credentials (for auto-reconnect).
   *  When false (default), start with a blank/generic form for a brand-new connection. */
  prefillSaved?: boolean;
}

export function ConnectionForm({ onConnected, isLoading = false, autoConnect = false, prefillSaved = false }: Props) {
  const [dbType, setDbType] = useState<'sqlite' | 'postgresql' | 'mysql' | 'mariadb'>('postgresql');
  const [name, setName] = useState(POSTGRES_DEFAULTS.name);
  const [host, setHost] = useState(POSTGRES_DEFAULTS.host);
  const [port, setPort] = useState(String(POSTGRES_DEFAULTS.port));
  const [user, setUser] = useState(POSTGRES_DEFAULTS.user);
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState(POSTGRES_DEFAULTS.database);
  const [filepath, setFilepath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const portDefaults = {
    postgresql: String(POSTGRES_DEFAULTS.port),
    mysql: '3306',
    mariadb: '3306',
    sqlite: '',
  };

  useEffect(() => {
    // New connection path: start blank so the user must fill in fresh details.
    // Keep the POSTGRES_DEFAULTS for host/port/user as hints, but clear name,
    // password, and database. Credentials are persisted server-side via
    // /api/connection (which calls db.saveSavedConnection in MongoDB).
    setName('');
    setPassword('');
    setDatabase('');
    setReady(true);
  }, [prefillSaved]);

  const applyPostgresDefaults = () => {
    setName(POSTGRES_DEFAULTS.name);
    setHost(POSTGRES_DEFAULTS.host);
    setPort(String(POSTGRES_DEFAULTS.port));
    setUser(POSTGRES_DEFAULTS.user);
    setDatabase(POSTGRES_DEFAULTS.database);
  };

  const handleDbTypeChange = (type: typeof dbType) => {
    setDbType(type);
    setPort(portDefaults[type]);
    setError('');
    if (type === 'postgresql') {
      applyPostgresDefaults();
    }
  };

  const connect = async () => {
    setLoading(true);
    setError('');

    try {
      const payload: Omit<DatabaseConnection, 'id'> = {
        type: dbType,
        name: name || dbType,
      };

      if (dbType === 'sqlite') {
        payload.filepath = filepath;
      } else {
        payload.host = host;
        payload.port = parseInt(port, 10);
        payload.user = user;
        payload.password = password;
        payload.database = database;
      }

      const res = await fetch('/api/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to connect');
      }

      const data = await res.json();
      // Connection credentials are persisted server-side by /api/connection
      // (app-state.addConnection -> db.saveSavedConnection in MongoDB).
      onConnected(data.connection);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !autoConnect || loading || isLoading) return;
    if (password) {
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoConnect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await connect();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Database Type</label>
        <div className="grid grid-cols-2 gap-2">
          {(['sqlite', 'postgresql', 'mysql', 'mariadb'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleDbTypeChange(type)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                dbType === type
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-muted'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Connection Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="LocalPostgreSQL"
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {dbType === 'sqlite' ? (
        <div>
          <label className="mb-1 block text-sm font-medium">File Path</label>
          <input
            type="text"
            value={filepath}
            onChange={(e) => setFilepath(e.target.value)}
            placeholder="/path/to/database.db"
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="localhost"
                required
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">User</label>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="postgres"
              required
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your postgres password"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Database</label>
            <input
              type="text"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="sequelize_db"
              required
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </>
      )}

      {error && (
        <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}

      <Button type="submit" disabled={loading || isLoading} className="w-full">
        {loading ? 'Connecting...' : 'Connect Database'}
      </Button>
    </form>
  );
}
