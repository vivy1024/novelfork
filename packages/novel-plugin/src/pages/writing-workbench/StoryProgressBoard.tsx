/**
 * 故事推进 · 章节网格（主视觉）
 *
 * 范式来自 Plottr：列 = 章，行 = 剧情线，格子 = 该线在该章的节拍。
 * 独立大画板：列加宽、格加高，格子里放标题 + 摘要。
 * 细节仍可 hover 看全文；点格子打开条目或跳章。
 *
 * 三块结构：
 *  ① 顶部张力曲线（TensionCurveStrip）
 *  ② 中部章节网格，含「下一章」焦点列（高亮抬起）
 *  ③ 底部伏笔债务行（悬置越久越红）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronsDown,
  CircleDot,
  Columns3,
  Flag,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import { TensionCurveStrip } from "./TensionCurveStrip";
import {
  LANE_KIND_LABEL,
  STALLED_LANE_GAP,
  buildStoryProgressBoard,
  cellsForChapter,
  hasProgressContent,
  type ForeshadowDebt,
  type ProgressJingweiEntry,
  type ProgressMemoryEvent,
  // 组件名 StoryProgressBoard 已被本文件占用，故数据层模型在此以 BoardModel 出现。
  type StoryProgressBoardModel as BoardModel,
  type StoryProgressCell,
  type StoryProgressLane,
} from "./story-progress-board";
import type { NarrativeStructurePayload } from "../../engine/narrative-taxonomy/narrative-structure";
import {
  DEFAULT_FORESHADOW_DEBT_THRESHOLDS,
  resolveForeshadowDebtThresholds,
  type ForeshadowDebtThresholds,
} from "../../engine/narrative-taxonomy/foreshadow-debts";
import { useWritingProgressRefresh } from "./use-writing-progress-refresh";

export interface StoryProgressBoardProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  /** 打开某章（跳转写作面板）。 */
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 打开经纬条目详情（伏笔/冲突条目卡）。 */
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 把「下一章该写什么」交给叙述者。 */
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 在指定章 + 剧情线上加新节拍（悬浮未来格子或点 \"+\" 时触发）。 */
  readonly onAddBeat?: (chapterNumber: number, lane: StoryProgressLane) => void;
  /** 伏笔格子：标记回收 / 排入下一章。 */
  readonly onForeshadowAction?: (entryId: string, action: "mark_paid" | "schedule_next") => void;
  /** 全景 / 嵌套容器时收起焦点卡为单行提示，详情点击展开。 */
  readonly compactHeader?: boolean;
}

interface StructureScoreItem {
  readonly featureId: string;
  readonly value: string;
  readonly numericValue: number;
  readonly deviation: number | null;
  readonly chapterNumber: number | null;
}

interface LoadedData {
  readonly chapterSummaries: ProgressJingweiEntry[];
  readonly foreshadowEntries: ProgressJingweiEntry[];
  readonly conflictEntries: ProgressJingweiEntry[];
  readonly events: ProgressMemoryEvent[];
  readonly structureScores: readonly StructureScoreItem[];
  /** 加载失败的链路名，用于降级提示（缺哪条说哪条）。 */
  readonly degraded: readonly string[];
  /** 回退路径下本书的伏笔阈值（快照路径的伏笔已在服务端按本书阈值判定）。 */
  readonly foreshadowThresholds?: ForeshadowDebtThresholds;
  readonly structurePayload?: NarrativeStructurePayload;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: LoadedData };

interface EntriesPayload {
  readonly entries?: ProgressJingweiEntry[];
}

interface GraphPayload {
  readonly events?: ProgressMemoryEvent[];
}

const DEBT_TONE: Record<ForeshadowDebt["urgency"], string> = {
  overdue: "border-rose-500/50 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
  watch: "border-amber-500/50 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  ok: "border-border/70 bg-muted/40 text-muted-foreground",
};

const DEBT_LABEL: Record<ForeshadowDebt["urgency"], string> = {
  overdue: "超期",
  watch: "临近",
  ok: "正常",
};

function useProgressData(bookId: string): { state: LoadState; reload: () => void } {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!bookId.trim()) {
      setState({ status: "ready", data: { chapterSummaries: [], foreshadowEntries: [], conflictEntries: [], events: [], structureScores: [], degraded: [] } });
      return;
    }
    const generation = ++generationRef.current;
    setState({ status: "loading" });
    const base = `/api/books/${encodeURIComponent(bookId)}`;

    // 每条链独立容错：缺哪条画哪条，不连坐。全挂才进错误态。
    const loadEntries = async (category: string): Promise<{ entries: ProgressJingweiEntry[]; failed: boolean }> => {
      try {
        const payload = await fetchJson<EntriesPayload | ProgressJingweiEntry[]>(
          `${base}/jingwei/entries?category=${encodeURIComponent(category)}&limit=400`,
        );
        return { entries: Array.isArray(payload) ? payload : payload.entries ?? [], failed: false };
      } catch {
        return { entries: [], failed: true };
      }
    };

    void (async () => {
      // 优先路径（任务 4）：单次聚合快照
      try {
        const struct = await fetchJson<NarrativeStructurePayload>(`${base}/narrative-structure`);
        if (generation !== generationRef.current) return;
        if (struct && struct.ok) {
          setState({
            status: "ready",
            data: {
              chapterSummaries: [],
              foreshadowEntries: [],
              conflictEntries: [],
              events: [],
              structureScores: [],
              degraded: [],
              structurePayload: struct,
            },
          });
          return;
        }
      } catch {
        // 回退路径：若单次接口未实现或处于旧版 mock 测试环境，平滑回退到多路并发
      }

      const [summaries, foreshadow, conflicts, graph, structure, foreshadowThresholds] = await Promise.all([
        loadEntries("chapter-summaries"),
        loadEntries("foreshadowing"),
        loadEntries("conflicts"),
        fetchJson<GraphPayload>(`${base}/narrative-memory/graph?view=event_chain&limit=0`)
          .then((payload) => ({ events: payload.events ?? [], failed: false }))
          .catch((cause: unknown) => ({ events: [] as ProgressMemoryEvent[], failed: true, cause })),
        fetchJson<{ scores?: StructureScoreItem[] }>(`${base}/narrative-memory/structure-score`)
          .then((payload) => ({ scores: payload.scores ?? [], failed: false }))
          .catch(() => ({ scores: [] as StructureScoreItem[], failed: true })),
        // 伏笔阈值由作者按书设置（book.json）；读不到时用默认值，不计入降级。
        fetchJson<Record<string, unknown>>(base)
          .then((payload) => {
            const book = payload && typeof payload.book === "object" && payload.book ? payload.book as Record<string, unknown> : payload;
            return resolveForeshadowDebtThresholds(book?.foreshadowDebtThresholds);
          })
          .catch(() => DEFAULT_FORESHADOW_DEBT_THRESHOLDS),
      ]);
      if (generation !== generationRef.current) return;

      const degraded = [
        summaries.failed ? "章节摘要" : null,
        foreshadow.failed ? "伏笔" : null,
        conflicts.failed ? "冲突" : null,
        graph.failed ? "叙事事件" : null,
        structure.failed ? "结构打分" : null,
      ].filter((value): value is string => value !== null);

      if (degraded.length === 4) {
        const cause = "cause" in graph ? graph.cause : undefined;
        setState({
          status: "error",
          message: cause instanceof ApiRequestError
            ? `推进数据读取失败（HTTP ${cause.status ?? "?"}）。`
            : "推进数据全部读取失败，请检查后端服务。",
        });
        return;
      }

      setState({
        status: "ready",
        data: {
          chapterSummaries: summaries.entries,
          foreshadowEntries: foreshadow.entries,
          conflictEntries: conflicts.entries,
          events: graph.events,
          structureScores: structure.scores,
          degraded,
          foreshadowThresholds,
        },
      });
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [bookId, nonce]);

  return { state, reload: useCallback(() => setNonce((value) => value + 1), []) };
}

/** 空态按真实原因分流——不再把「投影为空」错误归因成「需要先拆书」。 */
function EmptyState({
  data,
  onReload,
  onSendToNarrator,
}: {
  data: LoadedData;
  onReload: () => void;
  onSendToNarrator?: (message: string) => Promise<void> | void;
}) {
  const noChapters = data.chapterSummaries.length === 0 && data.events.length === 0;
  const missing = [
    data.foreshadowEntries.length === 0 ? "伏笔" : null,
    data.conflictEntries.length === 0 ? "冲突" : null,
  ].filter((value): value is string => value !== null);

  const title = noChapters ? "还没有章节数据" : `缺少${missing.join(" / ")}线索`;
  const detail = noChapters
    ? "故事推进要读章节摘要和叙事事件。先写第一章，或对已有正文跑一次章后结算 / 拆书。"
    : `已经有 ${data.chapterSummaries.length} 条章摘要，但${missing.join("和")}条目是空的，网格没有线可画。抽取这些线索后才会点亮。`;
  const prompt = noChapters
    ? "故事推进页没有章节摘要和叙事事件。请检查这本书是否跑过章后结算，若有正文但没结算，帮我发起一次结算或拆书。"
    : `故事推进页缺少${missing.join("、")}线索。请从已有正文里抽取${missing.join("、")}，写入经纬对应类目（保持 needs-review 待我确认）。`;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="story-progress-empty">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
        <Columns3 className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="max-w-md text-2xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <div className="flex items-center gap-2">
        {onSendToNarrator ? (
          <Button
            size="xs"
            className="h-7 gap-1 text-xs"
            data-testid="story-progress-empty-action"
            onClick={() => void onSendToNarrator(prompt)}
          >
            <Sparkles className="size-3" />
            交给叙述者处理
          </Button>
        ) : null}
        <Button size="xs" variant="outline" className="h-7 gap-1 text-xs" onClick={onReload}>
          <RefreshCw className="size-3" />
          刷新
        </Button>
      </div>
    </div>
  );
}

const STRUCTURE_LABEL: Record<string, string> = {
  causal_coverage: "因果覆盖",
  dangling_hook_ratio: "悬置伏笔",
  triggered_unpaid_ratio: "已触发未兑现",
  timeline_advanced: "时间推进",
};

function StructureScoreStrip({
  scores,
  currentChapter,
}: {
  scores: readonly StructureScoreItem[];
  currentChapter: number;
}) {
  const current = scores.filter((row) => row.chapterNumber === currentChapter);
  if (current.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5" data-testid="structure-score-strip">
      <span className="text-2xs font-medium text-muted-foreground">结构打分 · 第{currentChapter}章</span>
      {current.map((row) => {
        const hot = typeof row.deviation === "number" && row.deviation > 0.2;
        return (
          <span
            key={row.featureId}
            className={hot ? "text-2xs text-rose-600 dark:text-rose-300" : "text-2xs text-muted-foreground"}
            title={row.featureId}
          >
            {STRUCTURE_LABEL[row.value] ?? row.value} {row.numericValue.toFixed(2)}
          </span>
        );
      })}
    </div>
  );
}

/** 「下一章」焦点卡：这页的核心，回答「下一章该写什么」。全景模式下默认折叠为小条，不占画布高度。 */
function FocusCard({
  board,
  onOpenChapter,
  onSendToNarrator,
  defaultCollapsed = false,
}: {
  board: BoardModel;
  onOpenChapter?: (chapterNumber: number) => void;
  onSendToNarrator?: (message: string) => Promise<void> | void;
  defaultCollapsed?: boolean;
}) {
  const focus = board.focus;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (!focus) return null;

  const prompt = [
    `准备写第 ${focus.chapterNumber} 章。当前状态：`,
    focus.dueDebts.length > 0
      ? `该回收的伏笔：${focus.dueDebts.map((debt) => `${debt.title}（${debt.reason}）`).join("；")}`
      : "没有到期伏笔。",
    focus.stalledLanes.length > 0
      ? `断档的线：${focus.stalledLanes.map((lane) => `${lane.title}（${lane.chaptersSinceLastBeat} 章未推进）`).join("；")}`
      : "没有明显断档的线。",
    "请据此给出这一章该推进哪条线、收哪笔债，并说明理由。",
  ].join("\n");

  if (collapsed) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border-2 border-primary/40 bg-primary/[0.05] px-3 py-2 text-left transition-colors hover:bg-primary/[0.08]"
        data-testid="story-progress-focus-collapsed"
        onClick={() => setCollapsed(false)}
      >
        <Badge className="h-4 px-1 text-2xs">下一章</Badge>
        <span className="text-xs font-semibold">第 {focus.chapterNumber} 章</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {focus.dueDebts.length > 0 ? `${focus.dueDebts.length} 笔债 · ` : ""}
          {focus.stalledLanes.length > 0 ? `${focus.stalledLanes.length} 条断档` : "各线推进正常"}
        </span>
        <ChevronsDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div
      className="rounded-lg border-2 border-primary/40 bg-primary/[0.04] p-3 shadow-sm"
      data-testid="story-progress-focus"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="h-5 px-1.5 text-2xs">下一章</Badge>
        <span className="text-sm font-semibold">第 {focus.chapterNumber} 章</span>
        <button
          type="button"
          className="ml-1 text-2xs text-muted-foreground hover:text-foreground"
          title="收起"
          aria-label="收起焦点卡"
          data-testid="story-progress-focus-collapse"
          onClick={() => setCollapsed(true)}
        >
          收起
        </button>
        <div className="ml-auto flex items-center gap-1">
          {onOpenChapter ? (
            <Button
              size="xs"
              variant="outline"
              className="h-7 gap-1 text-2xs"
              data-testid="story-progress-focus-open"
              onClick={() => onOpenChapter(focus.chapterNumber)}
            >
              <PenLine className="size-3" />
              去写
            </Button>
          ) : null}
          {onSendToNarrator ? (
            <Button
              size="xs"
              className="h-7 gap-1 text-2xs"
              data-testid="story-progress-focus-plan"
              onClick={() => void onSendToNarrator(prompt)}
            >
              <Sparkles className="size-3" />
              让叙述者规划
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-2xs font-medium text-muted-foreground">该收的债（{focus.dueDebts.length}）</p>
          {focus.dueDebts.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {focus.dueDebts.map((debt) => (
                <li key={debt.id} className="flex items-start gap-1 text-2xs leading-snug">
                  <TriangleAlert className={`mt-0.5 size-3 shrink-0 ${debt.urgency === "overdue" ? "text-rose-500" : "text-amber-500"}`} />
                  <span title={debt.reason}>
                    <span className="font-medium">{debt.title}</span>
                    <span className="text-muted-foreground"> · {debt.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-2xs text-muted-foreground">没有到期伏笔。</p>
          )}
        </div>
        <div>
          <p className="text-2xs font-medium text-muted-foreground">断档的线（{focus.stalledLanes.length}）</p>
          {focus.stalledLanes.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {focus.stalledLanes.map((lane) => (
                <li key={lane.id} className="flex items-center gap-1 text-2xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: lane.color }} />
                  <span className="font-medium">{lane.title}</span>
                  <span className="text-muted-foreground">{lane.chaptersSinceLastBeat} 章未推进</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-2xs text-muted-foreground">所有线都在推进。</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 伏笔债务行：甘特式龄期条，悬置越久越红。 */
function DebtLedger({
  debts,
  onOpenEntityDetail,
}: {
  debts: readonly ForeshadowDebt[];
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pending = useMemo(() => debts.filter((debt) => debt.status !== "paid_off"), [debts]);
  const paidOff = debts.length - pending.length;
  const visible = expanded ? pending : pending.slice(0, 6);

  if (debts.length === 0) {
    return (
      <p className="px-1 py-2 text-2xs text-muted-foreground" data-testid="story-progress-debts-empty">
        没有伏笔条目。埋点后这里会列出未回收的债。
      </p>
    );
  }

  return (
    <div data-testid="story-progress-debts">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">伏笔债务</span>
        <span className="text-2xs text-muted-foreground">
          未回收 {pending.length} · 已回收 {paidOff}
        </span>
        {pending.length > visible.length || expanded ? (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto h-6 px-1.5 text-2xs"
            data-testid="story-progress-debts-toggle"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : `展开全部 ${pending.length} 条`}
          </Button>
        ) : null}
      </div>
      {/* 展开态限高 + 内部滚动：本页是定高布局，账本无限长高会把底部挤出可视区且无处滚动 */}
      <ul className={`mt-1.5 space-y-1${expanded ? " max-h-[min(44vh,24rem)] overflow-y-auto pr-1" : ""}`}>
        {visible.map((debt) => (
          <li
            key={debt.id}
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${DEBT_TONE[debt.urgency]}`}
            data-testid={`story-progress-debt-${debt.entryId}`}
          >
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-2xs">{DEBT_LABEL[debt.urgency]}</Badge>
            <span className="min-w-0 flex-1 truncate text-2xs font-medium" title={debt.title}>
              {debt.title}
            </span>
            <span className="shrink-0 text-2xs opacity-80" title={debt.reason}>{debt.reason}</span>
            {onOpenEntityDetail ? (
              <Button
                size="xs"
                variant="ghost"
                className="h-5 shrink-0 px-1 text-2xs"
                data-testid={`story-progress-debt-open-${debt.entryId}`}
                onClick={() => onOpenEntityDetail(debt.title, debt.entryId)}
              >
                查看
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CellActions({
  cell,
  lane,
  isFocus,
  chapterNumber,
  onOpenChapter,
  onOpenEntityDetail,
  onForeshadowAction,
}: {
  cell: BoardModel["lanes"][number]["cellsByChapter"][number][number];
  lane: StoryProgressLane;
  isFocus: boolean;
  chapterNumber: number;
  onOpenChapter?: (chapterNumber: number) => void;
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  onForeshadowAction?: (entryId: string, action: "mark_paid" | "schedule_next") => void;
}) {
  const isForeshadow = lane.kind === "foreshadow" && cell.entryId;
  return (
    <div className="group relative" data-testid={`story-progress-cell-wrap-${cell.id}`}>
      <button
        type="button"
        title={cell.summary ?? cell.title}
        className="flex min-h-[6.5rem] w-full flex-col gap-1 rounded-md border bg-card px-2 py-1.5 text-left transition-shadow hover:shadow-sm"
        style={{ borderLeftColor: lane.color, borderLeftWidth: 3 }}
        data-testid={`story-progress-cell-${cell.id}`}
        onClick={() => {
          if (cell.entryId && onOpenEntityDetail) onOpenEntityDetail(cell.title, cell.entryId);
          else onOpenChapter?.(chapterNumber);
        }}
      >
        <span className="flex items-start gap-1">
          <CircleDot className="mt-0.5 size-2.5 shrink-0 opacity-60" />
          <span className="min-w-0 line-clamp-2 text-2xs font-medium leading-snug">{cell.title}</span>
        </span>
        {cell.summary ? (
          <span className="line-clamp-3 text-2xs leading-relaxed text-muted-foreground" data-testid={`story-progress-cell-summary-${cell.id}`}>
            {cell.summary}
          </span>
        ) : (
          <span className="text-2xs text-muted-foreground/70">暂无摘要</span>
        )}
      </button>
      {isForeshadow ? (
        <div
          className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-background/95 p-0.5 shadow-md group-hover:flex"
          data-testid={`story-progress-cell-actions-${cell.id}`}
        >
          <Button
            size="icon-xs"
            variant="ghost"
            title="标记已回收"
            aria-label={`标记回收 ${cell.title}`}
            data-testid={`story-progress-action-payoff-${cell.id}`}
            onClick={(e) => { e.stopPropagation(); if (cell.entryId) onForeshadowAction?.(cell.entryId, "mark_paid"); }}
          >
            <Check className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="安排进下一章"
            aria-label={`排入下一章 ${cell.title}`}
            data-testid={`story-progress-action-schedule-${cell.id}`}
            onClick={(e) => { e.stopPropagation(); if (cell.entryId) onForeshadowAction?.(cell.entryId, "schedule_next"); }}
          >
            <Flag className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LaneRow({
  lane,
  board,
  onOpenChapter,
  onOpenEntityDetail,
  onAddBeat,
  onForeshadowAction,
}: {
  lane: StoryProgressLane;
  board: BoardModel;
  onOpenChapter?: (chapterNumber: number) => void;
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  onAddBeat?: (chapterNumber: number, lane: StoryProgressLane) => void;
  onForeshadowAction?: (entryId: string, action: "mark_paid" | "schedule_next") => void;
}) {
  return (
    <>
      {/* 行头 sticky：左侧色条编码线别，不整块填色（整卡填色刺眼） */}
      <div
        className="sticky left-0 z-[1] flex min-h-[7.5rem] items-start gap-2 border-l-[3px] bg-card px-2 py-2"
        style={{ borderLeftColor: lane.color }}
        data-testid={`story-progress-lane-${lane.id}`}
      >
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={lane.title}>{lane.title}</p>
          <p className="text-2xs text-muted-foreground">
            {LANE_KIND_LABEL[lane.kind]}
            {lane.stalled ? ` · 停滞 ${lane.chaptersSinceLastBeat} 章` : ""}
          </p>
        </div>
        {lane.stalled ? <TriangleAlert className="ml-auto size-3 shrink-0 text-amber-500" /> : null}
        {onAddBeat ? (
          <Button
            size="icon-xs"
            variant="outline"
            className="ml-auto h-5 w-5"
            title={`在 ${lane.kind === "main" ? "主线" : lane.title} 上添加节拍`}
            aria-label={`添加节拍 - ${lane.title}`}
            data-testid={`story-progress-add-beat-${lane.id}`}
            onClick={(e) => {
              e.stopPropagation();
              const nextChapter = board.focus?.chapterNumber ?? board.currentChapter + 1;
              onAddBeat(nextChapter, lane);
            }}
          >
            <Plus className="size-3" />
          </Button>
        ) : null}
      </div>

      {board.chapters.map((column) => {
        const cells = cellsForChapter(lane, column.chapterNumber);
        const isFocus = board.focus?.chapterNumber === column.chapterNumber;
        return (
          <div
            key={`${lane.id}:${column.chapterNumber}`}
            className={
              "min-h-[7.5rem] space-y-1.5 rounded-md border p-1.5 "
              + (isFocus
                ? "border-primary/40 bg-primary/[0.05]"
                : column.future
                  ? "border-dashed border-border/50"
                  : "border-dashed border-border/70")
            }
          >
            {cells.map((cell) => (
              <CellActions
                key={cell.id}
                cell={cell}
                lane={lane}
                isFocus={isFocus}
                chapterNumber={column.chapterNumber}
                onOpenChapter={onOpenChapter}
                onOpenEntityDetail={onOpenEntityDetail}
                onForeshadowAction={onForeshadowAction}
              />
            ))}
            {column.future && onAddBeat && cells.length === 0 ? (
              <button
                type="button"
                title="在此章加一个新节拍"
                className="flex h-[3rem] w-full items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                data-testid={`story-progress-add-${lane.id}-${column.chapterNumber}`}
                onClick={() => onAddBeat(column.chapterNumber, lane)}
              >
                <Plus className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function StoryProgressBoard({
  bookId,
  currentChapter,
  onOpenChapter,
  onOpenEntityDetail,
  onSendToNarrator,
  onAddBeat,
  onForeshadowAction,
  compactHeader,
}: StoryProgressBoardProps) {
  const { state, reload } = useProgressData(bookId);
  // 写章、结算、改伏笔阈值后都会派发写作进度事件；据此重读，不必刷新页面。
  useWritingProgressRefresh(bookId, reload);
  const [opFeedback, setOpFeedback] = useState<string | null>(null);
  const [showCreateStoryline, setShowCreateStoryline] = useState(false);
  const [newStorylineName, setNewStorylineName] = useState("");
  const [newStorylineKind, setNewStorylineKind] = useState("main");
  const [creatingStoryline, setCreatingStoryline] = useState(false);

  const base = `/api/books/${encodeURIComponent(bookId)}`;

  const handleCreateStoryline = useCallback(async () => {
    if (!newStorylineName.trim()) return;
    setCreatingStoryline(true);
    try {
      const res = await fetchJson<{ ok: boolean; data?: { id: string } }>(
        `${base}/narrative-memory/storylines`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newStorylineName.trim(),
            kind: newStorylineKind,
          }),
        },
      );
      if (res.ok) {
        setOpFeedback(`已成功创建剧情线「${newStorylineName.trim()}」`);
        setShowCreateStoryline(false);
        setNewStorylineName("");
        reload();
      }
    } catch (err) {
      setOpFeedback(`创建剧情线失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreatingStoryline(false);
    }
  }, [base, newStorylineName, newStorylineKind, reload]);

  const addBeat = useCallback(async (chapterNumber: number, lane: StoryProgressLane) => {
    try {
      if (lane.source === "storyline" && lane.storylineId) {
        // 任务 3：真剧情线新增节拍直接创建场景并正交挂载到该剧情线
        const createdScene = await fetchJson<{ ok: boolean; data?: { id: string } }>(
          `${base}/narrative-memory/scenes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapterNumber,
              title: `第 ${chapterNumber} 章 · ${lane.title}`,
              summary: `挂载于剧情线「${lane.title}」`,
              function: "advance",
            }),
          },
        );

        if (createdScene.ok && createdScene.data?.id) {
          await fetchJson(
            `${base}/narrative-memory/scenes/${encodeURIComponent(createdScene.data.id)}/mounts`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storylineId: lane.storylineId,
                role: "primary",
              }),
            },
          );
        }
        setOpFeedback(`已在剧情线「${lane.title}」第 ${chapterNumber} 章建立新场景`);
      } else {
        // 老书兼容回退：未建真剧情线前建立 chapter-summaries 条目
        await fetchJson(`${base}/jingwei/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `第 ${chapterNumber} 章 · ${lane.title}`,
            contentMd: "",
            category: "chapter-summaries",
            status: "needs-review",
            fields: { chapterNumber, laneKind: lane.kind },
            relatedChapterNumbers: [chapterNumber],
            layer: "dynamic",
          }),
        });
        setOpFeedback(`已把「${lane.title}」第 ${chapterNumber} 章新节拍挂进待写列表`);
      }
      reload();
    } catch {
      setOpFeedback(`新建节拍失败`);
    }
  }, [base, reload]);

  const foreshadowAction = useCallback(async (entryId: string, action: "mark_paid" | "schedule_next") => {
    try {
      if (action === "mark_paid") {
        await fetchJson(`${base}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paid_off" }),
        });
        setOpFeedback(`伏笔已标记为回收`);
      } else {
        await fetchJson(`${base}/narrative-memory/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapterNumber: currentChapter ?? 0,
            eventType: "foreshadow_scheduled",
            subject: entryId,
            predicate: "排进下一章",
            evidenceText: "作者在推进看板把伏笔排进下一章写作",
          }),
        });
        setOpFeedback(`伏笔已排进下一章`);
      }
      reload();
    } catch {
      setOpFeedback(`伏笔操作失败`);
    }
  }, [base, currentChapter, reload]);

  const handleAddBeat = useMemo(() => (onAddBeat ?? addBeat), [addBeat, onAddBeat]);
  const handleForeshadowAction = useMemo(() => (onForeshadowAction ?? foreshadowAction), [foreshadowAction, onForeshadowAction]);

  const board = useMemo(() => {
    if (state.status !== "ready") return null;
    if (state.data.structurePayload) {
      const struct = state.data.structurePayload;
      return buildStoryProgressBoard({
        storylines: struct.storylines,
        scenes: struct.scenes,
        mounts: struct.mounts,
        // 快照里已有章名与按作者阈值算好的伏笔债务，一并交给网格（此前只给了剧情线与场景）。
        chapters: struct.chapters,
        foreshadowDebts: struct.foreshadows ?? [],
        currentChapter: currentChapter ?? struct.currentChapter,
      });
    }
    return buildStoryProgressBoard({
      chapterSummaries: state.data.chapterSummaries,
      foreshadowEntries: state.data.foreshadowEntries,
      conflictEntries: state.data.conflictEntries,
      events: state.data.events,
      ...(state.data.foreshadowThresholds ? { foreshadowThresholds: state.data.foreshadowThresholds } : {}),
      ...(currentChapter !== undefined ? { currentChapter } : {}),
    });
  }, [state, currentChapter]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="story-progress-loading">
        <Loader2 className="size-4 animate-spin" /> 正在铺开故事推进…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="story-progress-error">
        <AlertCircle className="size-6 text-destructive" />
        <p className="max-w-sm text-2xs text-muted-foreground">{state.message}</p>
        <Button size="xs" variant="outline" className="h-7 gap-1 text-xs" onClick={reload}>
          <RefreshCw className="size-3" /> 重试
        </Button>
      </div>
    );
  }

  if (!board || !hasProgressContent(board)) {
    return <EmptyState data={state.data} onReload={reload} {...(onSendToNarrator ? { onSendToNarrator } : {})} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="story-progress-board">
      {state.data.degraded.length > 0 ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-2 py-1 text-2xs text-amber-700 dark:text-amber-300" data-testid="story-progress-degraded">
          这些数据没读到：{state.data.degraded.join(" / ")}。下面只画读到的部分。
        </p>
      ) : null}

      {board.explanation ? (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/[0.05] p-2 text-xs space-y-1" data-testid="story-progress-explanation">
          <div className="flex items-center justify-between font-medium text-blue-700 dark:text-blue-300">
            <span>{board.explanation.title}</span>
            <span className="text-2xs text-muted-foreground font-normal">兼容提示</span>
          </div>
          <p className="text-2xs text-muted-foreground">{board.explanation.what}</p>
          <p className="text-2xs text-muted-foreground">
            <strong className="font-semibold text-foreground">建议：</strong>{board.explanation.action}
          </p>
        </div>
      ) : null}

      <TensionCurveStrip chapters={board.chapters} currentChapter={board.currentChapter} />
      <StructureScoreStrip scores={state.data.structureScores} currentChapter={board.currentChapter} />

      {opFeedback ? (
        <p className="rounded-md border border-primary/30 bg-primary/[0.05] px-2 py-1 text-xs text-primary" data-testid="story-progress-feedback">
          {opFeedback}
        </p>
      ) : null}

      {showCreateStoryline ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-card p-2 text-xs" data-testid="story-progress-create-storyline-form">
          <span className="font-semibold text-foreground">新建剧情线：</span>
          <input
            placeholder="剧情线名称（如：感情线/宗门暗斗）"
            className="h-6 w-48 rounded border bg-background px-2 text-2xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            value={newStorylineName}
            onChange={(e) => setNewStorylineName(e.target.value)}
            data-testid="story-progress-storyline-name-input"
          />
          <select
            className="h-6 rounded border bg-background px-1 text-2xs text-foreground"
            value={newStorylineKind}
            onChange={(e) => setNewStorylineKind(e.target.value)}
            data-testid="story-progress-storyline-kind-select"
          >
            <option value="main">主线</option>
            <option value="sub">支线</option>
            <option value="romance">感情线</option>
            <option value="character-arc">人物成长</option>
            <option value="mystery">悬疑伏笔</option>
          </select>
          <Button
            size="xs"
            className="h-6 px-2 text-2xs"
            disabled={!newStorylineName.trim() || creatingStoryline}
            onClick={handleCreateStoryline}
            data-testid="story-progress-storyline-submit-btn"
          >
            {creatingStoryline ? "创建中…" : "确认创建"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-2xs"
            onClick={() => setShowCreateStoryline(false)}
          >
            取消
          </Button>
        </div>
      ) : null}

      <FocusCard
        board={board}
        defaultCollapsed={!!compactHeader}
        {...(onOpenChapter ? { onOpenChapter } : {})}
        {...(onSendToNarrator ? { onSendToNarrator } : {})}
      />

      {/* 网格：横向滚动，行头/列头 sticky */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <div className="min-w-max p-2">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `12rem repeat(${Math.max(board.chapters.length, 1)}, minmax(14rem, 1fr))` }}
          >
            <div className="sticky left-0 top-0 z-[2] flex items-center justify-between rounded-md bg-muted/70 px-2 py-1.5 text-2xs font-semibold text-muted-foreground">
              <span>剧情线</span>
              <Button
                size="icon-xs"
                variant="ghost"
                className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                title="新建剧情线"
                aria-label="新建剧情线"
                data-testid="story-progress-add-storyline-btn"
                onClick={() => setShowCreateStoryline(true)}
              >
                <Plus className="size-3" />
              </Button>
            </div>
            {board.chapters.map((column) => {
              const isFocus = board.focus?.chapterNumber === column.chapterNumber;
              return (
                <button
                  key={column.chapterNumber}
                  type="button"
                  className={
                    "sticky top-0 z-[1] rounded-md px-2 py-1.5 text-left "
                    + (isFocus ? "bg-primary/15 ring-1 ring-primary/40" : column.future ? "bg-muted/20" : "bg-muted/50")
                  }
                  data-testid={`story-progress-chapter-${column.chapterNumber}`}
                  onClick={() => onOpenChapter?.(column.chapterNumber)}
                >
                  <div className="text-2xs font-semibold">
                    第 {column.chapterNumber} 章{isFocus ? " ·下一章" : ""}
                  </div>
                  <div className="truncate text-2xs text-muted-foreground" title={column.title}>
                    {column.future ? "待写" : column.title}
                  </div>
                </button>
              );
            })}

            {board.lanes.map((lane) => (
              <LaneRow
                key={lane.id}
                lane={lane}
                board={board}
                {...(onOpenChapter ? { onOpenChapter } : {})}
                {...(onOpenEntityDetail ? { onOpenEntityDetail } : {})}
                onAddBeat={handleAddBeat}
                onForeshadowAction={handleForeshadowAction}
              />
            ))}
          </div>

          {board.collapsedCharacterLanes > 0 ? (
            <p className="mt-2 px-1 text-2xs text-muted-foreground" data-testid="story-progress-collapsed">
              另有 {board.collapsedCharacterLanes} 个出场较少的角色线未展示（避免行数过多）。
            </p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 rounded-lg border p-2">
        <DebtLedger debts={board.debts} {...(onOpenEntityDetail ? { onOpenEntityDetail } : {})} />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-1 pb-1">
        <BookOpen className="size-3 text-muted-foreground" />
        <span className="text-2xs text-muted-foreground">
          第 {board.currentChapter} 章 · {board.lanes.length} 条线 · 数据来自经纬与叙事记忆
        </span>
        <Button size="xs" variant="ghost" className="ml-auto h-6 gap-1 px-1.5 text-2xs" onClick={reload}>
          <RefreshCw className="size-3" /> 刷新
        </Button>
      </div>
    </div>
  );
}

export default StoryProgressBoard;
