"use client";

import { useEffect, useState } from "react";
import { KeyRound, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface KeyInfo {
  configured: boolean;
  provider?: "groq" | "anthropic";
  source: "env" | "client" | "none";
  maskedKey?: string;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadInfo = async () => {
    try {
      const res = await fetch("/api/settings", { credentials: "same-origin" });
      if (res.ok) {
        setInfo(await res.json());
      }
    } catch {
      setInfo({ configured: false, source: "none" });
    }
  };

  useEffect(() => {
    if (open) {
      setError("");
      setSuccess("");
      setApiKey("");
      loadInfo();
    }
  }, [open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save API key");

      setApiKey("");
      setSuccess("API key saved successfully.");
      setInfo(data);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save API key");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove the saved API key?")) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/settings", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove API key");

      setSuccess(
        data.configured
          ? "Saved key removed. Falling back to .env.local key."
          : "API key removed.",
      );
      setInfo({
        configured: data.configured,
        source: data.source,
        provider: data.provider,
        maskedKey: data.maskedKey,
      });
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove API key");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/20 backdrop-blur-[6px] p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden transition-all duration-300">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-white/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#93C5FD] text-white shadow-sm shadow-primary/20 group">
              <Settings className="h-5 w-5 text-white transition-transform duration-500 hover:rotate-90" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground tracking-tight">
                Settings
              </h2>
              <p className="text-[11px] font-medium text-foreground/60">
                Manage your AI API configurations
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-muted-foreground transition-all duration-200 hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-6">
          <section>
            <div className="mb-3.5 flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-semibold tracking-wider uppercase text-foreground/80">
                AI API Key
              </h3>
            </div>

            <p className="mb-5 text-xs leading-relaxed font-medium text-foreground/80">
              Required for natural language to SQL queries. Provide a free Groq
              key from{" "}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80 transition-colors font-medium"
              >
                console.groq.com
              </a>{" "}
              (recommended) or an Anthropic key from{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80 transition-colors font-medium"
              >
                console.anthropic.com
              </a>
              .
            </p>

            {info?.configured && (
              <div className="mb-5 space-y-3 rounded-xl border border-white/60 bg-white/40 p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground/75">
                    Current key
                  </span>
                  <span className="font-mono text-xs text-foreground font-semibold px-2 py-0.5 rounded bg-primary/10 border border-primary/20 shadow-sm">
                    {info.maskedKey}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-primary/5 pt-2.5">
                  <span className="text-[11px] font-semibold text-foreground/75">
                    Provider
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider">
                    {info.provider === "groq" ? "Groq" : "Anthropic"}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-primary/5 pt-2.5">
                  <span className="text-[11px] font-semibold text-foreground/75">
                    Source
                  </span>
                  <span className="text-xs text-foreground/80 font-semibold flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {info.source === "env"
                      ? ".env.local key"
                      : "Saved in app settings"}
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <KeyRound className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="gsk_... or sk-ant-..."
                  className="w-full rounded-xl border border-border bg-white/60 pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:bg-white focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 focus:shadow-sm"
                />
              </div>
              <div className="flex gap-2.5">
                <Button
                  type="submit"
                  disabled={saving || !apiKey.trim()}
                  className="rounded-xl bg-gradient-to-r from-primary to-[#25A691] text-primary-foreground hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] transition-all px-5 py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  {saving
                    ? "Saving..."
                    : info?.configured
                      ? "Update key"
                      : "Save key"}
                </Button>
                {info?.configured && info.source === "client" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={handleRemove}
                    className="rounded-xl border border-border bg-white/40 hover:bg-red-500/5 hover:text-red-500 hover:border-red-500/20 active:scale-[0.98] text-muted-foreground transition-all px-5 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    Remove key
                  </Button>
                )}
              </div>
            </form>

            {error && (
              <p className="mt-3 text-xs font-medium text-red-600 animate-pulse">
                {error}
              </p>
            )}
            {success && (
              <p className="mt-3 text-xs font-medium text-emerald-600">
                {success}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
