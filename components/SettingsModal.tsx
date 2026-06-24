'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface KeyInfo {
  configured: boolean;
  provider?: 'groq' | 'anthropic';
  source: 'env' | 'client' | 'none';
  maskedKey?: string;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadInfo = async () => {
    try {
      const res = await fetch('/api/settings', { credentials: 'same-origin' });
      if (res.ok) {
        setInfo(await res.json());
      }
    } catch {
      setInfo({ configured: false, source: 'none' });
    }
  };

  useEffect(() => {
    if (open) {
      setError('');
      setSuccess('');
      setApiKey('');
      loadInfo();
    }
  }, [open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save API key');

      setApiKey('');
      setSuccess('API key saved successfully.');
      setInfo(data);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove the saved API key?')) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/settings', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove API key');

      setSuccess(data.configured ? 'Saved key removed. Falling back to .env.local key.' : 'API key removed.');
      setInfo({
        configured: data.configured,
        source: data.source,
        provider: data.provider,
        maskedKey: data.maskedKey,
      });
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove API key');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">AI API key</h3>
            </div>

            <p className="mb-4 text-sm text-muted-foreground">
              Required for natural language → SQL. Use a free Groq key from{' '}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                console.groq.com
              </a>{' '}
              (recommended, model: llama-3.3-70b-versatile) or an Anthropic key from{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                console.anthropic.com
              </a>
              .
            </p>

            {info?.configured && (
              <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <p className="text-muted-foreground">
                  Current key:{' '}
                  <span className="font-mono text-foreground">{info.maskedKey}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Provider: {info.provider === 'groq' ? 'Groq' : 'Anthropic'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Source:{' '}
                  {info.source === 'env'
                    ? '.env.local (restart server to change)'
                    : 'Saved in app settings'}
                </p>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="gsk_... or sk-ant-..."
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving || !apiKey.trim()}>
                    {saving ? 'Saving...' : info?.configured ? 'Update key' : 'Save key'}
                  </Button>
                  {info?.configured && info.source === 'client' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={handleRemove}
                    >
                      Remove key
                    </Button>
                  )}
                </div>
              </form>

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            {success && <p className="mt-2 text-sm text-emerald-600">{success}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
