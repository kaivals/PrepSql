'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  Zap,
  Gauge,
  FileText,
  Clock,
  Database,
  ArrowRight,
  RefreshCw,
  Copy,
  Check,
  Key,
  Cpu,
  MemoryStick,
} from 'lucide-react';
import type { DatabaseConnection, QueryHistoryItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AnalyticsPageProps {
  connection: DatabaseConnection;
  showConfirmation: (message: string, onConfirm: () => void) => void;
  showNotification: (message: string, type: 'success' | 'error') => void;
  onRefreshSchema: () => void;
}

interface AIAnalysisResult {
  rootCause: string;
  impact: 'High' | 'Medium' | 'Low';
  optimizedQuery: string;
  isDdl: boolean;
  explanation: string;
  estTimeBefore: number;
  estTimeAfter: number;
  estScannedBefore: number;
  estScannedAfter: number;
}

interface DBHealthReport {
  queryEfficiency: number;
  indexCoverage: number;
  schemaQuality: number;
  overallScore: number;
  recommendations: string[];
}

export function AnalyticsPage({
  connection,
  showConfirmation,
  showNotification,
  onRefreshSchema,
}: AnalyticsPageProps) {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [analyzingQuery, setAnalyzingQuery] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AIAnalysisResult | null>(null);
  const [selectedQueryForAI, setSelectedQueryForAI] = useState<QueryHistoryItem | null>(null);

  // Timeline & Lifecycle analysis states
  const [selectedRun, setSelectedRun] = useState<QueryHistoryItem | null>(null);
  const [analyzingTimeline, setAnalyzingTimeline] = useState(false);
  const [timelineAnalysis, setTimelineAnalysis] = useState<any | null>(null);

  const handleAnalyzeTimeline = async (run: QueryHistoryItem) => {
    if (!run.timeline || run.timeline.length === 0) {
      showNotification('No timeline steps recorded for this execution.', 'error');
      return;
    }
    setAnalyzingTimeline(true);
    setTimelineAnalysis(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'timeline', timeline: run.timeline }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Timeline analysis failed');
      }

      const report = await res.json();
      setTimelineAnalysis(report);
      saveAnalysis('timeline', run.sql, report);
      showNotification('Lifecycle analysis completed!', 'success');
    } catch (err) {
      showNotification(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setAnalyzingTimeline(false);
    }
  };

  // DB Health Score State
  const [healthReport, setHealthReport] = useState<DBHealthReport>({
    queryEfficiency: 85,
    indexCoverage: 70,
    schemaQuality: 90,
    overallScore: 81,
    recommendations: [
      'Add indexes to frequently searched columns.',
      'Always limit results of analytical queries.',
    ],
  });
  const [auditingDb, setAuditingDb] = useState(false);
  const [copied, setCopied] = useState(false);

  const [historyError, setHistoryError] = useState<string | null>(null);

  // Persist analysis result to MongoDB via API
  const saveAnalysis = async (action: string, targetSql: string | null, result: Record<string, unknown>) => {
    try {
      await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, targetSql, result }),
      });
    } catch (err) {
      console.error('Failed to persist analysis:', err);
    }
  };

  // Load history from MongoDB via API. This is the single source of truth for
  // execution metrics (execution_time, rows_scanned, cpu_usage, etc.) and
  // survives page reloads because it is persisted server-side.
  const loadHistory = async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetch('/api/history?limit=500', { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error('Failed to load history');
      }
      const data = await res.json();
      const items: QueryHistoryItem[] = data.history || [];
      setHistory(items);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [connection.id]);

  // Aggregate metrics for the summary cards. Computed from the real,
  // complete data fetched from the server-side query_history collection.
  const metrics = useMemo(() => {
    const successful = history.filter((h) => h.success);
    const total = history.length;
    const totalTime = successful.reduce((sum, h) => sum + (h.executionTime || 0), 0);
    const totalScanned = successful.reduce((sum, h) => sum + (h.rowsScanned || 0), 0);
    const totalReturned = successful.reduce((sum, h) => sum + (h.rowsReturned || 0), 0);
    const totalCpu = successful.reduce((sum, h) => sum + (h.cpuUsage || 0), 0);
    const totalMem = successful.reduce((sum, h) => sum + (h.memoryUsage || 0), 0);
    const indexHits = successful.filter((h) => h.indexesUsed && h.indexesUsed.length > 0).length;
    return {
      total,
      avgTime: successful.length ? Math.round(totalTime / successful.length) : 0,
      avgScanned: successful.length ? Math.round(totalScanned / successful.length) : 0,
      avgReturned: successful.length ? Math.round(totalReturned / successful.length) : 0,
      avgCpu: successful.length ? Math.round(totalCpu / successful.length) : 0,
      avgMem: successful.length ? Math.round(totalMem / successful.length) : 0,
      indexHitRatio: successful.length ? Math.round((indexHits / successful.length) * 100) : 0,
      slowCount: successful.filter((h) => (h.executionTime || 0) > 100).length,
    };
  }, [history]);

  // Execute AI Health Audit
  const handleDbAudit = async () => {
    setAuditingDb(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'db', history }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to analyze DB health');
      }

      const report = await res.json();
      setHealthReport(report);
      saveAnalysis('db', null, report);
      showNotification('Database health audit completed successfully!', 'success');
    } catch (err) {
      showNotification(`Audit failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setAuditingDb(false);
    }
  };

  // Run AI query optimizer
  const handleOptimizeQuery = async (queryItem: QueryHistoryItem) => {
    setAnalyzingQuery(queryItem.id);
    setSelectedQueryForAI(queryItem);
    setAnalysisResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'query', sql: queryItem.sql }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'AI optimization failed');
      }

      const result = await res.json();
      setAnalysisResult(result);
      saveAnalysis('query', queryItem.sql, result);
    } catch (err) {
      showNotification(`Optimization failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setAnalyzingQuery(null);
    }
  };

  // Apply optimized index creation (DDL)
  const handleApplyDdl = (ddl: string) => {
    showConfirmation(
      `Apply SQL optimization DDL?\n\nThis will execute:\n\n${ddl}`,
      async () => {
        try {
          const res = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: ddl }),
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to execute DDL');
          }

          showNotification('Optimization DDL executed successfully!', 'success');
          onRefreshSchema();
          // The DDL ran through /api/execute, which records into history
          // server-side. Reload explicitly to refresh the metrics.
          loadHistory();
          setAnalysisResult(null);
          setSelectedQueryForAI(null);
        } catch (err) {
          showNotification(`DDL failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        }
      }
    );
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helpers
  const getQueryStatus = (time?: number) => {
    if (!time) return { label: 'Fast', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (time > 100) return { label: 'Slow', color: 'bg-red-50 text-red-700 border-red-200' };
    if (time > 50) return { label: 'Medium', color: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'Fast', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  // Filter slow queries (>100ms)
  const slowQueries = history.filter((item) => item.success && item.executionTime && item.executionTime > 100);

  // Compute table usage stats
  const tableStats: Record<string, number> = {};
  history.forEach((h) => {
    const match = h.sql.match(/from\s+["`]?(\w+)["`]?/i);
    if (match) {
      const tbl = match[1];
      tableStats[tbl] = (tableStats[tbl] || 0) + 1;
    }
  });
  const topTables = Object.entries(tableStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-background p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">AI Database Performance Advisor</h1>
          <p className="text-xs text-muted-foreground">
            Monitor query latencies, examine index coverage, and apply AI-driven suggestions.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDbAudit}
          disabled={auditingDb}
          className="flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', auditingDb && 'animate-spin')} />
          Run Health Audit
        </button>
      </div>

      {/* Execution Metrics Summary Cards — computed from real data in the
          server-side query_history collection. */}
      <div className="mb-6 grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {[
          { label: 'Total Queries', value: metrics.total.toLocaleString(), icon: FileText, color: 'text-foreground' },
          { label: 'Avg Time', value: `${metrics.avgTime}ms`, icon: Clock, color: metrics.avgTime > 100 ? 'text-red-600' : 'text-emerald-600' },
          { label: 'Avg Scanned', value: metrics.avgScanned.toLocaleString(), icon: Database, color: 'text-foreground' },
          { label: 'Avg Returned', value: metrics.avgReturned.toLocaleString(), icon: TrendingUp, color: 'text-foreground' },
          { label: 'Avg CPU', value: `${metrics.avgCpu}%`, icon: Cpu, color: 'text-foreground' },
          { label: 'Avg Memory', value: `${metrics.avgMem}MB`, icon: MemoryStick, color: 'text-foreground' },
          { label: 'Index Hit', value: `${metrics.indexHitRatio}%`, icon: Key, color: metrics.indexHitRatio > 50 ? 'text-emerald-600' : 'text-amber-600' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-white p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {card.label}
              </span>
              <card.icon className={cn('h-3.5 w-3.5', card.color)} />
            </div>
            <p className={cn('mt-1.5 text-lg font-bold', card.color)}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Grid: Health Score Dial & Recommendations */}
      <div className="mb-6 grid gap-6 md:grid-cols-3">
        {/* Health Dial */}
        <div className="rounded-xl border border-border bg-white p-5 flex flex-col items-center justify-center">
          <div className="relative flex h-28 w-28 items-center justify-center">
            {/* Custom SVG Dial */}
            <svg className="absolute h-full w-full -rotate-90">
              <circle
                cx="56"
                cy="56"
                r="46"
                className="stroke-muted/20"
                strokeWidth="8"
                fill="none"
              />
              <circle
                cx="56"
                cy="56"
                r="46"
                className={cn(
                  'transition-all duration-1000',
                  healthReport.overallScore > 80 ? 'stroke-emerald-500' : 'stroke-amber-500'
                )}
                strokeWidth="8"
                fill="none"
                strokeDasharray="289"
                strokeDashoffset={289 - (289 * healthReport.overallScore) / 100}
                strokeLinecap="round"
              />
            </svg>
            <div className="text-center">
              <span className="text-3xl font-extrabold text-foreground">{healthReport.overallScore}</span>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Health Score
              </span>
            </div>
          </div>
          <div className="mt-4 flex w-full justify-between text-center border-t border-border pt-4 text-xs text-muted-foreground">
            <div>
              <span className="block font-bold text-foreground">{healthReport.queryEfficiency}</span>
              Efficiency
            </div>
            <div className="border-l border-border px-3">
              <span className="block font-bold text-foreground">{healthReport.indexCoverage}</span>
              Index Cov
            </div>
            <div className="border-l border-border pl-3">
              <span className="block font-bold text-foreground">{healthReport.schemaQuality}</span>
              Schema
            </div>
          </div>
        </div>

        {/* AI Health Recommendations */}
        <div className="md:col-span-2 rounded-xl border border-border bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-700">
              <Gauge className="h-4 w-4" />
              AI Recommendations
            </div>
            <ul className="space-y-2.5 text-xs leading-relaxed text-muted-foreground">
              {healthReport.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ArrowRight className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-[10px] text-muted-foreground mt-4 border-t border-border/60 pt-3">
            Last audited connection: <span className="font-semibold text-foreground">{connection.name}</span>
          </div>
        </div>
      </div>

      {/* Section: Custom SVG Visualizations */}
      <div className="mb-6 grid gap-6 md:grid-cols-2">
        {/* SVG Query Execution Trend */}
        <div className="rounded-xl border border-border bg-white p-5">
          <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4" />
            Query Latencies (Last 10 Queries)
          </h3>
          <div className="h-40 flex items-end gap-1.5 pt-4 relative">
            {history.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                No executions recorded.
              </div>
            ) : (
              history
                .slice(0, 10)
                .reverse()
                .map((h, i) => {
                  const maxTime = Math.max(...history.map((item) => item.executionTime || 10));
                  const percentage = ((h.executionTime || 2) / maxTime) * 100;
                  return (
                    <div key={i} className="flex-1 group relative flex flex-col items-center gap-1 h-full justify-end">
                      <div
                        className={cn(
                          'w-full rounded-t-sm transition-all duration-300 group-hover:opacity-85',
                          h.success
                            ? (h.executionTime || 0) > 100
                              ? 'bg-red-400'
                              : 'bg-emerald-400'
                            : 'bg-red-200'
                        )}
                        style={{ height: `${Math.max(10, Math.min(100, percentage))}%` }}
                      />
                      <span className="text-[9px] text-muted-foreground whitespace-nowrap overflow-hidden max-w-full">
                        {h.executionTime}ms
                      </span>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* SVG Table Usage */}
        <div className="rounded-xl border border-border bg-white p-5">
          <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Database className="h-4 w-4" />
            Most Consulted Tables
          </h3>
          {topTables.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
              No tables accessed yet.
            </div>
          ) : (
            <div className="h-40 space-y-3.5 flex flex-col justify-center">
              {topTables.map(([tbl, count]) => {
                const maxCount = Math.max(...topTables.map((t) => t[1]));
                const pct = (count / maxCount) * 100;
                return (
                  <div key={tbl} className="text-xs">
                    <div className="flex justify-between font-semibold mb-1 text-[11px]">
                      <span>{tbl}</span>
                      <span className="text-muted-foreground">{count} queries</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Optimization Details Panel */}
      {selectedQueryForAI && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/30 p-5">
          <div className="flex items-center justify-between border-b border-amber-100 pb-3 mb-4">
            <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-600" />
              AI Performance Analysis
            </h3>
            <button
              type="button"
              onClick={() => setSelectedQueryForAI(null)}
              className="text-xs text-amber-700 hover:text-amber-950 font-semibold"
            >
              Close Panel
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Target Query</p>
              <pre className="mt-1.5 overflow-x-auto rounded bg-white border border-amber-200 p-3 font-mono text-xs text-amber-950">
                <code>{selectedQueryForAI.sql}</code>
              </pre>
            </div>

            {analyzingQuery ? (
              <div className="flex items-center gap-2 text-xs text-amber-800 font-medium py-3">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing execution parameters and query planning...
              </div>
            ) : (
              analysisResult && (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Diagnosis</span>
                      <p className="text-xs mt-1 text-amber-950">{analysisResult.rootCause}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Explanation</span>
                      <p className="text-xs mt-1 text-amber-900 leading-relaxed">{analysisResult.explanation}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                        Proposed Optimization
                      </span>
                      <div className="relative mt-1.5">
                        <pre className="overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-white">
                          <code>{analysisResult.optimizedQuery}</code>
                        </pre>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(analysisResult.optimizedQuery)}
                          className="absolute right-2 top-2 rounded bg-slate-800 p-1 text-slate-400 hover:text-white"
                          title="Copy SQL"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {analysisResult.isDdl && (
                      <button
                        type="button"
                        onClick={() => handleApplyDdl(analysisResult.optimizedQuery)}
                        className="mt-4 flex w-full justify-center items-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                      >
                        <Zap className="h-4 w-4" />
                        Apply Index Optimization
                      </button>
                    )}
                  </div>

                  {/* Side-by-side performance comparison */}
                  <div className="flex flex-col justify-center">
                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide block mb-2">
                      Side-By-Side Projection
                    </span>
                    <div className="overflow-hidden rounded-lg border border-amber-200 bg-white">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-amber-100 bg-amber-50/20 font-medium">
                            <th className="p-2.5">Metric</th>
                            <th className="p-2.5 text-amber-700">Before Fix</th>
                            <th className="p-2.5 text-emerald-700">After Fix (Est)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-amber-100">
                            <td className="p-2.5 font-medium">Execution Time</td>
                            <td className="p-2.5 text-amber-700">{analysisResult.estTimeBefore}ms</td>
                            <td className="p-2.5 text-emerald-700 font-semibold">{analysisResult.estTimeAfter}ms</td>
                          </tr>
                          <tr className="border-b border-amber-100">
                            <td className="p-2.5 font-medium">Rows Scanned</td>
                            <td className="p-2.5 text-amber-700">{analysisResult.estScannedBefore.toLocaleString()}</td>
                            <td className="p-2.5 text-emerald-700 font-semibold">
                              {analysisResult.estScannedAfter.toLocaleString()}
                            </td>
                          </tr>
                          <tr>
                            <td className="p-2.5 font-medium">Indexes Used</td>
                            <td className="p-2.5 text-amber-700">No (Table Scan)</td>
                            <td className="p-2.5 text-emerald-700 font-semibold">Yes (Index Scan)</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Section: Slow Queries Logs */}
      <div className="mb-6 rounded-xl border border-border bg-white p-5">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" />
          Slow Query Detection ({'>'}100ms)
        </h3>
        {loadingHistory ? (
          <p className="text-xs text-muted-foreground">Loading log entries...</p>
        ) : historyError ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-xs text-red-600">{historyError}</p>
            <button
              type="button"
              onClick={loadHistory}
              className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
            >
              Retry
            </button>
          </div>
        ) : slowQueries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            Excellent! No queries exceeded the 100ms latency threshold.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20 font-medium text-muted-foreground">
                  <th className="p-3">Query</th>
                  <th className="p-3">Execution Time</th>
                  <th className="p-3">Optimization Actions</th>
                </tr>
              </thead>
              <tbody>
                {slowQueries.map((item) => (
                  <tr key={item.id} className="border-b border-border hover:bg-muted/10 transition-colors">
                    <td className="p-3 font-mono text-[11px] max-w-md truncate" title={item.sql}>
                      {item.sql}
                    </td>
                    <td className="p-3 font-semibold text-red-600">{item.executionTime}ms</td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => handleOptimizeQuery(item)}
                        disabled={analyzingQuery === item.id}
                        className="flex items-center gap-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60"
                      >
                        <Zap className="h-3 w-3" />
                        Optimize Query
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section: Performance Dashboard Table */}
      <div className="rounded-xl border border-border bg-white p-5">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          Recent Executions Dashboard (Click any row to analyze query lifecycle)
        </h3>
        {loadingHistory ? (
          <p className="text-xs text-muted-foreground">Loading dashboard data...</p>
        ) : historyError ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-xs text-red-600">{historyError}</p>
            <button
              type="button"
              onClick={loadHistory}
              className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
            >
              Retry
            </button>
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No query execution history found on this session.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20 font-medium text-muted-foreground">
                  <th className="p-3">Status</th>
                  <th className="p-3">Query</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Scanned</th>
                  <th className="p-3">Returned</th>
                  <th className="p-3">Indexes Used</th>
                  <th className="p-3">CPU</th>
                  <th className="p-3">Memory</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => {
                  const stat = getQueryStatus(item.executionTime);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => {
                        setSelectedRun(item);
                        setTimelineAnalysis(null);
                      }}
                      className={cn(
                        'border-b border-border hover:bg-muted/10 transition-colors cursor-pointer',
                        selectedRun?.id === item.id && 'bg-muted/30 font-medium'
                      )}
                    >
                      <td className="p-3">
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded border text-[10px] font-bold',
                            stat.color
                          )}
                        >
                          {stat.label}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-[11px] max-w-xs truncate" title={item.sql}>
                        {item.sql}
                      </td>
                      <td className="p-3">{item.executionTime != null ? `${item.executionTime}ms` : '-'}</td>
                      <td className="p-3">{item.rowsScanned != null ? item.rowsScanned.toLocaleString() : '-'}</td>
                      <td className="p-3">{item.rowsReturned != null ? item.rowsReturned.toLocaleString() : '-'}</td>
                      <td className="p-3 max-w-[100px] truncate" title={item.indexesUsed?.join(', ')}>
                        {item.indexesUsed && item.indexesUsed.length > 0 ? (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                            <Key className="h-3 w-3" />
                            {item.indexesUsed[0]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">Sequential scan</span>
                        )}
                      </td>
                      <td className="p-3">{item.cpuUsage != null ? `${item.cpuUsage}%` : '-'}</td>
                      <td className="p-3">{item.memoryUsage != null ? `${item.memoryUsage}MB` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution Timeline Lifecycle Analyzer panel */}
      {selectedRun && (
        <div className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-4 gap-4">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-primary" />
                Query Execution Lifecycle Timeline
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl truncate" title={selectedRun.prompt || selectedRun.sql}>
                Inspect every query step executed during request:{" "}
                <span className="font-semibold text-foreground">
                  {selectedRun.prompt || selectedRun.sql}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => handleAnalyzeTimeline(selectedRun)}
                disabled={analyzingTimeline || !selectedRun.timeline?.length}
                className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/95 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Zap className="h-3 w-3" />
                {analyzingTimeline ? 'Analyzing Lifecycle...' : 'Run AI Lifecycle Analysis'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedRun(null);
                  setTimelineAnalysis(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground font-semibold px-2 py-1 cursor-pointer"
              >
                Close Panel
              </button>
            </div>
          </div>

          {/* Per-query metrics summary — real values captured at execution time. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: 'Execution Time', value: selectedRun.executionTime != null ? `${selectedRun.executionTime}ms` : '-' },
              { label: 'Rows Scanned', value: selectedRun.rowsScanned != null ? selectedRun.rowsScanned.toLocaleString() : '-' },
              { label: 'Rows Returned', value: selectedRun.rowsReturned != null ? selectedRun.rowsReturned.toLocaleString() : '-' },
              { label: 'Rows Affected', value: selectedRun.rowsAffected != null ? selectedRun.rowsAffected.toLocaleString() : '-' },
              { label: 'CPU Usage', value: selectedRun.cpuUsage != null ? `${selectedRun.cpuUsage}%` : '-' },
              { label: 'Memory', value: selectedRun.memoryUsage != null ? `${selectedRun.memoryUsage}MB` : '-' },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</p>
                <p className="mt-0.5 text-sm font-bold text-foreground">{m.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Timeline Flow list */}
            <div className="lg:col-span-1 border-r border-border pr-4 space-y-4 max-h-[500px] overflow-y-auto">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-2">
                Execution Steps ({selectedRun.timeline?.length || 0})
              </span>
              
              {!selectedRun.timeline || selectedRun.timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">No intermediate timeline steps recorded for this execution.</p>
              ) : (
                <div className="relative pl-4 border-l border-border space-y-6">
                  {selectedRun.timeline.map((step) => {
                    let badgeColor = 'bg-slate-100 text-slate-800 border-slate-200';
                    let typeLabel = 'Executed Query';
                    if (step.type === 'schema_discovery') {
                      badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
                      typeLabel = 'Schema Discovery';
                    } else if (step.type === 'initial_ai') {
                      badgeColor = 'bg-purple-50 text-purple-700 border-purple-200';
                      typeLabel = 'Initial AI Query';
                    } else if (step.type === 'validation') {
                      badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
                      typeLabel = 'Validation Step';
                    } else if (step.type === 'optimization_rewrite') {
                      badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                      typeLabel = 'AI Query Optimization / Rewrite';
                    } else if (step.type === 'final_executed') {
                      badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                      typeLabel = 'Final Execution';
                    }

                    return (
                      <div key={step.id} className="relative group">
                        {/* Bullet point indicator */}
                        <div className={cn(
                          "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-white",
                          step.success ? "bg-emerald-500" : "bg-red-500"
                        )} />

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className={cn("inline-block px-2 py-0.5 rounded border text-[9px] font-bold", badgeColor)}>
                              {typeLabel}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              {step.executionTime ? `${step.executionTime}ms` : ''}
                            </span>
                          </div>
                          
                          <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[10px] text-foreground border border-border max-h-36">
                            <code>{step.sql}</code>
                          </pre>

                          {step.error && (
                            <p className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded p-1.5">
                              Error: {step.error}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* AI Analysis Details */}
            <div className="lg:col-span-2 space-y-6 max-h-[500px] overflow-y-auto">
              {!timelineAnalysis ? (
                <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-lg bg-muted/10 h-full">
                  <Activity className="h-8 w-8 text-muted-foreground/60 mb-2 animate-pulse" />
                  <p className="text-xs font-semibold text-foreground">Query Lifecycle Analysis Pending</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Click "Run AI Lifecycle Analysis" to analyze every query in this chain, evaluate engineering principles, and explain optimization rewrites.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Step-by-Step Analysis */}
                  <div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-3">
                      Query Analysis Chain
                    </span>
                    <div className="space-y-4">
                      {timelineAnalysis.queries?.map((q: any, idx: number) => (
                        <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2">
                          <pre className="overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[10px] text-white">
                            <code>{q.sql}</code>
                          </pre>
                          <div className="grid gap-2 sm:grid-cols-2 text-xs pt-1">
                            <div>
                              <strong className="text-foreground">Purpose:</strong>
                              <p className="text-muted-foreground text-[11px] mt-0.5">{q.purpose}</p>
                            </div>
                            <div>
                              <strong className="text-foreground">Cost:</strong>
                              <p className="text-muted-foreground text-[11px] mt-0.5">{q.cost || 'N/A'}</p>
                            </div>
                            <div>
                              <strong className="text-foreground">Tables Involved:</strong>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {q.tablesInvolved?.map((t: string) => (
                                  <span key={t} className="px-1.5 py-0.2 bg-white text-foreground border border-border rounded text-[10px] font-medium">{t}</span>
                                )) || <span className="text-muted-foreground text-[11px]">-</span>}
                              </div>
                            </div>
                            <div>
                              <strong className="text-foreground">Potential Bottlenecks:</strong>
                              <p className="text-amber-700 text-[11px] mt-0.5 font-medium">{q.bottlenecks || 'None detected'}</p>
                            </div>
                          </div>
                          {q.optimizationOpportunities && (
                            <div className="text-xs border-t border-border/40 pt-2">
                              <strong className="text-emerald-700">Optimization Opportunities:</strong>
                              <p className="text-muted-foreground text-[11px] mt-0.5">{q.optimizationOpportunities}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SOLID / DRY / KISS / YAGNI principles */}
                  <div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-3">
                      Engineering Principles Validation
                    </span>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {['dry', 'yagni', 'kiss', 'solid'].map((p) => {
                        const val = timelineAnalysis.principlesValidation?.[p];
                        if (!val) return null;
                        
                        let badgeColor = 'bg-slate-100 text-slate-800 border-slate-200';
                        if (val.status === 'follows') badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        if (val.status === 'violates') badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';

                        return (
                          <div key={p} className="rounded-lg border border-border bg-white p-3 space-y-1.5 flex flex-col justify-between">
                            <div>
                              <span className="text-[11px] font-bold uppercase text-foreground">{p}</span>
                              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{val.description}</p>
                            </div>
                            <span className={cn("inline-block w-fit px-1.5 py-0.2 rounded border text-[9px] font-bold capitalize mt-2", badgeColor)}>
                              {val.status}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {timelineAnalysis.principlesValidation?.concerns?.length > 0 && (
                      <div className="mt-3.5 rounded-lg border border-red-200 bg-red-50/40 p-3 space-y-1.5">
                        <strong className="text-red-800 text-xs flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Maintainability & Redundancy Concerns
                        </strong>
                        <ul className="list-disc list-inside text-red-700 text-[11px] space-y-1">
                          {timelineAnalysis.principlesValidation.concerns.map((c: string, idx: number) => (
                            <li key={idx}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Change Explanations for Optimization / Rewrites */}
                  {timelineAnalysis.changeExplanations?.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-3">
                        Query Optimization & Change Explanations
                      </span>
                      <div className="space-y-4">
                        {timelineAnalysis.changeExplanations.map((exp: any, idx: number) => (
                          <div key={idx} className="rounded-lg border border-amber-200 bg-amber-50/20 p-3.5 space-y-3">
                            <div>
                              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Optimized Query</span>
                              <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[10px] text-white">
                                <code>{exp.sql}</code>
                              </pre>
                            </div>
                            
                            <div className="grid gap-3 sm:grid-cols-3 text-xs pt-1">
                              <div>
                                <strong className="text-amber-900">What Changed:</strong>
                                <p className="text-amber-950 text-[11px] mt-0.5 leading-relaxed">{exp.whatChanged}</p>
                              </div>
                              <div>
                                <strong className="text-amber-900">Why Needed:</strong>
                                <p className="text-amber-950 text-[11px] mt-0.5 leading-relaxed">{exp.whyNeeded}</p>
                              </div>
                              <div>
                                <strong className="text-amber-900">Expected Impact:</strong>
                                <p className="text-amber-950 text-[11px] mt-0.5 leading-relaxed">{exp.expectedImpact}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 border-t border-amber-200/50 pt-2.5 text-[10px]">
                              <span className="text-amber-900 font-semibold uppercase">Expected Improvements:</span>
                              <span className="flex items-center gap-1 text-[11px]">
                                Performance:
                                <strong className={cn(
                                  "font-bold text-[11px]",
                                  exp.performanceImprovement === 'High' ? 'text-emerald-700' : 'text-amber-700'
                                )}>{exp.performanceImprovement}</strong>
                              </span>
                              <span className="flex items-center gap-1 border-l border-amber-200/50 pl-3 text-[11px]">
                                Readability:
                                <strong className={cn(
                                  "font-bold text-[11px]",
                                  exp.readabilityImprovement === 'High' ? 'text-emerald-700' : 'text-amber-700'
                                )}>{exp.readabilityImprovement}</strong>
                              </span>
                              <span className="flex items-center gap-1 border-l border-amber-200/50 pl-3 text-[11px]">
                                Maintainability:
                                <strong className={cn(
                                  "font-bold text-[11px]",
                                  exp.maintainabilityImprovement === 'High' ? 'text-emerald-700' : 'text-amber-700'
                                )}>{exp.maintainabilityImprovement}</strong>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
