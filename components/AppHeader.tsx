'use client';

import type { ReactNode } from 'react';
import { Database, LogOut, BarChart3, Settings, Table2, Menu } from 'lucide-react';
import type { QueryMode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  userEmail?: string;
  showModeSwitcher?: boolean;
  mode?: QueryMode;
  onModeChange?: (mode: QueryMode) => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
}

export function AppHeader({
  userEmail = 'user@example.com',
  showModeSwitcher = false,
  mode = 'crud',
  onModeChange,
  onLogout,
  onOpenSettings,
  onToggleSidebar,
}: AppHeaderProps) {
  const modes: { id: QueryMode; label: string; icon?: ReactNode }[] = [
    { id: 'crud', label: 'CRUD' },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-3 w-3" /> },
    { id: 'schema', label: 'Schema Editor', icon: <Table2 className="h-3 w-3" /> },
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
    </header>
  );
}
