'use client';

import { useState, useEffect, useMemo } from 'react';
import { withWorkspacePadding } from '@/components/withWorkspacePadding';
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
  Info,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { DatabaseConnection, QueryHistoryItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useHistory } from '@/hooks/useHistory';
import { useAnalyze, useSaveAnalysis } from '@/hooks/useAnalyze';
import { useExecuteSQL } from '@/hooks/useExecute';

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

const DEFAULT_HEALTH_REPORT: DBHealthReport = {
  queryEfficiency: 85,
  indexCoverage: 70,
  schemaQuality: 90,
  overallScore: 81,
  recommendations: [
    'Add indexes to frequently searched columns.',
    'Always limit results of analytical queries.',
  ],
};

function isDBHealthReport(obj: any): obj is DBHealthReport {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.queryEfficiency === 'number' &&
    typeof obj.indexCoverage === 'number' &&
    typeof obj.schemaQuality === 'number' &&
    typeof obj.overallScore === 'number' &&
    Array.isArray(obj.recommendations) &&
    obj.recommendations.every((r: any) => typeof r === 'string')
  );
}

function AnalyticsPageRaw({
  connection,
  showConfirmation,
  showNotification,
  onRefreshSchema,
}: AnalyticsPageProps) {
  const [analyzingQuery, setAnalyzingQuery] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AIAnalysisResult | null>(null);
  const [selectedQueryForAI, setSelectedQueryForAI] = useState<QueryHistoryItem | null>(null);

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


  // Timeline & Lifecycle analysis states
  const [selectedRun, setSelectedRun] = useState<QueryHistoryItem | null>(null);
  const [analyzingTimeline, setAnalyzingTimeline] = useState(false);
  const [timelineAnalysis, setTimelineAnalysis] = useState<any | null>(null);

  // TanStack hooks
  const analyze = useAnalyze();
  const saveAnalysis = useSaveAnalysis();
  const executeSQL = useExecuteSQL();

  // History query
  const {
    data: historyData = [],
    isLoading: loadingHistory,
    isError: historyIsError,
    refetch: refetchHistory,
  } = useHistory({ limit: 500, connectionId: connection.id });
  const history: QueryHistoryItem[] = historyData as QueryHistoryItem[];
  const historyError = historyIsError ? 'Failed to load history' : null;

  // TanStack Table states and configurations
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  const createSortableHeader = (label: string) => {
    return ({ column }: { column: any }) => (
      <button
        type="button"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className="flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
      >
        {label}
        {column.getIsSorted() === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5 text-slate-600" />
        ) : column.getIsSorted() === 'desc' ? (
          <ArrowDown className="h-3.5 w-3.5 text-slate-600" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40 hover:opacity-75" />
        )}
      </button>
    );
  };

  const columns = useMemo<ColumnDef<QueryHistoryItem>[]>(() => [
    {
      id: 'status',
      accessorFn: (row) => getQueryStatus(row.executionTime).label,
      header: createSortableHeader('Status'),
      cell: (info) => {
        const stat = getQueryStatus(info.row.original.executionTime);
        return (
          <span className={cn('inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold', stat.color)}>
            {stat.label}
          </span>
        );
      },
    },
    {
      accessorKey: 'sql',
      header: createSortableHeader('Query'),
      cell: (info) => (
        <span className="max-w-xs truncate block font-mono text-xs text-slate-700" title={info.getValue() as string}>
          {info.getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: 'executionTime',
      header: createSortableHeader('Time'),
      cell: (info) => {
        const val = info.getValue() as number | undefined;
        return <span className="tabular-nums text-slate-600 font-medium">{val != null ? `${val}ms` : '-'}</span>;
      },
    },
    {
      accessorKey: 'rowsScanned',
      header: createSortableHeader('Scanned'),
      cell: (info) => {
        const val = info.getValue() as number | undefined;
        return <span className="tabular-nums text-slate-600 font-medium">{val != null ? val.toLocaleString() : '-'}</span>;
      },
    },
    {
      accessorKey: 'rowsReturned',
      header: createSortableHeader('Returned'),
      cell: (info) => {
        const val = info.getValue() as number | undefined;
        return <span className="tabular-nums text-slate-600 font-medium">{val != null ? val.toLocaleString() : '-'}</span>;
      },
    },
    {
      id: 'index',
      accessorFn: (row) => row.indexesUsed?.[0] || 'Seq scan',
      header: createSortableHeader('Index'),
      cell: (info) => {
        const indexes = info.row.original.indexesUsed;
        return indexes && indexes.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <Key className="h-3 w-3" />
            {indexes[0]}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Seq scan</span>
        );
      },
    },
    {
      accessorKey: 'cpuUsage',
      header: createSortableHeader('CPU'),
      cell: (info) => {
        const val = info.getValue() as number | undefined;
        return <span className="tabular-nums text-slate-600 font-medium">{val != null ? `${val}%` : '-'}</span>;
      },
    },
    {
      accessorKey: 'memoryUsage',
      header: createSortableHeader('Memory'),
      cell: (info) => {
        const val = info.getValue() as number | undefined;
        return <span className="tabular-nums text-slate-600 font-medium">{val != null ? `${val}MB` : '-'}</span>;
      },
    },
  ], []);

  const table = useReactTable({
    data: history,
    columns,
    state: {
      sorting,
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, value) => {
      const searchStr = `${row.original.sql} ${row.original.prompt || ''}`.toLowerCase();
      return searchStr.includes(value.toLowerCase());
    },
  });

  const getPageNumbers = (current: number, total: number) => {
    const pages: (number | string)[] = [];
    if (total <= 5) {
      for (let i = 0; i < total; i++) pages.push(i);
    } else {
      if (current <= 2) {
        pages.push(0, 1, 2, 3, '...', total - 1);
      } else if (current >= total - 3) {
        pages.push(0, '...', total - 4, total - 3, total - 2, total - 1);
      } else {
        pages.push(0, '...', current - 1, current, current + 1, '...', total - 1);
      }
    }
    return pages;
  };

  const healthPieData = useMemo(() => [
    { name: 'Efficiency', value: healthReport.queryEfficiency, color: '#2563eb' },
    { name: 'Index Coverage', value: healthReport.indexCoverage, color: '#60a5fa' },
    { name: 'Schema Quality', value: healthReport.schemaQuality, color: '#e2e8f0' },
  ], [healthReport]);

  const latencyChartData = useMemo(() => {
    return history
      .slice(0, 10)
      .reverse()
      .map((h, index) => ({
        index: index + 1,
        time: h.executionTime || 0,
        query: h.sql,
      }));
  }, [history]);

  const handleAnalyzeTimeline = async (run: QueryHistoryItem) => {
    if (!run.timeline || run.timeline.length === 0) {
      showNotification('No timeline steps recorded for this execution.', 'error');
      return;
    }
    setAnalyzingTimeline(true);
    setTimelineAnalysis(null);
    try {
      const report = await analyze.mutateAsync({ action: 'timeline', timeline: run.timeline });
      setTimelineAnalysis(report);
      saveAnalysis.mutate({ action: 'timeline', targetSql: run.sql, result: report });
      showNotification('Lifecycle analysis completed!', 'success');
    } catch (err) {
      showNotification(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setAnalyzingTimeline(false);
    }
  };




  const persistAnalysis = (action: string, targetSql: string | null, result: Record<string, unknown>) => {
    saveAnalysis.mutate({ action, targetSql, result });
  const saveAnalysis = async (action: string, targetSql: string | null, result: Record<string, unknown>) => {
    try {
      await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, targetSql, result, connectionId: connection.id }),
      });
    } catch (err) {
      console.error('Failed to persist analysis:', err);
    }
  };

  // Load latest connection-specific health score/report from DB
  const loadLatestHealthReport = async (connId: string) => {
    // Reset to defaults so previous connection's data is not visible
    setHealthReport(DEFAULT_HEALTH_REPORT);

    try {
      const res = await fetch(`/api/analysis?connectionId=${encodeURIComponent(connId)}&action=db&limit=1`, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error('Failed to load connection-specific health report');
      }
      const data = await res.json();
      
      // Prevent stale response from overwriting active connection view
      if (connection.id !== connId) {
        return;
      }

      const analyses = data.analyses || [];
      const dbReport = analyses[0];
      if (dbReport && dbReport.result && isDBHealthReport(dbReport.result)) {
        setHealthReport(dbReport.result);
      } else {
        setHealthReport(DEFAULT_HEALTH_REPORT);
      }
    } catch (err) {
      console.error('Failed to load health report:', err);
      if (connection.id === connId) {
        setHealthReport(DEFAULT_HEALTH_REPORT);
      }
    }
  };

  // Load history from MongoDB via API. This is the single source of truth for
  // execution metrics (execution_time, rows_scanned, cpu_usage, etc.) and
  // survives page reloads because it is persisted server-side.
  const loadHistory = () => {
    refetchHistory();
  };

  useEffect(() => {
    loadHistory();
    loadLatestHealthReport(connection.id);
    setSelectedRun(null);
    setTimelineAnalysis(null);
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
      const report = await analyze.mutateAsync({ action: 'db', history });
      setHealthReport(report);
      persistAnalysis('db', null, report);
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
      const result = await analyze.mutateAsync({ action: 'query', sql: queryItem.sql });
      setAnalysisResult(result);
      persistAnalysis('query', queryItem.sql, result);
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
          await executeSQL.mutateAsync(ddl);
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
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">AI Database Performance Advisor</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor query latencies, examine index coverage, and apply AI-driven suggestions.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDbAudit}
          disabled={auditingDb}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', auditingDb && 'animate-spin')} />
          Run Health Audit
        </button>
      </div>

      {/* Execution Metrics Summary Cards */}
      <div className="mb-8 grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {[
          { label: 'Total Queries', value: metrics.total.toLocaleString(), icon: FileText, color: 'text-slate-700', iconBg: 'bg-slate-100' },
          { label: 'Avg Time', value: `${metrics.avgTime}ms`, icon: Clock, color: metrics.avgTime > 100 ? 'text-red-600' : 'text-emerald-600', iconBg: metrics.avgTime > 100 ? 'bg-red-50' : 'bg-emerald-50' },
          { label: 'Avg Scanned', value: metrics.avgScanned.toLocaleString(), icon: Database, color: 'text-slate-700', iconBg: 'bg-slate-100', tooltip: 'Represents rows read by the query planner. For SQLite, full table scans estimate actual table sizes; indexed lookups count matching keys. For Postgres/MySQL, this reflects the optimizer\'s scan plans.' },
          { label: 'Avg Returned', value: metrics.avgReturned.toLocaleString(), icon: TrendingUp, color: 'text-slate-700', iconBg: 'bg-slate-100' },
          { label: 'Avg CPU', value: `${metrics.avgCpu}%`, icon: Cpu, color: 'text-slate-700', iconBg: 'bg-slate-100', tooltip: 'Represents active Node process CPU consumption for local SQLite, or estimated server load based on query complexity for remote databases.' },
          { label: 'Avg Memory', value: `${metrics.avgMem}MB`, icon: MemoryStick, color: 'text-slate-700', iconBg: 'bg-slate-100', tooltip: 'Represents heap allocation for local SQLite processing, or estimated client-side data buffering footprint for remote databases.' },
          { label: 'Index Hit', value: `${metrics.indexHitRatio}%`, icon: Key, color: metrics.indexHitRatio > 50 ? 'text-emerald-600' : 'text-amber-600', iconBg: metrics.indexHitRatio > 50 ? 'bg-emerald-50' : 'bg-amber-50' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {card.label}
                {card.tooltip && (
                  <span className="cursor-help shrink-0" title={card.tooltip}>
                    <Info className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                  </span>
                )}
              </span>
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', card.iconBg)}>
                <card.icon className={cn('h-3.5 w-3.5', card.color)} />
              </div>
            </div>
            <p className={cn('mt-2.5 text-xl font-bold tabular-nums', card.color)}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Grid: Health Score Dial & Recommendations */}
      <div className="mb-8 grid gap-6 md:grid-cols-3">
        {/* Health Dial Card matching mockup style */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col justify-between min-h-[275px]">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Health</h3>
            <p className="text-5xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {healthReport.overallScore}
            </p>
          </div>

          <div className="flex items-center justify-between mt-4 gap-6">
            {/* Left side: Capsule color legends */}
            <div className="flex flex-col gap-2.5 shrink-0">
              {[
                { name: 'Efficiency', value: healthReport.queryEfficiency, color: '#2563eb' },
                { name: 'Index Cov', value: healthReport.indexCoverage, color: '#60a5fa' },
                { name: 'Schema', value: healthReport.schemaQuality, color: '#e2e8f0' },
              ].map((item) => (
                <div key={item.name} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <span
                    className="h-2 w-4 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm font-bold text-slate-800 tabular-nums">{item.value}%</span>
                  <span className="text-[11px] text-slate-400 font-medium">{item.name}</span>
                </div>
              ))}
            </div>

            {/* Right side: Recharts Donut Pie Chart */}
            <div className="h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={healthPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={60}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {healthPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-md text-xs font-semibold">
                            <span className="text-slate-500">{data.name}: </span>
                            <span className="text-slate-850">{data.value}%</span>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* AI Health Recommendations */}
        <div className="rounded-xl border border-border bg-card flex flex-col justify-between p-6 md:col-span-2 shadow-sm">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-50">
                <Gauge className="h-3.5 w-3.5" />
              </div>
              AI Recommendations
            </div>
            <ul className="space-y-3 text-sm leading-relaxed text-slate-600">
              {healthReport.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-3">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-5 border-t border-slate-200/80 pt-3 text-[11px] text-slate-400">
            Last audited: <span className="font-medium text-slate-600">{connection.name}</span>
          </div>
        </div>
      </div>

      {/* Section: Custom SVG Visualizations */}
      <div className="mb-8 grid gap-6 md:grid-cols-2">
        {/* SVG Query Execution Trend */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-primary" />
            Query Latencies (Last 10 Queries)
          </h3>
          <div className="h-44 pt-4 relative">
            {history.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                No executions recorded.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={latencyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="index"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    unit="ms"
                  />
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-slate-100 bg-white p-3 shadow-lg text-xs max-w-xs space-y-1">
                            <p className="font-semibold text-slate-700 font-medium">Run #{data.index}</p>
                            <p className="text-slate-500 font-mono break-all line-clamp-2">{data.query}</p>
                            <p className="flex justify-between items-center gap-4 pt-1.5 border-t border-slate-100">
                              <span className="text-slate-400">Latency:</span>
                              <span className="font-bold text-slate-900">{data.time}ms</span>
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="time"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#latencyGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* SVG Table Usage */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Database className="h-4 w-4 text-primary" />
            Most Consulted Tables
          </h3>
          {topTables.length === 0 ? (
            <div className="flex h-44 items-center justify-center text-sm text-slate-400">
              No tables accessed yet.
            </div>
          ) : (
            <div className="flex h-44 flex-col justify-center space-y-4">
              {topTables.map(([tbl, count]) => {
                const maxCount = Math.max(...topTables.map((t) => t[1]));
                const pct = (count / maxCount) * 100;
                return (
                  <div key={tbl} className="text-sm">
                    <div className="mb-1.5 flex justify-between text-xs font-medium">
                      <span className="text-slate-700">{tbl}</span>
                      <span className="tabular-nums text-slate-400">{count} queries</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
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
        <div className="mb-8 card-surface border-amber-200/80 bg-amber-50/30 p-6">
          <div className="mb-5 flex items-center justify-between border-b border-amber-100 pb-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100">
                <Zap className="h-3.5 w-3.5 text-amber-600" />
              </div>
              AI Performance Analysis
            </h3>
            <button
              type="button"
              onClick={() => setSelectedQueryForAI(null)}
              className="text-xs font-semibold text-amber-600 transition-colors hover:text-amber-800"
            >
              Close Panel
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Target Query</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-amber-200/80 bg-background p-4 font-mono text-xs text-amber-950">
                <code>{selectedQueryForAI.sql}</code>
              </pre>
            </div>

            {analyzingQuery ? (
              <div className="flex items-center gap-2 py-4 text-sm font-medium text-amber-800">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing execution parameters and query planning...
              </div>
            ) : (
              analysisResult && (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Diagnosis</span>
                      <p className="mt-1 text-sm text-amber-950">{analysisResult.rootCause}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Explanation</span>
                      <p className="mt-1 text-sm leading-relaxed text-amber-900">{analysisResult.explanation}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                        Proposed Optimization
                      </span>
                      <div className="relative mt-2">
                        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-white">
                          <code>{analysisResult.optimizedQuery}</code>
                        </pre>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(analysisResult.optimizedQuery)}
                          className="absolute right-2.5 top-2.5 rounded-lg bg-slate-800 p-1.5 text-slate-400 transition-colors hover:text-white"
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
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                      >
                        <Zap className="h-4 w-4" />
                        Apply Index Optimization
                      </button>
                    )}
                  </div>

                  {/* Side-by-side performance comparison */}
                  <div className="flex flex-col justify-center">
                    <span className="mb-3 block text-[10px] font-bold uppercase tracking-wider text-amber-700">
                      Side-By-Side Projection
                    </span>
                    <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-background">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-amber-100 bg-amber-50/50 font-medium text-slate-500">
                            <th className="p-3">Metric</th>
                            <th className="p-3 text-amber-700">Before</th>
                            <th className="p-3 text-emerald-700">After (Est)</th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-700">
                          <tr className="border-b border-amber-50">
                            <td className="p-3 font-medium">Exec Time</td>
                            <td className="p-3 text-amber-600">{analysisResult.estTimeBefore}ms</td>
                            <td className="p-3 font-semibold text-emerald-600">{analysisResult.estTimeAfter}ms</td>
                          </tr>
                          <tr className="border-b border-amber-50">
                            <td className="p-3 font-medium">Rows Scanned</td>
                            <td className="p-3 text-amber-600">{analysisResult.estScannedBefore.toLocaleString()}</td>
                            <td className="p-3 font-semibold text-emerald-600">
                              {analysisResult.estScannedAfter.toLocaleString()}
                            </td>
                          </tr>
                          <tr>
                            <td className="p-3 font-medium">Index Used</td>
                            <td className="p-3 text-amber-600">No (Full Scan)</td>
                            <td className="p-3 font-semibold text-emerald-600">Yes (Index Scan)</td>
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
      <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-600">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-55/20">
            <AlertTriangle className="h-3.5 w-3.5" />
          </div>
          Slow Query Detection ({'>'}100ms)
        </h3>
        {loadingHistory ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          </div>
        ) : historyError ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-sm text-red-600">{historyError}</p>
            <button
              type="button"
              onClick={loadHistory}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50"
            >
              Retry
            </button>
          </div>
        ) : slowQueries.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            Excellent! No queries exceeded the 100ms latency threshold.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/50 text-left text-xs font-medium text-slate-500">
                  <th className="p-3">Query</th>
                  <th className="p-3">Execution Time</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {slowQueries.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/50">
                    <td className="max-w-md truncate p-3 font-mono text-xs text-slate-700" title={item.sql}>
                      {item.sql}
                    </td>
                    <td className="p-3 text-sm font-semibold text-red-600 tabular-nums">{item.executionTime}ms</td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => handleOptimizeQuery(item)}
                        disabled={analyzingQuery === item.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60"
                      >
                        <Zap className="h-3 w-3" />
                        Optimize
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section: Performance Dashboard Table OR Nested Lifecycle Explorer */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {!selectedRun ? (
          <>
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                </div>
                Recent Executions <span className="ml-1 font-normal text-muted-foreground/60 normal-case">(Click row to analyze lifecycle)</span>
              </h3>
              
              {/* Search Input */}
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  placeholder="Search queries..."
                  className="w-full rounded-lg border border-slate-200 bg-white/50 pl-9 pr-4 py-2 text-sm placeholder-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
              </div>
            ) : historyError ? (
              <div className="flex flex-col items-start gap-2 py-2">
                <p className="text-sm text-red-600">{historyError}</p>
                <button
                  type="button"
                  onClick={loadHistory}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50"
                >
                  Retry
                </button>
              </div>
            ) : history.length === 0 ? (
              <p className="py-2 text-sm text-slate-500">No query execution history found on this session.</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id} className="border-b border-slate-200 bg-slate-55/40 text-left text-xs font-semibold text-slate-500">
                          {headerGroup.headers.map((header) => (
                            <th key={header.id} className="p-3">
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {table.getRowModel().rows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => {
                            setSelectedRun(row.original);
                            setTimelineAnalysis(null);
                          }}
                          className={cn(
                            'cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/50',
                            selectedRun?.id === row.original.id && 'bg-primary/5 font-medium'
                          )}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="p-3">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination footer */}
                <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-4 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span>
                      Showing{' '}
                      <span className="font-semibold text-slate-700">
                        {table.getRowModel().rows.length === 0
                          ? 0
                          : table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
                      </span>{' '}
                      to{' '}
                      <span className="font-semibold text-slate-700">
                        {Math.min(
                          (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                          table.getFilteredRowModel().rows.length
                        )}
                      </span>{' '}
                      of{' '}
                      <span className="font-semibold text-slate-700">
                        {table.getFilteredRowModel().rows.length}
                      </span>{' '}
                      executions
                    </span>

                    <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
                      <span>Rows per page:</span>
                      <select
                        value={table.getState().pagination.pageSize}
                        onChange={(e) => {
                          table.setPageSize(Number(e.target.value));
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                      >
                        {[10, 20, 50, 100].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                      className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </button>

                    {getPageNumbers(table.getState().pagination.pageIndex, table.getPageCount()).map((p, idx) => {
                      if (p === '...') {
                        return (
                          <span key={`dots-${idx}`} className="px-1.5 text-slate-400 text-xs">
                            ...
                          </span>
                        );
                      }
                      return (
                        <button
                          key={`page-${p}`}
                          type="button"
                          onClick={() => table.setPageIndex(p as number)}
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-all cursor-pointer',
                            table.getState().pagination.pageIndex === p
                              ? 'bg-primary text-white shadow-sm'
                              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          {(p as number) + 1}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                      className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          /* Nested Lifecycle Explorer View */
          <div className="space-y-6">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center text-xs font-semibold text-slate-400">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRun(null);
                    setTimelineAnalysis(null);
                  }}
                  className="hover:text-primary transition-colors cursor-pointer"
                >
                  Recent Executions
                </button>
                <span className="mx-2 text-slate-350">/</span>
                <span className="text-slate-600">Query #{selectedRun.id.substring(0, 8)} Lifecycle</span>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleAnalyzeTimeline(selectedRun)}
                  disabled={analyzingTimeline || !selectedRun.timeline?.length}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                >
                  <Zap className="h-3.5 w-3.5" />
                  {analyzingTimeline ? 'Analyzing...' : 'AI Lifecycle Analysis'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRun(null);
                    setTimelineAnalysis(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 cursor-pointer"
                >
                  Back to Executions List
                </button>
              </div>
            </div>

            {/* Back button and Title block */}
            <div className="flex items-start">
              <button
                type="button"
                onClick={() => {
                  setSelectedRun(null);
                  setTimelineAnalysis(null);
                }}
                className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
                title="Back to list"
              >
                <ChevronLeft className="h-4 w-4 text-slate-500" />
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                  </div>
                  Query Execution Lifecycle Timeline
                </h3>
                <p className="mt-1 max-w-2xl truncate text-xs text-slate-500" title={selectedRun.prompt || selectedRun.sql}>
                  {selectedRun.prompt || selectedRun.sql}
                </p>
              </div>
            </div>

            {/* Per-query metrics summary */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {[
                { label: 'Exec Time', value: selectedRun.executionTime != null ? `${selectedRun.executionTime}ms` : '-' },
                { label: 'Rows Scanned', value: selectedRun.rowsScanned != null ? selectedRun.rowsScanned.toLocaleString() : '-' },
                { label: 'Rows Returned', value: selectedRun.rowsReturned != null ? selectedRun.rowsReturned.toLocaleString() : '-' },
                { label: 'Rows Affected', value: selectedRun.rowsAffected != null ? selectedRun.rowsAffected.toLocaleString() : '-' },
                { label: 'CPU Usage', value: selectedRun.cpuUsage != null ? `${selectedRun.cpuUsage}%` : '-' },
                { label: 'Memory', value: selectedRun.memoryUsage != null ? `${selectedRun.memoryUsage}MB` : '-' },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-slate-200/80 bg-slate-50/50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-slate-800">{m.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Timeline Flow list */}
              <div className="max-h-[500px] space-y-4 overflow-y-auto border-r border-slate-200/80 pr-6 lg:col-span-1">
                <span className="mb-3 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Execution Steps ({selectedRun.timeline?.length || 0})
                </span>
                
                {!selectedRun.timeline || selectedRun.timeline.length === 0 ? (
                  <p className="text-sm text-slate-400">No timeline steps recorded for this execution.</p>
                ) : (
                  <div className="relative space-y-5 border-l border-slate-200 pl-5">
                    {selectedRun.timeline.map((step) => {
                      let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
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
                        typeLabel = 'AI Optimization';
                      } else if (step.type === 'final_executed') {
                        badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        typeLabel = 'Final Execution';
                      }

                      return (
                        <div key={step.id} className="relative group">
                          <div className={cn(
                            "absolute -left-[22px] top-2 h-2.5 w-2.5 rounded-full border-2 border-white",
                            step.success ? "bg-emerald-500" : "bg-red-500"
                          )} />

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className={cn("inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold", badgeColor)}>
                                {typeLabel}
                              </span>
                              <span className="text-[10px] tabular-nums text-slate-400">
                                {step.executionTime ? `${step.executionTime}ms` : ''}
                              </span>
                            </div>
                            
                            <pre className="overflow-x-auto rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-850 max-h-36">
                              <code>{step.sql}</code>
                            </pre>

                            {step.error && (
                              <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] font-medium text-red-600">
                                Error: {step.error}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* AI Analysis Details */}
              <div className="max-h-[500px] space-y-6 overflow-y-auto lg:col-span-2">
                {!timelineAnalysis ? (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/30 py-16 text-center">
                    <Activity className="mb-3 h-8 w-8 animate-pulse text-slate-300" />
                    <p className="text-sm font-semibold text-slate-700">Query Lifecycle Analysis Pending</p>
                    <p className="mt-1.5 max-w-sm text-xs text-slate-400">
                      Click "AI Lifecycle Analysis" to analyze every query step and evaluate optimization rewrites.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Step-by-Step Analysis */}
                    <div>
                      <span className="mb-4 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Query Analysis Chain
                      </span>
                      <div className="space-y-4">
                        {timelineAnalysis.queries?.map((q: any, idx: number) => (
                          <div key={idx} className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/30 p-4">
                            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-white">
                              <code>{q.sql}</code>
                            </pre>
                            <div className="grid gap-3 pt-1 text-sm sm:grid-cols-2">
                              <div>
                                <span className="font-semibold text-slate-700">Purpose</span>
                                <p className="mt-0.5 text-xs text-slate-500">{q.purpose}</p>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">Cost</span>
                                <p className="mt-0.5 text-xs text-slate-500">{q.cost || 'N/A'}</p>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">Tables Involved</span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {q.tablesInvolved?.map((t: string) => (
                                    <span key={t} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground">{t}</span>
                                  )) || <span className="text-xs text-muted-foreground">-</span>}
                                </div>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">Bottlenecks</span>
                                <p className="mt-0.5 text-xs font-medium text-amber-600">{q.bottlenecks || 'None detected'}</p>
                              </div>
                            </div>
                            {q.optimizationOpportunities && (
                              <div className="border-t border-slate-200/60 pt-3 text-sm">
                                <span className="font-semibold text-emerald-600">Optimization Opportunities</span>
                                <p className="mt-0.5 text-xs text-slate-500">{q.optimizationOpportunities}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* SOLID / DRY / KISS / YAGNI principles */}
                    <div>
                      <span className="mb-4 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Engineering Principles Validation
                      </span>
                      <div className="grid gap-3 sm:grid-cols-4">
                        {['dry', 'yagni', 'kiss', 'solid'].map((p) => {
                          const val = timelineAnalysis.principlesValidation?.[p];
                          if (!val) return null;
                          
                          let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
                          if (val.status === 'follows') badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                          if (val.status === 'violates') badgeColor = 'bg-red-50 text-red-700 border-red-200';

                          return (
                            <div key={p} className="flex flex-col justify-between rounded-xl border border-border bg-background p-4">
                              <div>
                                <span className="text-xs font-bold uppercase text-slate-700">{p}</span>
                                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{val.description}</p>
                              </div>
                              <span className={cn("mt-3 inline-block w-fit rounded-md border px-2 py-0.5 text-[10px] font-bold capitalize", badgeColor)}>
                                {val.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {timelineAnalysis.principlesValidation?.concerns?.length > 0 && (
                        <div className="mt-4 space-y-1.5 rounded-xl border border-red-200 bg-red-50/40 p-4">
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Maintainability & Redundancy Concerns
                          </span>
                          <ul className="ml-5 list-disc text-xs text-red-700 space-y-1">
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
                        <span className="mb-4 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Query Optimization & Change Explanations
                        </span>
                        <div className="space-y-4">
                          {timelineAnalysis.changeExplanations.map((exp: any, idx: number) => (
                            <div key={idx} className="space-y-4 rounded-xl border border-amber-200/80 bg-amber-50/20 p-4">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Optimized Query</span>
                                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-white">
                                  <code>{exp.sql}</code>
                                </pre>
                              </div>
                              
                              <div className="grid gap-3 pt-1 text-sm sm:grid-cols-3">
                                <div>
                                  <span className="font-semibold text-amber-900">What Changed</span>
                                  <p className="mt-0.5 text-xs leading-relaxed text-amber-800">{exp.whatChanged}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-amber-900">Why Needed</span>
                                  <p className="mt-0.5 text-xs leading-relaxed text-amber-800">{exp.whyNeeded}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-amber-900">Expected Impact</span>
                                  <p className="mt-0.5 text-xs leading-relaxed text-amber-800">{exp.expectedImpact}</p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-4 border-t border-amber-200/50 pt-3 text-[10px]">
                                <span className="font-semibold uppercase text-amber-700">Improvements:</span>
                                <span className="flex items-center gap-1 text-xs">
                                  Performance:
                                  <strong className={cn(
                                    "font-bold",
                                    exp.performanceImprovement === 'High' ? 'text-emerald-600' : 'text-amber-600'
                                  )}>{exp.performanceImprovement}</strong>
                                </span>
                                <span className="flex items-center gap-1 border-l border-amber-200/50 pl-3 text-xs">
                                  Readability:
                                  <strong className={cn(
                                    "font-bold",
                                    exp.readabilityImprovement === 'High' ? 'text-emerald-600' : 'text-amber-600'
                                  )}>{exp.readabilityImprovement}</strong>
                                </span>
                                <span className="flex items-center gap-1 border-l border-amber-200/50 pl-3 text-xs">
                                  Maintainability:
                                  <strong className={cn(
                                    "font-bold",
                                    exp.maintainabilityImprovement === 'High' ? 'text-emerald-600' : 'text-amber-600'
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
    </div>
  );
}

export const AnalyticsPage = withWorkspacePadding(AnalyticsPageRaw, { scrollable: true, bg: 'bg-slate-50/50' });
