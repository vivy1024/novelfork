/**
 * P1-8: 伏笔健康仪表盘
 * 展示伏笔生命周期、健康度、过期/陈旧/可回收状态
 */
import { useState, useEffect } from "react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Anchor, AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronRight } from "lucide-react";

interface Nav {
  toDashboard: () => void;
  toBook: (bookId: string) => void;
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

export function HookDashboard({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: booksData } = useApi<{ books: BookInfo[] }>("/books");
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

  // 加载伏笔数据（从 pending_hooks.md 解析）
  useEffect(() => {
    if (!selectedBook) return;
    setLoading(true);
    setError(null);
    fetchJson<{ file: string; content: string | null }>(`/books/${selectedBook}/truth/pending_hooks.md`)
      .then((data) => {
        if (!data.content) { setHooks([]); return; }
        setHooks(parseHooksFromMarkdown(data.content));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [selectedBook]);

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

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <span className="text-foreground">伏笔健康</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">伏笔健康仪表盘</h1>
        {books.length > 1 && (
          <select value={selectedBook ?? ""} onChange={(e) => setSelectedBook(e.target.value)}
            className={`${c.input} rounded px-2 py-1 text-sm`}>
            {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        )}
      </div>

      {error && <div className="text-destructive text-sm">{error}</div>}
      {loading && <div className="text-muted-foreground text-sm py-8 text-center">加载中...</div>}

      {!loading && selectedBook && (
        <>
          {/* 概览卡片 */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard c={c} label="活跃伏笔" value={active.length} color="text-foreground" />
            <StatCard c={c} label="已回收" value={resolved.length} color="text-emerald-500" />
            <StatCard c={c} label="陈旧 (≥10章)" value={stale.length} color="text-amber-500" />
            <StatCard c={c} label="已逾期" value={overdue.length} color="text-red-500" />
          </div>

          {/* 回收率 */}
          {hooks.length > 0 && (
            <div className={`border ${c.cardStatic} rounded-lg px-4 py-3`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">回收率</span>
                <span className="text-sm font-mono">{hooks.length > 0 ? Math.round((resolved.length / hooks.length) * 100) : 0}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${hooks.length > 0 ? (resolved.length / hooks.length) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {/* 伏笔列表 */}
          {active.length === 0 && resolved.length === 0 && (
            <div className="text-muted-foreground text-sm py-8 text-center">暂无伏笔数据</div>
          )}

          {active.length > 0 && (
            <div>
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground font-medium mb-3">活跃伏笔</h2>
              <div className="space-y-2">
                {active.map((hook) => (
                  <HookCard key={hook.hookId} hook={hook} currentChapter={currentChapter}
                    expanded={expanded === hook.hookId} onToggle={() => setExpanded(expanded === hook.hookId ? null : hook.hookId)} c={c} />
                ))}
              </div>
            </div>
          )}

          {resolved.length > 0 && (
            <div>
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground font-medium mb-3">已回收</h2>
              <div className="space-y-2">
                {resolved.slice(0, 10).map((hook) => (
                  <HookCard key={hook.hookId} hook={hook} currentChapter={currentChapter}
                    expanded={expanded === hook.hookId} onToggle={() => setExpanded(expanded === hook.hookId ? null : hook.hookId)} c={c} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
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
    <div className={`border ${c.cardStatic} rounded-lg`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {isResolved ? <CheckCircle size={14} className="text-emerald-500" /> :
           isStale ? <AlertTriangle size={14} className="text-amber-500" /> :
           <Anchor size={14} className="text-primary" />}
          <span className="text-sm font-medium">{hook.hookId}</span>
          {hook.description && <span className="text-xs text-muted-foreground truncate max-w-[300px]">{hook.description}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${isResolved ? "bg-emerald-500/10 text-emerald-500" : isStale ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary"}`}>
            {isResolved ? "已回收" : isStale ? `陈旧 ${sinceAdvance}章` : `活跃 ${age}章`}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 grid grid-cols-2 gap-3 text-sm">
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
    <div className={`border ${c.cardStatic} rounded-lg px-4 py-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-serif mt-1 ${color}`}>{value}</div>
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
    if (!trimmed.startsWith("|")) { inTable = false; continue; }

    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.every((c) => /^[-:]+$/.test(c))) { inTable = true; continue; }

    if (!inTable) { headers = cells.map((c) => c.toLowerCase()); continue; }

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