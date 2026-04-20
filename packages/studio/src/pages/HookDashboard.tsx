/**
 * P1-8: 伏笔健康仪表盘
 * 展示伏笔生命周期、健康度、过期/陈旧/可回收状态
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Anchor, CheckCircle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { fetchJson, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Nav {
  toWorkflow?: () => void;
}

interface HookEntry {
  readonly hookId: string;
  readonly description?: string;
  readonly status: string;
  readonly startChapter: number;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff?: string;
  readonly payoffTiming?: string;
  readonly notes?: string;
  readonly priority?: string;
}

interface BookInfo {
  readonly id: string;
  readonly title: string;
  readonly chaptersWritten: number;
}

export function HookDashboard({ nav, theme }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: booksData, refetch: refetchBooks } = useApi<{ books: BookInfo[] }>("/books");
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const books = booksData?.books ?? [];

  // 自动选择第一本书
  useEffect(() => {
    if (!selectedBook && books.length > 0) setSelectedBook(books[0]!.id);
  }, [books, selectedBook]);

  const loadHooks = useCallback(async (bookId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ file: string; content: string | null }>(`/books/${bookId}/truth/pending_hooks.md`);
      if (!data.content) {
        setHooks([]);
        return;
      }
      setHooks(parseHooksFromMarkdown(data.content));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedBook) return;
    void loadHooks(selectedBook);
  }, [loadHooks, selectedBook]);

  const currentBook = books.find((b) => b.id === selectedBook);
  const currentChapter = currentBook?.chaptersWritten ?? 0;

  const active = hooks.filter((h) => h.status !== "resolved");
  const resolved = hooks.filter((h) => h.status === "resolved");
  const stale = active.filter((h) => currentChapter - h.lastAdvancedChapter >= 10);
  const overdue = active.filter((h) => {
    if (!h.payoffTiming) return false;
    const match = h.payoffTiming.match(/(\d+)/);
    return match ? currentChapter > Number(match[1]) : false;
  });

  const handleRefresh = () => {
    void refetchBooks();
    if (selectedBook) {
      void loadHooks(selectedBook);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="伏笔健康仪表盘"
        description="在工作流配置台查看伏笔生命周期、健康度、陈旧度和回收率。"
        actions={
          <>
            {nav.toWorkflow && (
              <button onClick={() => nav.toWorkflow?.()} className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70">
                工作流总览
              </button>
            )}
            <button onClick={handleRefresh} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RefreshCw size={12} />刷新
            </button>
            {books.length > 1 && (
              <select value={selectedBook ?? ""} onChange={(e) => setSelectedBook(e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm`}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      {error && <div className="text-sm text-destructive">{error}</div>}
      {loading && <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>}

      {!loading && books.length === 0 && (
        <PageEmptyState
          title="还没有书籍"
          description="先在书籍管理中创建或导入一本书，伏笔健康会在这里自动汇总。"
        />
      )}

      {!loading && selectedBook && books.length > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard c={c} label="活跃伏笔" value={active.length} color="text-foreground" />
            <StatCard c={c} label="已回收" value={resolved.length} color="text-emerald-500" />
            <StatCard c={c} label="陈旧 (≥10章)" value={stale.length} color="text-amber-500" />
            <StatCard c={c} label="已逾期" value={overdue.length} color="text-red-500" />
          </div>

          {hooks.length > 0 ? (
            <div className={`rounded-lg border ${c.cardStatic} px-4 py-3`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">回收率</span>
                <span className="text-sm font-mono">{Math.round((resolved.length / hooks.length) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(resolved.length / hooks.length) * 100}%` }} />
              </div>
            </div>
          ) : null}

          {active.length === 0 && resolved.length === 0 ? (
            <PageEmptyState title="暂无伏笔数据" description="完成章节写作后，伏笔记录会在这里按章节推进展示。" />
          ) : (
            <div className="space-y-6">
              {active.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">活跃伏笔</h2>
                  <div className="space-y-2">
                    {active.map((hook) => (
                      <HookCard
                        key={hook.hookId}
                        hook={hook}
                        currentChapter={currentChapter}
                        expanded={expanded === hook.hookId}
                        onToggle={() => setExpanded(expanded === hook.hookId ? null : hook.hookId)}
                        c={c}
                      />
                    ))}
                  </div>
                </section>
              )}

              {resolved.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">已回收</h2>
                  <div className="space-y-2">
                    {resolved.slice(0, 10).map((hook) => (
                      <HookCard
                        key={hook.hookId}
                        hook={hook}
                        currentChapter={currentChapter}
                        expanded={expanded === hook.hookId}
                        onToggle={() => setExpanded(expanded === hook.hookId ? null : hook.hookId)}
                        c={c}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Workflow Workbench</p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function HookCard({ hook, currentChapter, expanded, onToggle, c }: {
  hook: HookEntry; currentChapter: number; expanded: boolean;
  onToggle: () => void; c: ReturnType<typeof useColors>;
}) {
  const age = currentChapter - hook.startChapter;
  const sinceAdvance = currentChapter - hook.lastAdvancedChapter;
  const isStale = sinceAdvance >= 10;
  const isResolved = hook.status === "resolved";

  return (
    <div className={`rounded-lg border ${c.cardStatic}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {isResolved ? <CheckCircle size={14} className="text-emerald-500" /> : isStale ? <AlertTriangle size={14} className="text-amber-500" /> : <Anchor size={14} className="text-primary" />}
          <span className="text-sm font-medium">{hook.hookId}</span>
          {hook.description && <span className="max-w-[300px] truncate text-xs text-muted-foreground">{hook.description}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${isResolved ? "bg-emerald-500/10 text-emerald-500" : isStale ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary"}`}>
            {isResolved ? "已回收" : isStale ? `陈旧 ${sinceAdvance}章` : `活跃 ${age}章`}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="grid grid-cols-2 gap-3 border-t border-border/40 px-4 py-3 text-sm">
          <div><span className="text-muted-foreground">起始章: </span><span className="font-mono">{hook.startChapter}</span></div>
          <div><span className="text-muted-foreground">最后推进: </span><span className="font-mono">第{hook.lastAdvancedChapter}章</span></div>
          {hook.payoffTiming && <div><span className="text-muted-foreground">预期回收: </span><span>{hook.payoffTiming}</span></div>}
          {hook.expectedPayoff && <div><span className="text-muted-foreground">回收方式: </span><span>{hook.expectedPayoff}</span></div>}
          {hook.priority && <div><span className="text-muted-foreground">优先级: </span><span>{hook.priority}</span></div>}
          {hook.notes && <div className="col-span-2"><span className="text-muted-foreground">备注: </span><span>{hook.notes}</span></div>}
        </div>
      )}
    </div>
  );
}

function StatCard({ c, label, value, color }: { c: ReturnType<typeof useColors>; label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg border ${c.cardStatic} px-4 py-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/** 从 pending_hooks.md 的 markdown 表格中解析伏笔记录 */
function parseHooksFromMarkdown(content: string): HookEntry[] {
  const hooks: HookEntry[] = [];
  const lines = content.split("\n");
  let inTable = false;
  let headers: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }

    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.every((c) => /^[-:]+$/.test(c))) {
      inTable = true;
      continue;
    }

    if (!inTable) {
      headers = cells.map((c) => c.toLowerCase());
      continue;
    }

    if (headers.length === 0 || cells.length < 3) continue;

    const get = (key: string) => {
      const idx = headers.findIndex((h) => h.includes(key));
      return idx >= 0 && idx < cells.length ? cells[idx] : undefined;
    };

    hooks.push({
      hookId: get("id") ?? get("hook") ?? cells[0] ?? `hook-${hooks.length}`,
      description: get("desc") ?? get("描述") ?? get("description"),
      status: get("status") ?? get("状态") ?? "active",
      startChapter: parseInt(get("start") ?? get("起始") ?? "0", 10) || 0,
      lastAdvancedChapter: parseInt(get("advance") ?? get("推进") ?? get("last") ?? "0", 10) || 0,
      expectedPayoff: get("payoff") ?? get("回收"),
      payoffTiming: get("timing") ?? get("时机"),
      notes: get("note") ?? get("备注"),
      priority: get("priority") ?? get("优先"),
    });
  }

  return hooks;
}
