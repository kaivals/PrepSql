export const API_KEY_STORAGE_KEY = 'prepsql-anthropic-api-key';

export function loadStoredApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
}

export function saveStoredApiKey(apiKey: string): void {
  if (typeof window === 'undefined') return;
  if (apiKey.trim()) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}

export async function syncApiKeyToServer(): Promise<boolean> {
  const stored = loadStoredApiKey();
  if (!stored) return false;

  const statusRes = await fetch('/api/settings', { credentials: 'same-origin' });
  if (!statusRes.ok) return false;
  const status = await statusRes.json();
  if (status.configured && status.source === 'env') return true;
  if (status.configured) return true;

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ apiKey: stored }),
  });
  return res.ok;
}
