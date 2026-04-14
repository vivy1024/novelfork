/**
 * ContextPanel — Collapsible right sidebar showing context entries
 * injected into AI prompts, with token budget visualization.
 */

import { useState, useEffect, useCallback } from "react";
import { X, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Switch } from "./ui/switch";
import { fetchJson } from "../hooks/use-api";

interface ContextEntry {
  readonly source: string;
  readonly label: string;
  readonly content: string;
  readonly tokens: number;
  readonly active: boolean;
}

interface ContextAssemblyResponse {
  readonly entries: ReadonlyArray<ContextEntry>;
  readonly totalTokens: number;
  readonly budgetMax: number;
}

interface ContextPanelProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly visible: boolean;
  readonly onClose: () => void;
}

function budgetColor(ratio: number): string {
  if (ratio < 0.6) return "bg-emerald-500";
  if (ratio < 0.85) return "bg-amber-500";
  return "bg-red-500";
}

function budgetTextColor(ratio: number): string {
  if (ratio < 0.6) return "text-emerald-600";
  if (ratio < 0.85) return "text-amber-600";
  return "text-red-600";
}

export function ContextPanel({ bookId, chapterNumber, visible, onClose }: ContextPanelProps) {
  const [entries, setEntries] = useState<ReadonlyArray<ContextEntry>>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [budgetMax, setBudgetMax] = useState(8000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<ReadonlySet<string>>(new Set());
  const [disabledSources, setDisabledSources] = useState<ReadonlySet<string>>(new Set());

  const fetchContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ContextAssemblyResponse>("/api/ai/context-assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, chapterNumber }),
      });
      setEntries(data.entries);
      setTotalTokens(data.totalTokens);
      setBudgetMax(data.budgetMax);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterNumber]);

  useEffect(() => {
    if (visible) {
      fetchContext();
    }
  }, [visible, fetchContext]);

  const toggleExpanded = (source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  const toggleDisabled = (source: string) => {
    setDisabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  // Recalculate active tokens based on disabled sources
  const activeTokens = entries.reduce(
    (sum, entry) => (disabledSources.has(entry.source) ? sum : sum + entry.tokens),
    0,
  );

  const ratio = budgetMax > 0 ? activeTokens / budgetMax : 0;

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[360px] flex flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-sm font-bold text-foreground">上下文面板</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        >
          <X size={16} />
        </button>
      </div>

      {/* Token Budget Bar */}
      <div className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs font-bold ${budgetTextColor(ratio)}`}>
            已用 {activeTokens.toLocaleString()}/{budgetMax.toLocaleString()} tokens
          </span>
          <span className="text-[10px] text-muted-foreground font-medium">
            {Math.round(ratio * 100)}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${budgetColor(ratio)}`}
            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* Entry List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">加载上下文...</span>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText size={24} className="mb-2 opacity-40" />
            <span className="text-xs">暂无上下文条目</span>
          </div>
        )}

        {!loading &&
          entries.map((entry) => {
            const isExpanded = expandedSources.has(entry.source);
            const isDisabled = disabledSources.has(entry.source);
            const preview = entry.content.slice(0, 100);
            const hasMore = entry.content.length > 100;

            return (
              <div
                key={entry.source}
                className={`border-b border-border/30 transition-colors ${isDisabled ? "opacity-40" : ""}`}
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <Switch
                    checked={!isDisabled}
                    onCheckedChange={() => toggleDisabled(entry.source)}
                  />

                  <button
                    onClick={() => toggleExpanded(entry.source)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                    )}

                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary shrink-0">
                      {entry.source}
                    </span>

                    <span className="text-xs text-foreground truncate">{entry.label}</span>
                  </button>

                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {entry.tokens}
                  </span>
                </div>

                {/* Content Preview / Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-3 pl-12">
                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed bg-secondary/30 rounded-lg p-3 max-h-[200px] overflow-y-auto">
                      {isExpanded ? entry.content : preview}
                      {!isExpanded && hasMore && "..."}
                    </pre>
                  </div>
                )}

                {!isExpanded && (
                  <div className="px-4 pb-2 pl-12">
                    <p className="text-[11px] text-muted-foreground/60 truncate">
                      {preview}
                      {hasMore && "..."}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
