'use client';

import { Database, LogOut, Settings, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  userEmail?: string;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
}

export function AppHeader({
  userEmail = 'user@example.com',
  onLogout,
  onOpenSettings,
  onToggleSidebar,
}: AppHeaderProps) {

  // Get user initials for avatar
  const initials = userEmail
    .split('@')[0]
    .split(/[._-]/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
      <div className="flex h-12 items-center justify-between px-4">
        {/* Left: Hamburger (mobile) + Logo */}
        <div className="flex items-center gap-2.5">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Database className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-[14px] font-semibold tracking-tight text-slate-900">PrepSQL</span>
          </div>
        </div>

        {/* Right: Settings + Avatar + Logout */}
        <div className="flex items-center gap-1">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          {/* User avatar */}
          <div className="ml-1 flex items-center gap-2">
            <div className="hidden text-[13px] text-slate-500 md:block">{userEmail.split('@')[0]}</div>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
              {initials}
            </div>
          </div>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="ml-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden text-xs font-medium md:inline">Logout</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
