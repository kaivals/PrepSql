import { useMutation } from "@tanstack/react-query";

export type AnalyzeParams =
  | { action: "query"; sql: string; timeline?: any[]; history?: any[] }
  | {
      action: "timeline" | "db";
      timeline?: any[];
      history?: any[];
      sql?: string;
    };

export function useAnalyze() {
  return useMutation<any, Error, AnalyzeParams>({
    mutationFn: async (params) => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        let errData: any;
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
