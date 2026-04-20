/**
 * ContextPanel — Collapsible right sidebar showing context entries
 * injected into AI prompts, with token budget visualization.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers3,
  MessagesSquare,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { Switch } from "./ui/switch";
import { fetchJson } from "../hooks/use-api";
import { AutoCompressToggle } from "./AutoCompressToggle";

export type ContextLayer = "system" | "session" | "tool" | "project" | "memory" | "other";

export interface ContextEntry {
  readonly id?: string;
  readonly source: string;
  readonly label: string;
  readonly content: string;
  readonly tokens: number;
  readonly active: boolean;
  readonly layer?: ContextLayer;
  readonly description?: string;
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
  const [expandedEntries, setExpandedEntries] = useState<ReadonlySet<string>>(new Set());
  const [disabledEntries, setDisabledEntries] = useState<ReadonlySet<string>>(new Set());

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

  useEffect(() => {
    const validKeys = new Set(entries.map((entry, index) => getContextEntryKey(entry, index)));

    setExpandedEntries((prev) => new Set([...prev].filter((key) => validKeys.has(key))));
    setDisabledEntries((prev) => new Set([...prev].filter((key) => validKeys.has(key))));
  }, [entries]);

  const toggleExpanded = (entryKey: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryKey)) {
        next.delete(entryKey);
      } else {
        next.add(entryKey);
      }
      return next;
    });
  };

  const toggleDisabled = (entryKey: string) => {
    setDisabledEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryKey)) {
        next.delete(entryKey);
      } else {
        next.add(entryKey);
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

  const entryRecords = useMemo(
    () =>
      entries.map((entry, index) => {
        const key = getContextEntryKey(entry, index);
        const layer = normalizeContextLayer(entry.layer, entry.source);
        return {
          entry,
          key,
          layer,
        };
      }),
    [entries],
  );

  const activeTokens = useMemo(
    () =>
      entryRecords.reduce(
        (sum, record) => (disabledEntries.has(record.key) ? sum : sum + record.entry.tokens),
        0,
      ),
    [entryRecords, disabledEntries],
  );

  const groupedEntries = useMemo(() => groupEntriesByLayer(entryRecords, disabledEntries), [entryRecords, disabledEntries]);
  const layerSummaries = useMemo(() => buildLayerSummaries(entryRecords, disabledEntries), [entryRecords, disabledEntries]);

  const ratio = budgetMax > 0 ? activeTokens / budgetMax : 0;
  const sessionMessageCount = sessionSummary?.messageCount ?? entries.length;

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 z-50 flex h-full w-[360px] flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200" data-testid="context-panel">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center justify-between">
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
            className="rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-3 border-b border-border/30 px-4 py-3">
        <div className="grid grid-cols-4 gap-2">
          <SummaryTile label={sessionMode ? "消息" : "条目"} value={String(sessionMode ? sessionMessageCount : entries.length)} />
          <SummaryTile label="启用" value={String(entryRecords.length - disabledEntries.size)} />
          <SummaryTile label="屏蔽" value={String(disabledEntries.size)} />
          <SummaryTile label="余量" value={String(Math.max(budgetMax - activeTokens, 0))} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={`text-xs font-bold ${budgetTextColor(ratio)}`}>
              已用 {activeTokens.toLocaleString()}/{budgetMax.toLocaleString()} tokens
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              原始 {totalTokens.toLocaleString()} · {Math.round(ratio * 100)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full transition-all duration-300 ${budgetColor(ratio)}`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>
        </div>
        {layerSummaries.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Layers3 size={13} />
              来源分层
            </div>
            <div className="flex flex-wrap gap-1.5">
              {layerSummaries.map((layer) => (
                <span
                  key={layer.layer}
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-1 text-[10px] text-muted-foreground"
                >
                  <span className="font-medium text-foreground">{layer.label}</span>
                  <span>{layer.activeCount}/{layer.count}</span>
                  <span>·</span>
                  <span>{layer.activeTokens.toLocaleString()} tok</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2">
        <button
          onClick={() => void handleCompress()}
          disabled={ratio < 0.8}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-xs transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
          title="压缩上下文"
          data-testid="compress-context-btn"
        >
          <Archive size={14} />
          压缩
        </button>
        <button
          onClick={() => void handleTruncate()}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-xs transition-colors hover:bg-secondary/80"
          title="裁剪上下文"
        >
          <Scissors size={14} />
          裁剪
        </button>
        <button
          onClick={() => void handleClear()}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
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
          <div className="flex flex-col items-center justify-center space-y-3 py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            <span className="text-xs text-muted-foreground">加载上下文...</span>
          </div>
        )}

        {error && (
          <div className="m-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
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
          !error &&
          groupedEntries.map((group) => (
            <section key={group.layer} className="border-b border-border/30">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/20 bg-background/95 px-4 py-2 backdrop-blur">
                <div className="text-[11px] font-medium text-foreground">{group.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {group.activeCount}/{group.count} · {group.activeTokens.toLocaleString()} tok
                </div>
              </div>

              {group.entries.map(({ entry, key }) => {
                const isExpanded = expandedEntries.has(key);
                const isDisabled = disabledEntries.has(key);
                const preview = entry.description?.trim() || entry.content.slice(0, 100);
                const hasMore = entry.content.length > 100;

                return (
                  <div key={key} className={`border-b border-border/20 transition-colors last:border-b-0 ${isDisabled ? "opacity-40" : ""}`}>
                    <div className="flex items-center gap-2 px-4 py-3">
                      <Switch checked={!isDisabled} onCheckedChange={() => toggleDisabled(key)} />

                      <button onClick={() => toggleExpanded(key)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                        {isExpanded ? (
                          <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                              {getLayerLabel(group.layer)}
                            </span>
                            <span className="inline-flex items-center rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {entry.source}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.label}</span>
                          </div>
                          {entry.description?.trim() ? (
                            <p className="text-[11px] leading-5 text-muted-foreground">{entry.description}</p>
                          ) : null}
                        </div>
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
                        <pre className="max-h-[220px] overflow-y-auto rounded-lg bg-secondary/30 p-3 font-sans text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                          {entry.content}
                        </pre>
                      </div>
                    )}

                    {!isExpanded && (
                      <div className="px-4 pb-2 pl-12">
                        <p className="truncate text-[11px] text-muted-foreground/70">
                          {preview}
                          {hasMore && "..."}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
      </div>
    </div>
  );
}

function groupEntriesByLayer(
  entryRecords: ReadonlyArray<{ entry: ContextEntry; key: string; layer: ContextLayer }>,
  disabledEntries: ReadonlySet<string>,
) {
  const groups = new Map<ContextLayer, Array<{ entry: ContextEntry; key: string }>>();

  for (const record of entryRecords) {
    const bucket = groups.get(record.layer) ?? [];
    bucket.push({ entry: record.entry, key: record.key });
    groups.set(record.layer, bucket);
  }

  return CONTEXT_LAYER_ORDER.flatMap((layer) => {
    const bucket = groups.get(layer);
    if (!bucket || bucket.length === 0) {
      return [];
    }

    const activeBucket = bucket.filter((item) => !disabledEntries.has(item.key));

    return [
      {
        layer,
        label: getLayerLabel(layer),
        count: bucket.length,
        entries: bucket,
        activeCount: activeBucket.length,
        activeTokens: activeBucket.reduce((sum, item) => sum + item.entry.tokens, 0),
      },
    ];
  });
}

function buildLayerSummaries(
  entryRecords: ReadonlyArray<{ entry: ContextEntry; key: string; layer: ContextLayer }>,
  disabledEntries: ReadonlySet<string>,
) {
  return CONTEXT_LAYER_ORDER.flatMap((layer) => {
    const items = entryRecords.filter((record) => record.layer === layer);
    if (items.length === 0) {
      return [];
    }

    const activeItems = items.filter((record) => !disabledEntries.has(record.key));

    return [
      {
        layer,
        label: getLayerLabel(layer),
        count: items.length,
        activeCount: activeItems.length,
        activeTokens: activeItems.reduce((sum, item) => sum + item.entry.tokens, 0),
      },
    ];
  });
}

function normalizeContextLayer(layer: ContextEntry["layer"], source: string): ContextLayer {
  if (layer) {
    return layer;
  }

  const normalizedSource = source.trim().toLowerCase();
  if (normalizedSource === "system") return "system";
  if (normalizedSource === "assistant" || normalizedSource === "user") return "session";
  if (["bash", "read", "write", "edit", "grep", "glob", "webfetch"].includes(normalizedSource)) return "tool";
  return "other";
}

function getContextEntryKey(entry: ContextEntry, index: number) {
  return entry.id ?? `${entry.layer ?? "other"}:${entry.source}:${entry.label}:${index}`;
}

function getLayerLabel(layer: ContextLayer) {
  switch (layer) {
    case "system":
      return "系统";
    case "session":
      return "会话";
    case "tool":
      return "工具结果";
    case "project":
      return "项目";
    case "memory":
      return "记忆";
    default:
      return "其他";
  }
}

const CONTEXT_LAYER_ORDER: ContextLayer[] = ["system", "session", "tool", "project", "memory", "other"];
