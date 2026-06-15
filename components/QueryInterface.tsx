'use client';

import { useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResultsTable } from '@/components/ResultsTable';
import { ApiKeySetup } from '@/components/ApiKeySetup';
import { ensureServerConnection } from '@/lib/client-connection';
import type { QueryResult } from '@/lib/types';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Show all users',
  'List first 10 posts',
  'How many students are there?',
];

const SQL_SUGGESTIONS = [
  'SELECT * FROM "Users" LIMIT 10',
  'SELECT * FROM "Posts" LIMIT 10',
  'SELECT * FROM students LIMIT 10',
];

type InputMode = 'natural' | 'sql';

interface QueryInterfaceProps {
  onExecute: (sql: string, prompt?: string) => Promise<void>;
  isLoading?: boolean;
  result: QueryResult | null;
  onOpenSettings?: () => void;
}

function formatApiError(message: string): string {
  if (message.includes('credit balance') || message.includes('billing')) {
    return 'Your Anthropic account has no credits. Add a different API key in Settings, add credits at console.anthropic.com/settings/billing, or use Run SQL mode.';
  }
  if (message.includes('API key')) {
    return 'Anthropic API key is missing or invalid. Open Settings to add or change your key.';
  }
  return message;
}

export function QueryInterface({
  onExecute,
  isLoading = false,
  result,
  onOpenSettings,
}: QueryInterfaceProps) {
  const [inputMode, setInputMode] = useState<InputMode>('natural');
  const [prompt, setPrompt] = useState('');
  const [generatedSql, setGeneratedSql] = useState('');
  const [explanation, setExplanation] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [hasQueried, setHasQueried] = useState(false);

  const handleSqlSubmit = async (sql: string) => {
    const query = sql.trim();
    if (!query) return;

    setGenerating(true);
    setError('');
    setGeneratedSql(query);
    setExplanation('');
    setHasQueried(true);

    try {
      const connected = await ensureServerConnection();
      if (!connected) {
        throw new Error('No database connection. Please connect first from All connections.');
      }
      await onExecute(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleNaturalSubmit = async (text?: string) => {
    const query = (text ?? prompt).trim();
    if (!query) return;

    setGenerating(true);
    setError('');
    setGeneratedSql('');
    setExplanation('');
    setHasQueried(true);

    try {
      const connected = await ensureServerConnection();
      if (!connected) {
        throw new Error('No database connection. Please connect first from All connections.');
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ prompt: query }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(formatApiError(data.error || 'Failed to generate SQL'));
      }

      const data = await res.json();
      setGeneratedSql(data.sql);
      setExplanation(data.explanation);
      await onExecute(data.sql, query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setError(formatApiError(msg));
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async (text?: string) => {
    if (inputMode === 'sql') {
      await handleSqlSubmit(text ?? prompt);
    } else {
      await handleNaturalSubmit(text);
    }
  };

  const suggestions = inputMode === 'sql' ? SQL_SUGGESTIONS : SUGGESTIONS;
  const showWelcome = !hasQueried && !result;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {inputMode === 'natural' && <ApiKeySetup onOpenSettings={() => onOpenSettings?.()} />}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {showWelcome ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 pb-32">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {inputMode === 'sql' ? 'Run SQL' : 'Ask anything'}
            </p>
            <h1 className="mb-4 text-center text-3xl font-semibold tracking-tight">
              {inputMode === 'sql' ? 'Write SQL directly' : 'What do you want to know?'}
            </h1>
            <p className="mb-8 max-w-md text-center text-muted-foreground">
              {inputMode === 'sql'
                ? 'Run queries against your connected database without using Claude AI.'
                : 'Type a question in plain English. PrepSQL grounds it in your schema, generates SQL, validates it against the current mode, then executes.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setPrompt(s);
                    handleSubmit(s);
                  }}
                  className="rounded-full border border-border bg-white px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 p-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
                {onOpenSettings && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="font-medium underline"
                    >
                      Open Settings
                    </button>
                    {(error.includes('credits') || error.includes('billing')) && (
                      <button
                        type="button"
                        onClick={() => {
                          setInputMode('sql');
                          setError('');
                        }}
                        className="font-medium underline"
                      >
                        Switch to Run SQL mode
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {generatedSql && (
              <div className="rounded-xl border border-border bg-white p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {inputMode === 'sql' ? 'SQL' : 'Generated SQL'}
                </p>
                <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-sm">
                  <code>{generatedSql}</code>
                </pre>
                {explanation && (
                  <p className="mt-2 text-sm text-muted-foreground">{explanation}</p>
                )}
              </div>
            )}

            {result && (
              <div>
                <ResultsTable result={result} isLoading={isLoading} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-white p-4">
        <div className="mx-auto mb-3 flex max-w-3xl justify-center">
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setInputMode('natural')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                inputMode === 'natural'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Natural language
            </button>
            <button
              type="button"
              onClick={() => setInputMode('sql')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                inputMode === 'sql'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Run SQL
            </button>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <div className="flex-1">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                inputMode === 'sql'
                  ? 'SELECT * FROM users LIMIT 10'
                  : 'Ask a question in plain English...'
              }
              rows={inputMode === 'sql' ? 3 : 1}
              disabled={generating || isLoading}
              className="w-full resize-none rounded-xl border border-border bg-muted/30 px-4 py-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            />
          </div>
          <Button
            type="submit"
            disabled={generating || isLoading || !prompt.trim()}
            className="h-11 w-11 shrink-0 rounded-xl p-0"
          >
            {generating || isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
