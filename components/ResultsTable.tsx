'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { QueryResult } from '@/lib/types';

interface Props {
  result: QueryResult | null;
  isLoading?: boolean;
}

export function ResultsTable({ result, isLoading = false }: Props) {
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  if (!result) {
    return null;
  }

  if (result.rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-muted-foreground">
          {result.rowsAffected !== undefined && result.rowsAffected > 0
            ? `Query executed successfully. ${result.rowsAffected} row(s) affected.`
            : 'Query executed successfully. No results returned.'}
        </p>
      </div>
    );
  }

  const startIdx = currentPage * pageSize;
  const endIdx = startIdx + pageSize;
  const paginatedRows = result.rows.slice(startIdx, endIdx);
  const totalPages = Math.ceil(result.rows.length / pageSize);

  const exportCSV = () => {
    const headers = result.columns.join(',');
    const rows = result.rows.map((row) =>
      result.columns
        .map((col) => {
          const value = row[col];
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? '';
        })
        .join(',')
    );

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {result.truncated && `Showing first 1000 of `}
          {result.rowCount} row{result.rowCount !== 1 ? 's' : ''}
          {result.truncated && ' (truncated)'}
        </div>
        <Button onClick={exportCSV} variant="outline" size="sm">
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary">
              {result.columns.map((col, ci) => (
                <th key={`${col}-${ci}`} className="px-4 py-2 text-left font-medium text-foreground">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, idx) => (
              <tr key={idx} className="border-b border-border hover:bg-muted/50">
                {result.columns.map((col, ci) => (
                  <td key={`${idx}-${ci}`} className="px-4 py-2 text-foreground max-w-xs truncate">
                    {typeof row[col] === 'object'
                      ? JSON.stringify(row[col])
                      : String(row[col] ?? 'NULL')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            Page {currentPage + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              variant="outline"
              size="sm"
            >
              Previous
            </Button>
            <Button
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage === totalPages - 1}
              variant="outline"
              size="sm"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
