'use client';

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { Database, LogOut, BarChart3, Settings, Table2, Menu, Search, ChevronDown } from 'lucide-react';
import type { QueryMode, SchemaTable } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  userEmail?: string;
  showModeSwitcher?: boolean;
  mode?: QueryMode;
  onModeChange?: (mode: QueryMode) => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  connectionId?: string;
  refreshTrigger?: number;
  onPickTable?: (tableName: string) => void;
}

export function AppHeader({
  userEmail = 'user@example.com',
  showModeSwitcher = false,
  mode = 'crud',
  onModeChange,
  onLogout,
  onOpenSettings,
  onToggleSidebar,
  connectionId,
  refreshTrigger,
  onPickTable,
}: AppHeaderProps) {
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Position the dropdown fixed below the trigger button
  useLayoutEffect(() => {
    if (!dropdownOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.right - 288 }); // 288px = w-72
  }, [dropdownOpen]);

  // Fetch tables whenever the dropdown opens (so the list is fresh)
  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const res = await fetch('/api/schema');
      if (res.ok) {
        const data = await res.json();
        setTables(data.tables || []);
      }
    } catch (err) {
      console.error('Failed to load tables:', err);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dropdownOpen) {
      loadTables();
      setTableSearch('');
      // Focus the search input shortly after opening
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [dropdownOpen, loadTables]);

  // Refetch when the connection changes or schema is refreshed, if dropdown is open
  useEffect(() => {
    if (dropdownOpen) loadTables();
  }, [connectionId, refreshTrigger, dropdownOpen, loadTables]);

  // Close the dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const handlePickTable = (tableName: string) => {
    if (onModeChange) onModeChange('schema');
    if (onPickTable) onPickTable(tableName);
    setDropdownOpen(false);
    setTableSearch('');
  };

  const handleSchemaEditorClick = () => {
    if (onModeChange) onModeChange('schema');
    setDropdownOpen((prev) => !prev);
  };

  const modes: { id: QueryMode; label: string; icon?: ReactNode }[] = [
    { id: 'crud', label: 'CRUD' },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-3 w-3" /> },
  ];

  return (
    <header className="relative border-b border-border bg-white">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2.5">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="mr-1 rounded p-1 text-muted-foreground hover:bg-muted md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-7 w-7 items-center justify-center rounded bg-foreground">
            <Database className="h-3.5 w-3.5 text-background" />
          </div>
          <span className="text-base font-semibold tracking-tight">PrepSQL</span>
        </div>

        {showModeSwitcher && onModeChange && (
          <div className="absolute left-1/2 top-14 flex w-full -translate-x-1/2 items-center justify-center border-b border-border bg-white p-1.5 md:static md:w-auto md:translate-x-0 md:border-none md:bg-muted/40 md:p-0.5 md:rounded-lg">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onModeChange(m.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 md:px-4 text-xs md:text-sm font-medium transition-colors',
                  mode === m.id
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m.icon}
                {m.label}
              </button>
            ))}

            {/* Schema Editor dropdown trigger */}
            <button
              ref={triggerRef}
              type="button"
              onClick={handleSchemaEditorClick}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 md:px-4 text-xs md:text-sm font-medium transition-colors',
                mode === 'schema'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Table2 className="h-3 w-3" />
              Schema Editor
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  dropdownOpen && 'rotate-180'
                )}
              />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </button>
          )}
          <span className="hidden text-muted-foreground md:inline">{userEmail}</span>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="h-4 w-4 md:h-3.5 md:w-3.5" />
              <span className="hidden md:inline">Log out</span>
            </button>
          )}
        </div>
      </div>

      {/* Floating dropdown — rendered as fixed overlay so nothing clips it */}
      {dropdownOpen && (
        <div
          ref={dropdownRef}
          className="fixed z-[100] w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          style={{ top: dropdownPos.top, left: Math.max(dropdownPos.left, 8) }}
        >
          {/* Search input */}
          <div className="relative border-b border-border p-2">
            <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search tables…"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/50"
            />
          </div>
          {/* Table list */}
          <div className="max-h-72 overflow-y-auto p-1">
            {tablesLoading ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading tables…</p>
            ) : filteredTables.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {tables.length === 0 ? 'No tables found' : 'No tables match your search'}
              </p>
            ) : (
              filteredTables.map((table) => (
                <button
                  key={table.name}
                  type="button"
                  onClick={() => handlePickTable(table.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{table.name}</span>
                  <span className="text-xs text-muted-foreground">{table.rowCount}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </header>
  );
}
