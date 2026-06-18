'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  onExecute: (sql: string) => void;
  isLoading?: boolean;
  isConnected?: boolean;
}

export function SQLEditor({ onExecute, isLoading = false, isConnected = false }: Props) {
  const [prompt, setPrompt] = useState('');
  const [sql, setSql] = useState('');
  const [explanation, setExplanation] = useState('');
  const [safetyWarnings, setSafetyWarnings] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setGenerating(true);
    setError('');
    setSql('');
    setExplanation('');
    setSafetyWarnings([]);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate SQL');
      }

      const data = await res.json();
      setSql(data.sql);
      setExplanation(data.explanation);
      setSafetyWarnings(data.safetyWarnings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleExecute = () => {
    if (!sql.trim()) {
      setError('No SQL to execute');
      return;
    }
    onExecute(sql);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleGenerate} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-2">What would you like to query?</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Show me all customers who made purchases in the last 30 days"
            disabled={!isConnected}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            rows={6}
          />
        </div>
        <Button
          type="submit"
          disabled={generating || !isConnected || isLoading}
          className="w-full"
        >
          {generating ? 'Generating...' : 'Generate SQL'}
        </Button>
      </form>

      {error && <div className="text-destructive text-sm bg-destructive/10 p-2 rounded">{error}</div>}

      {safetyWarnings.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3">
          <p className="text-sm font-medium text-destructive mb-1">Safety Warnings:</p>
          <ul className="text-sm text-destructive space-y-1">
            {safetyWarnings.map((warning, i) => (
              <li key={i}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}

      {sql && (
        <div className="space-y-3 bg-card border border-border rounded-lg p-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Generated SQL</h3>
            <pre className="bg-secondary p-3 rounded text-sm overflow-x-auto text-foreground">
              <code>{sql}</code>
            </pre>
          </div>

          {explanation && (
            <div>
              <h3 className="text-sm font-medium mb-1">Explanation</h3>
              <p className="text-sm text-muted-foreground">{explanation}</p>
            </div>
          )}

          <Button onClick={handleExecute} disabled={isLoading} className="w-full" variant="default">
            {isLoading ? 'Executing...' : 'Execute Query'}
          </Button>
        </div>
      )}
    </div>
  );
}
