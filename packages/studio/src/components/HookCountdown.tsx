/**
 * HookCountdown — Tab 2: 伏笔倒计时
 * 显示伏笔列表，倒计时 UI，过期伏笔警告
 */

import { useState, useMemo } from "react";
import { Anchor, AlertTriangle, Clock, CheckCircle } from "lucide-react";
import { useApi } from "../hooks/use-api";

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

interface HookCountdownProps {
  readonly bookId: string;
}

export function HookCountdown({ bookId }: HookCountdownProps) {
  const [sortBy, setSortBy] = useState<"urgency" | "age" | "priority">("urgency");

  // 获取书籍信息（当前章节数）
  const { data: bookData } = useApi<{ id: string; title: string; chaptersWritten: number }>(
    `/books/${bookId}`
  );

  // 获取伏笔数据
  const { data: hooksData, loading, error } = useApi<{ file: string; content: string | null }>(
    `/books/${bookId}/truth/pending_hooks.md`
  );

  const currentChapter = bookData?.chaptersWritten ?? 0;
  const hooks = useMemo(() => {
    if (!hooksData?.content) return [];
    return parseHooksFromMarkdown(hooksData.content);
  }, [hooksData]);

  // 计算倒计时和状态
  const enrichedHooks = useMemo(() => {
    return hooks.map(hook => {
      const age = currentChapter - hook.startChapter;
      const sinceAdvance = currentChapter - hook.lastAdvancedChapter;
      const isStale = sinceAdvance >= 10;
      const isResolved = hook.status === "resolved";

      let countdown: number | null = null;
      let isOverdue = false;

      if (hook.payoffTiming) {
        const match = hook.payoffTiming.match(/(\d+)/);
        if (match) {
          const targetChapter = Number(match[1]);
          countdown = targetChapter - currentChapter;
          isOverdue = countdown < 0;
        }
      }

      return {
        ...hook,
        age,
        sinceAdvance,
        isStale,
        isResolved,
        countdown,
        isOverdue,
        urgency: isOverdue ? 1000 : (isStale ? 100 : (countdown !== null ? -countdown : -age))
      };
    });
  }, [hooks, currentChapter]);

  // 排序
  const sortedHooks = useMemo(() => {
    const active = enrichedHooks.filter(h => !h.isResolved);
    const resolved = enrichedHooks.filter(h => h.isResolved);

    const sorted = [...active].sort((a, b) => {
      if (sortBy === "urgency") return b.urgency - a.urgency;
      if (sortBy === "age") return b.age - a.age;
      if (sortBy === "priority") {
        const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
        const aP = priorityOrder[a.priority?.toLowerCase() ?? ""] ?? 0;
        const bP = priorityOrder[b.priority?.toLowerCase() ?? ""] ?? 0;
        return bP - aP;
      }
      return 0;
    });

    return { active: sorted, resolved };
  }, [enrichedHooks, sortBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-muted-foreground">加载伏笔数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-destructive">加载失败: {String(error)}</div>
      </div>
    );
  }

  if (hooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
        <Anchor size={32} className="mb-2 opacity-40" />
        <div className="text-xs">暂无伏笔数据</div>
        <div className="text-[10px] mt-1">在 pending_hooks.md 中添加伏笔记录</div>
      </div>
    );
  }

  const overdueCount = sortedHooks.active.filter(h => h.isOverdue).length;
  const staleCount = sortedHooks.active.filter(h => h.isStale).length;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部统计 */}
      <div className="shrink-0 px-4 py-3 border-b border-border/30 bg-background/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">
              当前章节: <span className="font-mono text-foreground">{currentChapter}</span>
            </span>
            <span className="text-muted-foreground">
              活跃伏笔: <span className="font-medium text-foreground">{sortedHooks.active.length}</span>
            </span>
            {overdueCount > 0 && (
              <span className="text-red-500 font-medium">
                ⚠️ {overdueCount} 个已逾期
              </span>
            )}
            {staleCount > 0 && (
              <span className="text-amber-500">
                {staleCount} 个陈旧
              </span>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="text-xs px-2 py-1 rounded border border-border bg-background"
          >
            <option value="urgency">按紧急度</option>
            <option value="age">按年龄</option>
            <option value="priority">按优先级</option>
          </select>
        </div>
      </div>

      {/* 伏笔列表 */}
      <div className="flex-1 overflow-y-auto">
        {sortedHooks.active.map((hook) => (
          <HookCountdownCard key={hook.hookId} hook={hook} currentChapter={currentChapter} />
        ))}

        {sortedHooks.resolved.length > 0 && (
          <div className="border-t-2 border-border/50 mt-2">
            <div className="px-4 py-2 text-[10px] font-medium text-muted-foreground bg-secondary/30">
              已回收 ({sortedHooks.resolved.length})
            </div>
            {sortedHooks.resolved.slice(0, 5).map((hook) => (
              <HookCountdownCard key={hook.hookId} hook={hook} currentChapter={currentChapter} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HookCountdownCard({ hook, currentChapter }: {
  hook: ReturnType<typeof parseHooksFromMarkdown>[0] & {
    age: number;
    sinceAdvance: number;
    isStale: boolean;
    isResolved: boolean;
    countdown: number | null;
    isOverdue: boolean;
  };
  currentChapter: number;
}) {
  const getStatusColor = () => {
    if (hook.isResolved) return "border-l-emerald-500 bg-emerald-500/5";
    if (hook.isOverdue) return "border-l-red-500 bg-red-500/5";
    if (hook.isStale) return "border-l-amber-500 bg-amber-500/5";
    return "border-l-primary bg-background";
  };

  const getIcon = () => {
    if (hook.isResolved) return <CheckCircle size={14} className="text-emerald-500" />;
    if (hook.isOverdue) return <AlertTriangle size={14} className="text-red-500" />;
    if (hook.isStale) return <Clock size={14} className="text-amber-500" />;
    return <Anchor size={14} className="text-primary" />;
  };

  return (
    <div className={`border-b border-border/20 border-l-4 ${getStatusColor()} px-4 py-3 hover:bg-secondary/30 transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        {/* 左侧信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {getIcon()}
            <span className="text-sm font-medium text-foreground">{hook.hookId}</span>
            {hook.priority && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                hook.priority.toLowerCase() === "high" ? "bg-red-500/10 text-red-500" :
                hook.priority.toLowerCase() === "medium" ? "bg-amber-500/10 text-amber-500" :
                "bg-muted text-muted-foreground"
              }`}>
                {hook.priority}
              </span>
            )}
          </div>
          {hook.description && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{hook.description}</p>
          )}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>起始: 第{hook.startChapter}章</span>
            <span>推进: 第{hook.lastAdvancedChapter}章</span>
            <span>年龄: {hook.age}章</span>
            {hook.sinceAdvance > 0 && (
              <span className={hook.isStale ? "text-amber-500 font-medium" : ""}>
                {hook.sinceAdvance}章未推进
              </span>
            )}
          </div>
        </div>

        {/* 右侧倒计时 */}
        <div className="shrink-0 text-right">
          {hook.isResolved ? (
            <div className="text-xs text-emerald-500 font-medium">✓ 已回收</div>
          ) : hook.countdown !== null ? (
            <div className="flex flex-col items-end">
              <div className={`text-2xl font-mono font-bold ${
                hook.isOverdue ? "text-red-500" :
                hook.countdown <= 3 ? "text-amber-500" :
                "text-foreground"
              }`}>
                {hook.isOverdue ? `+${Math.abs(hook.countdown)}` : hook.countdown}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {hook.isOverdue ? "章已逾期" : "章后回收"}
              </div>
              {hook.payoffTiming && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  目标: {hook.payoffTiming}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">无时间线</div>
          )}
        </div>
      </div>
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
