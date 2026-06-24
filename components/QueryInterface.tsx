'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, Loader2, AlertTriangle, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResultsTable } from '@/components/ResultsTable';
import { ApiKeySetup } from '@/components/ApiKeySetup';
import { ensureServerConnection } from '@/lib/client-connection';
import type { QueryResult, TokenUsage } from '@/lib/types';
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  result?: QueryResult | null;
  usage?: TokenUsage;
  error?: string;
  pendingApproval?: boolean;
  mutationType?: string;
}

interface QueryInterfaceProps {
  connectionId?: string;
  onExecute: (sql: string, prompt?: string) => Promise<void>;
  isLoading?: boolean;
  result: QueryResult | null;
  onOpenSettings?: () => void;
  onQueryResult?: (result: QueryResult | null) => void;
}

function formatApiError(message: string): string {
  if (message.includes('credit balance') || message.includes('billing')) {
    return 'Your Anthropic account has no credits. Add a Groq key in Settings, add Anthropic credits, or use Run SQL mode.';
  }
  if (message.includes('API key')) {
    return 'AI API key is missing or invalid. Open Settings to add a Groq (gsk_...) or Anthropic key.';
  }
  return message;
}

function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative mt-3 space-y-2 group">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Generated SQL</p>
      <pre className="overflow-x-auto rounded-lg bg-muted/70 p-3 pr-10 font-mono text-xs text-foreground">
        <code>{sql}</code>
      </pre>
      <button
        onClick={handleCopy}
        type="button"
        className="absolute right-2 top-8 rounded bg-muted border border-border p-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy SQL"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function QueryInterface({
  connectionId,
  onExecute,
  isLoading = false,
  result,
  onOpenSettings,
  onQueryResult,
}: QueryInterfaceProps) {
  const [inputMode, setInputMode] = useState<InputMode>('natural');
  const [prompt, setPrompt] = useState('');
  const [generatedSql, setGeneratedSql] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [hasQueried, setHasQueried] = useState(false);

  // Chat message history for Natural Language mode (persisted via /api/chat)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat messages from the server-side store (MongoDB) on connectionId change
  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    setChatLoading(true);
    fetch(`/api/chat?connectionId=${encodeURIComponent(connectionId)}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => {
        if (cancelled) return;
        const messages: ChatMessage[] = data.messages || [];
        setChatMessages(
          messages.length > 0
            ? messages
            : [
                {
                  id: 'welcome',
                  role: 'assistant',
                  content: "Hi! I'm your SQL assistant. Ask me to query your database, explore your tables, or modify data in natural language, or switch to 'Run SQL' to execute raw queries.",
                },
              ],
        );
      })
      .catch(() => {
        if (!cancelled) setChatMessages([]);
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  // Persist chat messages to the server-side store whenever they change
  const persistChat = useCallback(
    (messages: ChatMessage[]) => {
      if (!connectionId || messages.length === 0) return;
      try {
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ connectionId, messages }),
        });
      } catch {
        // fire-and-forget
      }
    },
    [connectionId],
  );

  useEffect(() => {
    if (inputMode === 'natural' && connectionId && chatMessages.length > 0) {
      persistChat(chatMessages);
    }
  }, [chatMessages, connectionId, inputMode, persistChat]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (inputMode === 'natural') {
      scrollToBottom();
    }
  }, [chatMessages, generating, inputMode]);

  const handleSqlSubmit = async (sql: string) => {
    const query = sql.trim();
    if (!query) return;

    setGenerating(true);
    setError('');
    setGeneratedSql(query);
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

    // Add user query to chat history
    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      role: 'user',
      content: query,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setPrompt(''); // Clear the input field

    setGenerating(true);
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

      if (data.type === 'sql') {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.explanation || '',
          sql: data.sql,
          result: data.result || null,
          usage: data.usage,
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(data.result);
      } else if (data.type === 'pending_approval') {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.explanation || `This query wants to ${data.mutationType} data. Please approve or reject:`,
          sql: data.sql,
          pendingApproval: true,
          mutationType: data.mutationType,
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(null);
      } else if (data.type === 'error') {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.message || 'Query execution failed.',
          error: data.message,
          sql: data.sql,
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(null);
      } else {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.message || data.question || '',
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      const assistantMsg: ChatMessage = {
        id: Math.random().toString(),
        role: 'assistant',
        content: 'I encountered an error while processing your request.',
        error: formatApiError(msg),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setGenerating(false);
    }
  };

  const handleApproval = async (messageId: string, action: 'approve' | 'reject') => {
    // Clear pendingApproval flag immediately to avoid double clicks
    setChatMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, pendingApproval: false } : msg
      )
    );

    setGenerating(true);

    try {
      const connected = await ensureServerConnection();
      if (!connected) {
        throw new Error('No database connection. Please connect first from All connections.');
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(formatApiError(data.error || 'Failed to process approval'));
      }

      const data = await res.json();

      if (data.type === 'sql') {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.explanation || '',
          sql: data.sql,
          result: data.result || null,
          usage: data.usage,
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(data.result);
      } else if (data.type === 'error') {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.message || 'Query execution failed.',
          error: data.message,
          sql: data.sql,
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(null);
      } else {
        const assistantMsg: ChatMessage = {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.message || data.question || '',
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
        onQueryResult?.(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed';
      const assistantMsg: ChatMessage = {
        id: Math.random().toString(),
        role: 'assistant',
        content: 'I encountered an error while processing your approval.',
        error: formatApiError(msg),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
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
  const showWelcome = inputMode === 'sql' ? !hasQueried && !result : chatMessages.length <= 1;

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
            {inputMode === 'natural' ? (
              <div className="space-y-6">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex flex-col gap-2 max-w-full',
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    )}
                  >
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-3 text-sm max-w-[85%]',
                        msg.role === 'user'
                          ? 'bg-foreground text-background'
                          : 'bg-muted/40 border border-border text-foreground'
                      )}
                    >
                      {/* Natural Language Response Content */}
                      {msg.content && (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      )}

                      {/* Error Alert */}
                      {msg.error && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <span>{msg.error}</span>
                        </div>
                      )}

                      {/* SQL Code Box */}
                      {msg.sql && <SqlBlock sql={msg.sql} />}

                      {/* Approval controls */}
                      {msg.pendingApproval && (
                        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                          <p className="text-xs font-medium text-amber-800">
                            Safety Check: This query requires your approval to modify database records.
                          </p>
                          <div className="flex gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => handleApproval(msg.id, 'approve')}
                              disabled={generating}
                              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-500 transition-colors disabled:opacity-50"
                            >
                              Approve & Execute
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproval(msg.id, 'reject')}
                              disabled={generating}
                              className="rounded-md bg-white border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-50 transition-colors disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Token Usage details */}
                      {msg.usage && (
                        <div className="mt-3 flex items-center gap-4 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                          <span>
                            Prompt tokens:{' '}
                            <strong className="font-medium text-foreground">{msg.usage.promptTokens}</strong>
                          </span>
                          <span>
                            Completion tokens:{' '}
                            <strong className="font-medium text-foreground">{msg.usage.completionTokens}</strong>
                          </span>
                          <span>
                            Total:{' '}
                            <strong className="font-medium text-foreground">
                              {msg.usage.promptTokens + msg.usage.completionTokens}
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Results Table inside bubble */}
                    {msg.result && (
                      <div className="w-full mt-1">
                        <ResultsTable result={msg.result} />
                      </div>
                    )}
                  </div>
                ))}

                {generating && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-muted/40 border border-border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            ) : (
              // SQL Mode layout
              <div className="space-y-4">
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {generatedSql && (
                  <div className="rounded-xl border border-border bg-white p-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      SQL Query
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-sm">
                      <code>{generatedSql}</code>
                    </pre>
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
              rows={inputMode === 'sql' ? 6 : 3}
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
