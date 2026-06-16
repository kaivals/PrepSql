'use client';

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ApiKeySetupProps {
  onOpenSettings: () => void;
}

export function ApiKeySetup({ onOpenSettings }: ApiKeySetupProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/settings', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => setConfigured(data.configured))
      .catch(() => setConfigured(false));
  }, []);

  if (configured === null || configured) return null;

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
