'use client';

import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/useSettings';

interface ApiKeySetupProps {
  onOpenSettings: () => void;
}

export function ApiKeySetup({ onOpenSettings }: ApiKeySetupProps) {
  const { data, isLoading } = useSettings();

  if (isLoading || data?.configured) return null;

  return (
    <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-amber-900">
        <KeyRound className="h-4 w-4 shrink-0" />
        <span>Add your Groq or Anthropic API key in Settings to use natural language queries.</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
        Open Settings
      </Button>
    </div>
  );
}
