'use client';

import {
  Database,
  BarChart3,
  Table2,
  Clock,
  Settings,
} from 'lucide-react';
import type { QueryMode } from '@/lib/types';
import { cn } from '@/lib/utils';

type NavSection = QueryMode | 'history';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'crud',
    label: 'Query',
    icon: <Database className="h-5 w-5" />,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    id: 'schema',
    label: 'Schema',
    icon: <Table2 className="h-5 w-5" />,
  },
  {
    id: 'history',
    label: 'History',
    icon: <Clock className="h-5 w-5" />,
  },
];

interface NavigationSidebarProps {
  activeSection: NavSection;
  onSectionChange: (section: NavSection) => void;
  onOpenSettings: () => void;
}

export function NavigationSidebar({
  activeSection,
  onSectionChange,
  onOpenSettings,
}: NavigationSidebarProps) {
  return (
    <div className="flex h-full w-[76px] shrink-0 select-none flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
      {/* Nav items */}
      <div className="flex flex-1 flex-col items-center gap-1.5 w-full px-1.5">
        {NAV_ITEMS.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                'flex w-full flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2.5 transition-all duration-150 cursor-pointer',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              )}
            >
              {item.icon}
              <span
                className={cn(
                  'text-[9px] font-semibold leading-none tracking-tight text-center',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Settings at bottom */}
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex w-full flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2.5 text-muted-foreground transition-all duration-150 hover:bg-sidebar-accent/50 hover:text-foreground mx-1.5 cursor-pointer"
        style={{ width: 'calc(100% - 12px)' }}
      >
        <Settings className="h-5 w-5" />
        <span className="text-[9px] font-semibold leading-none tracking-tight text-muted-foreground text-center">
          Settings
        </span>
      </button>
    </div>
  );
}
