/**
 * ContextPanel — Collapsible right sidebar showing context entries
 * injected into AI prompts, with token budget visualization.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { X, ChevronDown, ChevronRight, FileText, Trash2, Scissors, Archive, MessagesSquare } from "lucide-react";
import { Switch } from "./ui/switch";
import { fetchJson } from "../hooks/use-api";
import { AutoCompressToggle } from "./AutoCompressToggle";

export type ContextEntryLayer = "book" | "session" | "system" | "tool";

export interface ContextEntry {
  readonly id?: string;
  readonly source: string;
  readonly label: string;
  readonly description?: string;
  readonly layer?: ContextEntryLayer;
  readonly content: string;
  readonly tokens: number;
  readonly active: boolean;
}

interface ContextAssemblyResponse {
  readonly entries: ReadonlyArray<ContextEntry>;
  readonly totalTokens: number;
  readonly budgetMax: number;
}

interface SessionContextSummary {
  readonly totalTokens: number;
  readonly budgetMax: number;
  readonly messageCount: number;
}

interface ContextPanelProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly mode?: "book" | "session";
  readonly bookId?: string;
  readonly chapterNumber?: number;
  readonly sessionTitle?: string;
  readonly sessionEntries?: ReadonlyArray<ContextEntry>;
  readonly sessionSummary?: SessionContextSummary;
  readonly onCompress?: () => void;
  readonly onTruncate?: () => void;
  readonly onClear?: () => void;
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

function SummaryTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-medium text-foreground">{value}</div>
    </div>
  );
}

const CONTEXT_LAYER_LABELS: Record<ContextEntryLayer, string> = {
  book: "书籍层",
  session: "会话层",
  system: "系统层",
  tool: "工具层",
};

export function ContextPanel({
  visible,
  onClose,
  mode = "book",
  bookId,
  chapterNumber,
  sessionTitle,
  sessionEntries,
  sessionSummary,
  onCompress,
  onTruncate,
  onClear,
}: ContextPanelProps) {
  const [entries, setEntries] = useState<ReadonlyArray<ContextEntry>>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [budgetMax, setBudgetMax] = useState(8000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<ReadonlySet<string>>(new Set());
  const [disabledSources, setDisabledSources] = useState<ReadonlySet<string>>(new Set());

  const sessionMode = mode === "session";

  const fetchContext = useCallback(async () => {
    if (sessionMode || !bookId || typeof chapterNumber !== "number") return;

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
  }, [sessionMode, bookId, chapterNumber]);

  useEffect(() => {
    if (!visible) return;

    if (sessionMode) {
      setEntries(sessionEntries ?? []);
      setTotalTokens(sessionSummary?.totalTokens ?? 0);
      setBudgetMax(sessionSummary?.budgetMax ?? 8000);
      setError(null);
      setLoading(false);
      return;
    }

    void fetchContext();
  }, [visible, sessionMode, sessionEntries, sessionSummary, fetchContext]);

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

  const handleCompress = async () => {
    if (sessionMode) {
      onCompress?.();
      return;
    }

    if (!bookId) return;

    try {
      await fetchJson(`/api/context/${bookId}/compress`, { method: "POST" });
      await fetchContext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTruncate = async () => {
    if (sessionMode) {
      onTruncate?.();
      return;
    }

    if (!bookId) return;

    try {
      await fetchJson(`/api/context/${bookId}/truncate`, { method: "POST" });
      await fetchContext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClear = async () => {
    if (!confirm("确定要清空所有上下文吗？此操作不可恢复。")) return;

    if (sessionMode) {
      onClear?.();
      return;
    }

    if (!bookId) return;

    try {
      await fetchJson(`/api/context/${bookId}/clear`, { method: "POST" });
      await fetchContext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const activeTokens = useMemo(
    () =>
      entries.reduce(
        (sum, entry) => (disabledSources.has(entry.source) ? sum : sum + entry.tokens),
        0,
      ),
    [entries, disabledSources],
  );

  const ratio = budgetMax > 0 ? activeTokens / budgetMax : 0;
  const sessionMessageCount = sessionSummary?.messageCount ?? entries.length;

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[360px] flex flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200" data-testid="context-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div>
          <h2 className="text-sm font-bold text-foreground">上下文面板</h2>
          {sessionMode ? (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessagesSquare size={12} />
              最近会话消息 · {sessionTitle ?? "当前会话"}
            </p>
          ) : (
            <p className="mt-0.5 text-[10px] text-muted-foreground">第 {chapterNumber} 章 · 当前书籍 {bookId}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 border-b border-border/30 px-4 py-3">
        <div className="grid grid-cols-4 gap-2">
          <SummaryTile label={sessionMode ? "消息" : "条目"} value={String(sessionMode ? sessionMessageCount : entries.length)} />
          <SummaryTile label="启用" value={String(entries.length - disabledSources.size)} />
          <SummaryTile label="屏蔽" value={String(disabledSources.size)} />
          <SummaryTile label="余量" value={String(Math.max(budgetMax - activeTokens, 0))} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={`text-xs font-bold ${budgetTextColor(ratio)}`}>
              已用 {activeTokens.toLocaleString()}/{budgetMax.toLocaleString()} tokens
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">
              {Math.round(ratio * 100)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full transition-all duration-300 ${budgetColor(ratio)}`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30">
        <button
          onClick={() => void handleCompress()}
          disabled={ratio < 0.8}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-secondary hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="压缩上下文"
          data-testid="compress-context-btn"
        >
          <Archive size={14} />
          压缩
        </button>
        <button
          onClick={() => void handleTruncate()}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
          title="裁剪上下文"
        >
          <Scissors size={14} />
          裁剪
        </button>
        <button
          onClick={() => void handleClear()}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          title="清空上下文"
          data-testid="clear-context-btn"
        >
          <Trash2 size={14} />
          清空
        </button>
      </div>

      {!sessionMode && bookId ? <AutoCompressToggle bookId={bookId} onCompress={handleCompress} /> : null}

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
            const key = entry.id ?? entry.source;
            const isExpanded = expandedSources.has(key);
            const isDisabled = disabledSources.has(entry.source);
            const preview = entry.content.slice(0, 100);
            const hasMore = entry.content.length > 100;

            return (
              <div
                key={key}
                className={`border-b border-border/30 transition-colors ${isDisabled ? "opacity-40" : ""}`}
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <Switch
                    checked={!isDisabled}
                    onCheckedChange={() => toggleDisabled(entry.source)}
                  />

                  <button
                    onClick={() => toggleExpanded(key)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                    )}

                    <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary shrink-0">
                      {entry.source}
                    </span>

                    {entry.layer ? (
                      <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                        {CONTEXT_LAYER_LABELS[entry.layer]}
                      </span>
                    ) : null}

                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.label}</span>
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isDisabled ? "bg-secondary text-muted-foreground" : "bg-emerald-500/10 text-emerald-600"}`}>
                      {isDisabled ? "已屏蔽" : "启用"}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {entry.tokens}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-3 pl-12">
                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed bg-secondary/30 rounded-lg p-3 max-h-[200px] overflow-y-auto">
                      {entry.content}
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
