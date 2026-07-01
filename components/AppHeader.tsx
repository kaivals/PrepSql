'use client';

import { useState, useEffect, useRef } from 'react';
import { Database, LogOut, User, ChevronDown, Menu, Plug2, Plus, Trash2, Zap, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConnectionForm } from '@/components/ConnectionForm';
import type { DatabaseConnection } from '@/lib/types';

interface AppHeaderProps {
  userEmail?: string;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  connectionId?: string;
  connections?: DatabaseConnection[];
  activeConnection?: DatabaseConnection | null;
  onSelectConnection?: (connection: DatabaseConnection) => void;
  onDeleteConnection?: (id: string) => void;
  onDemo?: () => void;
  onConnected?: (connection: DatabaseConnection) => void;
  onViewAllConnections?: () => void;
  loading?: boolean;
}

const dbTypeColor: Record<string, string> = {
  postgresql: 'bg-blue-50 text-blue-700 border-blue-200',
  mysql: 'bg-orange-50 text-orange-700 border-orange-200',
  mariadb: 'bg-amber-50 text-amber-700 border-amber-200',
  sqlite: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function getConnectionPath(conn: DatabaseConnection) {
  if (conn.type === 'sqlite') return conn.filepath || '';
  return `${conn.host}:${conn.port}/${conn.database}`;
}

export function AppHeader({
  userEmail = 'user@example.com',
  onLogout,
  onOpenSettings,
  onToggleSidebar,
  connections = [],
  activeConnection,
  onSelectConnection,
  onDeleteConnection,
  onDemo,
  onConnected,
  onViewAllConnections,
  loading = false,
}: AppHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const connDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (connDropdownRef.current && !connDropdownRef.current.contains(e.target as Node)) {
        setConnDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Close connection dropdown when selecting a connection
  const handleSelectConnection = (conn: DatabaseConnection) => {
    setConnDropdownOpen(false);
    onSelectConnection?.(conn);
  };

  const handleDeleteConnection = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDeleteConnection?.(id);
  };

  // Get user initials for avatar
  const initials = userEmail
    .split('@')[0]
    .split(/[._-]/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Capitalize name
  const userName = userEmail
    .split('@')[0]
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return (
    <>
      <header className="relative border-b border-border bg-card shrink-0">
        <div className="flex h-14 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2.5">
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shadow-sm">
                <Database className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <span className="text-[14px] font-semibold tracking-tight text-foreground">PrepSQL</span>
            </div>
          </div>

          {/* Connection selector */}
          <div className="relative" ref={connDropdownRef}>
            <button
              type="button"
              onClick={() => setConnDropdownOpen(!connDropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:bg-muted/50 shadow-sm cursor-pointer"
            >
              <Plug2 className="h-3.5 w-3.5 text-muted-foreground" />
              {activeConnection ? (
                <span className="max-w-[180px] truncate">{activeConnection.name}</span>
              ) : (
                <span className="text-muted-foreground">Select connection</span>
              )}
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                  connDropdownOpen && 'rotate-180'
                )}
              />
            </button>

            {connDropdownOpen && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* Connection list */}
                {connections.length > 0 && (
                  <div className="max-h-64 overflow-y-auto">
                    {connections.map((conn) => (
                      <div
                        key={conn.id}
                        onClick={() => handleSelectConnection(conn)}
                        className={cn(
                          'group flex items-center justify-between rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
                          activeConnection?.id === conn.id
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted/50 text-foreground'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn(
                            'inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                            dbTypeColor[conn.type] || 'bg-slate-50 text-slate-600 border-slate-200'
                          )}>
                            {conn.type}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{conn.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{getConnectionPath(conn)}</p>
                          </div>
                        </div>
                        {onDeleteConnection && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteConnection(e, conn.id)}
                            className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {connections.length === 0 && (
                  <div className="px-2.5 py-4 text-center">
                    <p className="text-xs text-muted-foreground">No connections yet</p>
                  </div>
                )}

                {onViewAllConnections && connections.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setConnDropdownOpen(false); onViewAllConnections(); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                  >
                    <span>View all connections</span>
                  </button>
                )}

                {/* Divider + action buttons */}
                <div className="border-t border-border mt-1 pt-1">
                  {onDemo && (
                    <button
                      type="button"
                      onClick={() => { setConnDropdownOpen(false); onDemo(); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Try demo DB</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setConnDropdownOpen(false); setShowModal(true); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>New connection</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Side: Profile Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 rounded-full p-1 hover:bg-muted/50 transition-all border border-border bg-card shadow-sm focus:outline-none cursor-pointer"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {initials}
              </div>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground mr-0.5 transition-transform duration-200',
                  dropdownOpen && 'rotate-180'
                )}
              />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-xl p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2 border-b border-border mb-1 shrink-0">
                  <p className="text-xs font-semibold text-foreground truncate">{userName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
                </div>

                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSettings();
                      setDropdownOpen(false);
                    }}
                    className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
                    <span>Profile</span>
                  </button>
                )}

                {onLogout && (
                  <button
                    type="button"
                    onClick={() => {
                      onLogout();
                      setDropdownOpen(false);
                    }}
                    className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5 text-red-500 transition-colors group-hover:text-red-600" />
                    <span>Sign out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

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
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ConnectionForm
              prefillSaved={false}
              onConnected={(conn) => {
                onConnected?.(conn);
                setShowModal(false);
              }}
              isLoading={loading}
            />
          </div>
        </div>
      )}
    </>
  );
}
