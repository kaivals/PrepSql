'use client';

import { useState, useEffect, useRef } from 'react';
import { Database, LogOut, User, ChevronDown, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  userEmail?: string;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  connectionId?: string;
  refreshTrigger?: number;
}

export function AppHeader({
  userEmail = 'user@example.com',
  onLogout,
  onOpenSettings,
  onToggleSidebar,
}: AppHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [dropdownOpen]);

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

        {/* Right Side: Integrated Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 rounded-full p-1 hover:bg-muted/50 transition-all border border-border bg-card shadow-sm focus:outline-none cursor-pointer"
          >
            {/* User avatar circle */}
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

          {/* Premium Glass Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-xl p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              {/* Header profile details */}
              <div className="px-3 py-2 border-b border-border mb-1 shrink-0">
                <p className="text-xs font-semibold text-foreground truncate">{userName}</p>
                <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
              </div>

              {/* Option 1: Profile (Triggers settings modal) */}
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

              {/* Option 2: Sign out / Log out */}
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
  );
}
