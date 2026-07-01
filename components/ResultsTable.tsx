"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import type { QueryResult } from "@/lib/types";

interface Props {
  result: QueryResult | null;
  isLoading?: boolean;
}

export function ResultsTable({ result, isLoading: _isLoading = false }: Props) {
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  if (!result) {
    return null;
  }

  if (result.rows.length === 0) {
    return (
      <div className="card-surface flex flex-col items-center justify-center py-10">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
          <svg
            className="h-5 w-5 text-emerald-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p className="text-sm text-slate-600">
          {result.rowsAffected !== undefined && result.rowsAffected > 0
            ? `Query executed successfully. ${result.rowsAffected} row(s) affected.`
            : "Query executed successfully. No results returned."}
        </p>
      </div>
    );
  }

  const startIdx = currentPage * pageSize;
  const endIdx = startIdx + pageSize;
  const paginatedRows = result.rows.slice(startIdx, endIdx);
  const totalPages = Math.ceil(result.rows.length / pageSize);

  const exportCSV = () => {
    const headers = result.columns.join(",");
    const rows = result.rows.map((row) =>
      result.columns
        .map((col) => {
          const value = row[col];
          if (
            typeof value === "string" &&
            (value.includes(",") || value.includes('"'))
          ) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? "";
        })
        .join(","),
    );

    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card-surface space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {result.truncated && `Showing first 1000 of `}
          <span className="font-medium text-slate-700">
            {result.rowCount}
          </span>{" "}
          row{result.rowCount !== 1 ? "s" : ""}
          {result.truncated && (
            <span className="ml-1 text-slate-400">(truncated)</span>
          )}
        </div>
        <Button
          onClick={exportCSV}
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-lg text-xs border-slate-300 hover:border-slate-400 dark:border-slate-700 hover:bg-slate-50/80"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200/80">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100">
              {result.columns.map((col, ci) => (
                <th
                  key={`${col}-${ci}`}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, idx) => (
              <tr
                key={idx}
                className="border-b border-slate-100 transition-colors hover:bg-slate-50/80"
              >
                {result.columns.map((col, ci) => (
                  <td
                    key={`${idx}-${ci}`}
                    className="max-w-xs truncate px-4 py-3 text-slate-700"
                  >
                    {typeof row[col] === "object"
                      ? JSON.stringify(row[col])
                      : String(
                          row[col] ?? (
                            <span className="text-slate-300 italic">NULL</span>
                          ),
                        )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-400">
            Page {currentPage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              variant="outline"
              size="sm"
              className="gap-1 rounded-lg text-xs border-slate-300 hover:border-slate-400 dark:border-slate-700 hover:bg-slate-50/80"
            >
              <ChevronLeft className="h-3 w-3" />
              Previous
            </Button>
            <Button
              onClick={() =>
                setCurrentPage(Math.min(totalPages - 1, currentPage + 1))
              }
              disabled={currentPage === totalPages - 1}
              variant="outline"
              size="sm"
              className="gap-1 rounded-lg text-xs border-slate-300 hover:border-slate-400 dark:border-slate-700 hover:bg-slate-50/80"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
