"use client";

import { useEffect } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: "success" | "error" | "confirm";
}

export function Toast({
  message,
  visible,
  onDismiss,
  onConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "success",
}: ToastProps) {
  useEffect(() => {
    if (!visible) return;
    if (type === "confirm") return; // Don't auto-dismiss confirmation toasts
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, type]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed right-6 top-20 z-50 flex items-start gap-3 rounded-lg border p-4 text-sm shadow-md transition-all max-w-sm md:max-w-md backdrop-blur-md",
        type === "success" &&
          "border-emerald-500/20 bg-emerald-50/80 text-emerald-800",
        type === "error" && "border-red-500/20 bg-red-50/80 text-red-800",
        type === "confirm" &&
          "border-amber-500/20 bg-amber-50/80 text-amber-900",
      )}
    >
      {type === "success" && (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
      )}
      {type === "error" && (
        <AlertCircle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
      )}
      {type === "confirm" && (
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
      )}

      <div className="flex flex-col gap-3 flex-1">
        <span className="font-medium leading-relaxed">{message}</span>
        {type === "confirm" && onConfirm && (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onDismiss();
              }}
              className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors shadow-sm"
            >
              {confirmText}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded border border-amber-500/30 bg-card px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-muted transition-colors shadow-sm"
            >
              {cancelText}
            </button>
          </div>
        )}
      </div>

      {type !== "confirm" && (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            "ml-2 shrink-0 p-0.5 rounded-md transition-colors",
            type === "success" &&
              "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100/50",
            type === "error" &&
              "text-red-600 hover:text-red-800 hover:bg-red-100/50",
          )}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
