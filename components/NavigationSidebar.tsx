'use client';

import {
  Database,
  BarChart3,
  Table2,
  Plug2,
  Clock,
  Settings,
} from 'lucide-react';
import type { QueryMode } from '@/lib/types';
import { cn } from '@/lib/utils';

type NavSection = QueryMode | 'connections' | 'history';

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
    id: 'connections',
    label: 'Connections',
    icon: <Plug2 className="h-5 w-5" />,
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
    <div className="flex h-full w-[68px] shrink-0 select-none flex-col items-center border-r border-slate-200/80 bg-[#F8F8F8] py-3">
      {/* Nav items */}
      <div className="flex flex-1 flex-col items-center gap-0.5 w-full px-2">
        {NAV_ITEMS.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                'flex w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5 transition-all duration-150',
                active
                  ? 'bg-white text-primary shadow-sm ring-1 ring-black/[0.06]'
                  : 'text-slate-400 hover:bg-white/70 hover:text-slate-700'
              )}
            >
              {item.icon}
              <span
                className={cn(
                  'text-[9.5px] font-semibold leading-none tracking-wide',
                  active ? 'text-primary' : 'text-slate-400'
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
        className="flex w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-slate-400 transition-all duration-150 hover:bg-white/70 hover:text-slate-700 mx-2"
        style={{ width: 'calc(100% - 16px)' }}
      >
        <Settings className="h-5 w-5" />
        <span className="text-[9.5px] font-semibold leading-none tracking-wide text-slate-400">
          Settings
        </span>
      </button>
    </div>
  );
}
