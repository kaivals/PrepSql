'use client';

import { Button } from '@/components/ui/button';
import { useHistory, useClearHistory } from '@/hooks/useHistory';
import type { QueryHistoryItem } from '@/lib/types';

interface Props {
  onSelectQuery: (sql: string) => void;
  refreshTrigger?: number;
}

export function HistorySidebar({ onSelectQuery, refreshTrigger }: Props) {
  const { data: history = [], isLoading } = useHistory({ limit: 500 });
  const clearHistory = useClearHistory();

  const handleClearHistory = async () => {
    if (!confirm('Clear all query history?')) return;
    try {
      await clearHistory.mutateAsync();
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="bg-card border-l border-border h-full p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading history...</p>
      </div>
    );
  }

  return (
    <div className="bg-card border-l border-border h-full flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-sm mb-3">Query History</h2>
        {history.length > 0 && (
          <Button
            onClick={handleClearHistory}
            variant="outline"
            size="sm"
            className="w-full text-xs"
            disabled={clearHistory.isPending}
          >
            {clearHistory.isPending ? 'Clearing...' : 'Clear History'}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">No queries yet</p>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {(history as QueryHistoryItem[]).map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectQuery(item.sql)}
                className={`w-full text-left p-2 rounded text-xs border transition-colors ${
                  item.success
                    ? 'border-border hover:bg-muted bg-card/50'
                    : 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
                }`}
              >
                <div className="font-mono text-foreground truncate">{item.sql.substring(0, 40)}...</div>
                <div className="text-xs text-muted-foreground mt-1">{formatTime(item.timestamp)}</div>
                {!item.success && item.error && (
                  <div className="text-destructive text-xs mt-1">Error: {item.error}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
