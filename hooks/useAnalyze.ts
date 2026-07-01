import { useMutation } from "@tanstack/react-query";

export type AnalyzeParams =
  | { action: "query"; sql: string; timeline?: unknown[]; history?: unknown[] }
  | {
      action: "timeline" | "db";
      timeline?: unknown[];
      history?: unknown[];
      sql?: string;
    };

export function useAnalyze() {
  return useMutation<unknown, Error, AnalyzeParams>({
    mutationFn: async (params) => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        let errData: { error?: string } | Record<string, unknown>;
        try {
          const text = await res.text();
          errData = text ? JSON.parse(text) : {};
        } catch {
          errData = {};
        }
        throw new Error(errData.error || "Analysis failed");
      }

      return res.json();
    },
  });
}
