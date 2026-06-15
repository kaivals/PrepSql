'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
}

export function Toast({ message, visible, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="fixed right-6 top-20 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 shadow-sm">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="ml-2 text-emerald-600 hover:text-emerald-800">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
