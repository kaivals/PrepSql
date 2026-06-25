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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
              <Settings className="h-4.5 w-4.5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Settings</h2>
              <p className="text-xs text-slate-500">Manage your API configuration</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-6 p-6">
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <KeyRound className="h-3.5 w-3.5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">AI API key</h3>
            </div>

            <p className="mb-5 text-sm leading-relaxed text-slate-500">
              Required for natural language → SQL. Use a free Groq key from{' '}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              >
                console.groq.com
              </a>{' '}
              (recommended) or an Anthropic key from{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              >
                console.anthropic.com
              </a>
              .
            </p>

            {info?.configured && (
              <div className="mb-5 space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Current key</span>
                  <span className="font-mono text-xs text-slate-700">{info.maskedKey}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Provider</span>
                  <span className="text-xs font-medium text-slate-700">{info.provider === 'groq' ? 'Groq' : 'Anthropic'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Source</span>
                  <span className="text-xs text-slate-500">
                    {info.source === 'env'
                      ? '.env.local (restart to change)'
                      : 'Saved in app settings'}
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="gsk_... or sk-ant-..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="flex gap-2.5">
                  <Button type="submit" disabled={saving || !apiKey.trim()} className="rounded-lg px-4 text-sm">
                    {saving ? 'Saving...' : info?.configured ? 'Update key' : 'Save key'}
                  </Button>
                  {info?.configured && info.source === 'client' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={handleRemove}
                      className="rounded-lg px-4 text-sm"
                    >
                      Remove key
                    </Button>
                  )}
                </div>
              </form>

            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
            {success && <p className="mt-3 text-sm font-medium text-emerald-600">{success}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
