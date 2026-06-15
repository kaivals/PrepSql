'use client';

import type { ReactNode } from 'react';
import { Database, LogOut, BarChart3, Settings } from 'lucide-react';
import type { QueryMode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  userEmail?: string;
  showModeSwitcher?: boolean;
  mode?: QueryMode;
  onModeChange?: (mode: QueryMode) => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
}

export function AppHeader({
  userEmail = 'user@example.com',
  showModeSwitcher = false,
  mode = 'readonly',
  onModeChange,
  onLogout,
  onOpenSettings,
}: AppHeaderProps) {
  const modes: { id: QueryMode; label: string; icon?: ReactNode }[] = [
    { id: 'readonly', label: 'Read-only' },
    { id: 'crud', label: 'CRUD' },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-3 w-3" /> },
  ];

  return (
    <header className="relative border-b border-border bg-white">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-foreground">
            <Database className="h-3.5 w-3.5 text-background" />
          </div>
          <span className="text-base font-semibold tracking-tight">PrepSQL</span>
        </div>

        {showModeSwitcher && onModeChange && (
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-lg border border-border bg-muted/40 p-0.5">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onModeChange(m.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
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

        <div className="flex items-center gap-4 text-sm">
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
          <span className="text-muted-foreground">{userEmail}</span>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
