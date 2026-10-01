/**
 * 故事脉络（Storyline）侧栏面板 —— 推进中心形态。
 *
 * 顶部是所有 tab 共享的「推进驾驶舱」：
 * 1. 位置锚定条：当前第 N 章 / 目标 M 章 · 进度%（打开即见，无需切 tab）；
 * 2. NEXT 下一步卡：readiness 五级规则推导唯一最高优先级动作，点击直达。
 *
 * 四个能力 tab 保持单一权威入口：
 * 1. 「章节与大纲」：章节树 + 大纲树 + 一键提拔（★大纲唯一权威入口）；
 * 2. 「章后事实」：轻量摘要卡（待审/高风险计数），完整面板在中央 Tab 打开；
 * 3. 「故事画布」：单按钮打开中央画布（发展历程/双螺旋/地图在画布内切换）；
 * 4. 「进度账本」：伏笔 / 冲突 / 债务进度表（tab id 仍是 foreshadowing）。
 */

import { useEffect, useMemo, useState } from "react";
import { Bookmark, BookOpen, ChevronDown, ChevronRight, FilePlus2, FileText, ListTree, Map as MapIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { invalidateApiPaths, useApi } from "@/hooks/use-api";
import { StaleSettlementList, freshnessPath, useStaleSettlementCount } from "./StaleSettlementList";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import { computeForeshadowingDebt, type ForeshadowingDebt } from "../../../engine/jingwei/foreshadowing-debt";
import { useForeshadowThresholds } from "../use-foreshadow-thresholds";
import { NarrativeMemorySummary } from "../NarrativeMemoryPanel";
import { LedgerProgressTable } from "../LedgerProgressTable";
import { createMemoryCenterNode, createStoryProgressionNode } from "../useWorkbenchResources";
import type { ResourceTreeAction } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
import { resourceDisplayTitle } from "../chapter-display-title";

export interface StorylineAndPlanningSidebarPanelProps {
  bookId: string;
  chapterTreeNodes?: readonly WorkbenchResourceNode[];
  outlineTreeNodes?: readonly WorkbenchResourceNode[];
  selectedNodeId: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onSwitchView: (view: "write") => void;
  onAction?: (action: ResourceTreeAction) => void;
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 叙述者通道：NEXT 卡的「让叙述者生成卷纲」等 seed 动作经由它一键发送。 */
  onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 本书目标总章数（来自 book 配置），用于进度百分比；缺省时只显示当前章号。 */
  bookTargetChapters?: number;
  /** 进度账本行上的来源/到期章跳转。 */
  onJumpToChapter?: (chapterNumber: number) => void;
}

function StorylineResourceTree({
  nodes,
  emptyLabel,
  draftedChapters,
  onOpen,
  onAction,
}: {
  nodes: readonly WorkbenchResourceNode[];
  emptyLabel: string;
  /** 已落稿章号集合（由章节树推导），用于大纲条目的 ✓/🗺 徽标与提拔守卫。 */
  draftedChapters?: ReadonlySet<number>;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map((node) => node.id)));

  useEffect(() => {
    setExpanded((previous) => {
      const next = new Set(previous);
      for (const node of nodes) next.add(node.id);
      return next;
    });
  }, [nodes]);

  const toggle = (nodeId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const renderNode = (node: WorkbenchResourceNode, depth = 0) => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isExpanded = expanded.has(node.id);
    const isOutline = node.kind === "jingwei-entry" || node.kind === "story";
    // T3 身份链：fields.targetChapterNumber + 章节树存在性 → drafted/planned 推导。
    const targetChapter = Number((node.metadata?.fields as Record<string, unknown> | undefined)?.targetChapterNumber);
    const outlineState: "drafted" | "planned" | null =
      isOutline && Number.isInteger(targetChapter) && targetChapter > 0
        ? (draftedChapters?.has(targetChapter) ? "drafted" : "planned")
        : null;
    const stateBadge = outlineState === "drafted"
      ? <span className="shrink-0 text-2xs text-emerald-600 dark:text-emerald-400" title={`已对应第 ${targetChapter} 章`}>✓已落稿</span>
      : outlineState === "planned"
        ? <span className="shrink-0 text-2xs text-muted-foreground" title={`规划为第 ${targetChapter} 章，尚未落稿`}>🗺规划中</span>
        : null;
    return (
      <div key={node.id}>
        <div className="group/node flex items-center justify-between gap-1 rounded hover:bg-muted pr-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-2xs"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={() => (hasChildren ? toggle(node.id) : onOpen(node))}
          >
            {hasChildren ? (isExpanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />) : <span className="w-3 shrink-0" />}
            {node.kind === "chapter" ? <FileText className="size-3 shrink-0 text-blue-500" /> : <ListTree className="size-3 shrink-0 text-sky-500" />}
            {/* 章节树用作者语言：「正文 › 卷01 › 第 1 章 雨夜」；资源管理器里才显示真实文件名。 */}
            <span className="min-w-0 flex-1 truncate">{resourceDisplayTitle(node)}</span>
            {stateBadge}
          </button>

          {/* 大纲节点一键提拔落稿到手稿章节；已落稿的条目不再重复提拔（T3 守卫） */}
          {isOutline && onAction && outlineState !== "drafted" ? (
            <button
              type="button"
              title="将大纲提拔至手稿章节"
              className="opacity-0 group-hover/node:opacity-100 size-5 flex items-center justify-center rounded text-primary hover:bg-primary/10 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onAction({
                  type: "promote-outline",
                  node,
                });
              }}
            >
              <FilePlus2 className="size-3" />
            </button>
          ) : null}
        </div>
        {hasChildren && isExpanded ? node.children!.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return nodes.length > 0 ? <div className="space-y-0.5">{nodes.map((node) => renderNode(node))}</div> : <p className="px-1 py-2 text-2xs text-muted-foreground">{emptyLabel}</p>;
}

type StorylineSubTab = "outline" | "memory" | "canvas" | "foreshadowing";

interface StorylineForeshadowingEntry {
  id: string;
  title: string;
  contentMd?: string;
  customFields?: Record<string, unknown>;
  fieldsJson?: string;
}

export interface StorylineForeshadowItem {
  id: string;
  title: string;
  name: string;
  description: string;
  status: string;
  plantedChapter: number;
  targetChapter: number;
  debt: ForeshadowingDebt;
}

const FORESHADOW_SETTLED = new Set(["已回收", "已废弃"]);

/**
 * 故事侧栏伏笔数据源（单一请求，驾驶舱 chips 与账本列表共享）。
 * currentChapter 必须由调用方传真实值——债务判定依赖它，传 undefined 会静默失效。
 */
function useStorylineForeshadowing(bookId: string, currentChapter: number | undefined) {
  const { data, loading, error, refetch } = useApi<{ entries?: StorylineForeshadowingEntry[] }>(
    `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=foreshadowing`,
  );
  const thresholds = useForeshadowThresholds(bookId);

  const items = useMemo<StorylineForeshadowItem[]>(() => {
    return (data?.entries ?? []).map((entry) => {
      let fields: Record<string, unknown> = {};
      if (entry.customFields && typeof entry.customFields === "object") {
        fields = entry.customFields;
      } else if (entry.fieldsJson) {
        try {
          fields = JSON.parse(entry.fieldsJson);
        } catch {
          // ignore
        }
      }
      const name = (typeof fields.name === "string" ? fields.name : "") || entry.title || "未命名伏笔";
      const status = typeof fields.status === "string" ? fields.status : "已埋设";
      const plantedChapter = typeof fields.plantedChapter === "number" ? fields.plantedChapter : 0;
      const targetChapter = typeof fields.targetChapter === "number" ? fields.targetChapter : 0;
      const settled = FORESHADOW_SETTLED.has(status);
      const debt = computeForeshadowingDebt({
        plantedChapter,
        currentChapter: currentChapter ?? null,
        settled,
        thresholds,
      });
      return {
        id: entry.id,
        title: entry.title,
        name,
        description: (typeof fields.description === "string" ? fields.description : "") || entry.contentMd || "",
        status,
        plantedChapter,
        targetChapter,
        debt,
      };
    });
  }, [data, currentChapter, thresholds]);

  /** 承诺口径统计：未回收总数 + 本章到期数（目标章 ≤ 当前章+1 的未回收伏笔）。 */
  const stats = useMemo(() => {
    const open = items.filter((item) => !FORESHADOW_SETTLED.has(item.status));
    const dueNow = open.filter(
      (item) => item.targetChapter > 0 && currentChapter !== undefined && item.targetChapter <= currentChapter + 1,
    );
    return { openCount: open.length, dueNowCount: dueNow.length };
  }, [items, currentChapter]);

  return { items, stats, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// 推进驾驶舱：位置锚定 + NEXT 五级规则
// ---------------------------------------------------------------------------

/** 从章节树推导当前最大章号（与 WorkbenchCanvas.resolveCurrentChapter 同口径的轻量版）。 */
function maxChapterFromTree(nodes: readonly WorkbenchResourceNode[]): number {
  let max = 0;
  const walk = (node: WorkbenchResourceNode): void => {
    const num = Number(node.metadata?.chapterNumber);
    if (Number.isInteger(num) && num > 0 && num > max) max = num;
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return max;
}

/** 大纲树里「规划中未落稿」条目数：有目标章号且该章尚未落稿。 */
function countPlannedOutlineNodes(
  outlineTreeNodes: readonly WorkbenchResourceNode[],
  draftedChapters: ReadonlySet<number>,
): number {
  let count = 0;
  const walk = (node: WorkbenchResourceNode): void => {
    const isOutline = node.kind === "jingwei-entry" || node.kind === "story";
    const target = Number((node.metadata?.fields as Record<string, unknown> | undefined)?.targetChapterNumber);
    if (isOutline && Number.isInteger(target) && target > 0 && !draftedChapters.has(target)) count += 1;
    node.children?.forEach(walk);
  };
  outlineTreeNodes.forEach(walk);
  return count;
}

/** NEXT 建议的唯一动作形态。 */
interface NextAction {
  readonly key: "outline-empty" | "promote-outline" | "review-pending" | "resettle-stale" | "foreshadow-due" | "all-set";
  readonly label: string;
  /** 点击后切到哪个 tab；undefined 表示纯叙述者 seed 动作或只读状态。 */
  readonly tab?: StorylineSubTab;
}

/** 待审事件计数 hook：与 NarrativeMemorySummary 同一接口，只取 length。 */
function usePendingEventCount(bookId: string) {
  const { data } = useApi<{ events?: ReadonlyArray<{ id?: string }> }>(
    `/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`,
  );
  return data?.events?.length ?? 0;
}

const OUTLINE_SEED_MESSAGE =
  "请为我生成第一卷卷纲草案（outline.volume action=suggest），生成后给我确认，确认前不要直接写入。";

/**
 * NEXT 五级规则：按序取第一个命中，永远只给一条建议。
 * 1 缺纲 → 叙述者 seed；2 有规划未落稿 → 提拔；3 有待审 → 章后事实；
 * 3.5 有记忆过期的章 → 章后事实重新结算；4 有到期伏笔 → 账本；5 默认就绪态（只读文案，写作入口在写作视图避免双入口）。
 */
export function resolveNextAction(input: {
  readonly hasOutline: boolean;
  readonly plannedCount: number;
  readonly pendingCount: number;
  readonly dueNowCount: number;
  /** 正文结算后又被改过的章数（记忆过期）。 */
  readonly staleCount?: number;
}): NextAction {
  if (!input.hasOutline) return { key: "outline-empty", label: "让叙述者生成第一卷卷纲" };
  if (input.plannedCount > 0) return { key: "promote-outline", tab: "outline", label: `提拔规划中的大纲落稿（${input.plannedCount} 条）` };
  if (input.pendingCount > 0) return { key: "review-pending", tab: "memory", label: `处理章后待审事件（${input.pendingCount} 条）` };
  if ((input.staleCount ?? 0) > 0) return { key: "resettle-stale", tab: "memory", label: `重新结算记忆过期的章节（${input.staleCount} 章）` };
  if (input.dueNowCount > 0) return { key: "foreshadow-due", tab: "foreshadowing", label: `本章有 ${input.dueNowCount} 条伏笔到期` };
  return { key: "all-set", label: "一切就绪 · 继续写下一章" };
}

function StorylineCockpit({
  currentChapter,
  targetChapters,
  next,
  onActivate,
}: {
  currentChapter: number;
  targetChapters?: number;
  next: NextAction;
  onActivate: (next: NextAction) => void;
}) {
  const percent = targetChapters !== undefined && targetChapters > 0
    ? Math.min(100, Math.round((currentChapter / targetChapters) * 100))
    : undefined;

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-2 py-1.5 space-y-1.5" data-testid="storyline-cockpit">
      {/* 行 A · 位置锚定 */}
      <div className="flex items-center gap-2" data-testid="storyline-position-bar">
        <span className="text-2xs font-medium text-foreground">📍 第 {currentChapter} 章</span>
        {targetChapters !== undefined && targetChapters > 0 ? (
          <>
            <span className="text-2xs text-muted-foreground">/ 目标 {targetChapters} 章</span>
            <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden min-w-8">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-2xs tabular-nums text-muted-foreground">{percent}%</span>
          </>
        ) : null}
      </div>

      {/* 行 B · NEXT 下一步卡 */}
      <button
        type="button"
        data-testid={`storyline-next-${next.key}`}
        onClick={() => onActivate(next)}
        disabled={next.key === "all-set"}
        className={cn(
          "w-full flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-2xs transition-colors",
          next.key === "all-set"
            ? "border-border bg-card/60 text-muted-foreground cursor-default"
            : "border-primary/40 bg-primary/5 text-foreground hover:bg-primary/10",
        )}
      >
        <Sparkles className={cn("size-3 shrink-0", next.key === "all-set" ? "text-muted-foreground" : "text-primary")} />
        <span className="min-w-0 flex-1 truncate">{next.label}</span>
        {next.key !== "all-set" ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : null}
      </button>
    </div>
  );
}

export function StorylineAndPlanningSidebarPanel({
  bookId,
  chapterTreeNodes = [],
  outlineTreeNodes = [],
  selectedNodeId,
  onOpen,
  onSwitchView,
  onAction,
  onSendToNarrator,
  bookTargetChapters,
  onJumpToChapter,
}: StorylineAndPlanningSidebarPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<StorylineSubTab>("outline");

  /** 跳转到统一的大屏「故事画布」：同一本书共用一个 Tab，画布内部切正图/推进/脉络。 */
  const openProgressionCanvas = (view: "tree" | "board" | "chronicle") => {
    onOpen(createStoryProgressionNode(bookId, view));
  };

  const handleSubTabChange = (tab: StorylineSubTab) => {
    setActiveSubTab(tab);
    if (tab === "canvas") {
      // 直接打开大屏画布（默认正图），消除"点了只看到一段说明文字"的空转。
      openProgressionCanvas("tree");
    }
  };

  const draftedChapters = useMemo(() => {
    const out = new Set<number>();
    const walk = (node: WorkbenchResourceNode): void => {
      const num = Number(node.metadata?.chapterNumber);
      if (Number.isInteger(num) && num > 0) out.add(num);
      node.children?.forEach(walk);
    };
    chapterTreeNodes.forEach(walk);
    return out;
  }, [chapterTreeNodes]);

  // ── 驾驶舱数据 ──
  const currentChapter = useMemo(() => maxChapterFromTree(chapterTreeNodes), [chapterTreeNodes]);
  const pendingCount = usePendingEventCount(bookId);
  const staleCount = useStaleSettlementCount(bookId);
  // 驾驶舱需要伏笔统计，账本也需要同一份数据：hook 在顶层调用一次共享。
  const foreshadow = useStorylineForeshadowing(bookId, currentChapter);
  useWritingProgressRefresh(bookId, () => {
    invalidateApiPaths([
      `/api/books/${encodeURIComponent(bookId)}/jingwei/entries`,
      `/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`,
      `/api/books/${encodeURIComponent(bookId)}/state`,
      freshnessPath(bookId),
    ]);
  });

  const plannedCount = useMemo(
    () => countPlannedOutlineNodes(outlineTreeNodes, draftedChapters),
    [outlineTreeNodes, draftedChapters],
  );
  const next = useMemo(
    () => resolveNextAction({
      hasOutline: outlineTreeNodes.length > 0,
      plannedCount,
      pendingCount,
      staleCount,
      dueNowCount: foreshadow.stats.dueNowCount,
    }),
    [outlineTreeNodes.length, plannedCount, pendingCount, staleCount, foreshadow.stats.dueNowCount],
  );

  /** NEXT 卡点击的唯一入口：tab 类动作切 tab；叙述者 seed 动作一键发送。 */
  const handleNextActivate = (action: NextAction) => {
    if (action.tab) {
      handleSubTabChange(action.tab);
      return;
    }
    if (action.key === "outline-empty") void onSendToNarrator?.(OUTLINE_SEED_MESSAGE);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="storyline-and-planning-panel">
      {/* 推进驾驶舱：所有 tab 共享的位置锚定与下一步引导 */}
      <StorylineCockpit
        currentChapter={currentChapter}
        targetChapters={bookTargetChapters}
        next={next}
        onActivate={handleNextActivate}
      />

      {/* 顶部子标签切换导航（带常亮高亮） */}
      <div className="shrink-0 border-b border-border bg-muted/20 p-2 space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5 text-2xs font-semibold text-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span>故事推进</span>
          </div>
          <Button size="xs" variant="ghost" className="h-6 text-2xs" onClick={() => onSwitchView("write")}>
            <BookOpen className="size-3" />
            当前语境
          </Button>
        </div>

        {/* 4 个核心功能 Tab 切换（带明确的高亮状态） */}
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="xs"
            variant={activeSubTab === "outline" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-2xs font-medium transition-colors",
              activeSubTab === "outline" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("outline")}
          >
            <ListTree className="size-3.5 text-sky-500" />
            <span className="truncate">章节与大纲</span>
          </Button>

          <Button
            size="xs"
            variant={activeSubTab === "memory" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-2xs font-medium transition-colors",
              activeSubTab === "memory" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("memory")}
          >
            <Sparkles className="size-3.5 text-amber-500" />
            <span className="truncate">章后事实</span>
          </Button>

          <Button
            size="xs"
            variant={activeSubTab === "canvas" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-2xs font-medium transition-colors",
              activeSubTab === "canvas" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("canvas")}
          >
            <MapIcon className="size-3.5 text-primary" />
            <span className="truncate">故事画布</span>
          </Button>

          <Button
            size="xs"
            variant={activeSubTab === "foreshadowing" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-2xs font-medium transition-colors",
              activeSubTab === "foreshadowing" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("foreshadowing")}
          >
            <Bookmark className="size-3.5 text-indigo-500" />
            <span className="truncate">进度账本</span>
          </Button>
        </div>
      </div>

      {/* 主体内容区：根据选中的 SubTab 互斥渲染 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {activeSubTab === "outline" && (
          <section id="storyline-chapter-outline" className="rounded-lg border border-border bg-card p-2 space-y-2" data-testid="storyline-chapter-outline">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-2xs font-semibold">
                <ListTree className="size-3.5 text-sky-500" />
                <span>章节与大纲</span>
              </div>
              <span className="text-2xs text-muted-foreground">章节 {chapterTreeNodes.length} · 大纲 {outlineTreeNodes.length}</span>
            </div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-2xs font-medium text-muted-foreground">章节树</div>
                <StorylineResourceTree nodes={chapterTreeNodes} emptyLabel="暂无章节文件" onOpen={onOpen} onAction={onAction} />
              </div>
              <div>
                <div className="mb-1 text-2xs font-medium text-muted-foreground">大纲</div>
                <StorylineResourceTree nodes={outlineTreeNodes} emptyLabel="暂无大纲条目" draftedChapters={draftedChapters} onOpen={onOpen} onAction={onAction} />
              </div>
            </div>
          </section>
        )}

        {activeSubTab === "memory" && (
          <div data-testid="storyline-memory-section">
            <StaleSettlementList bookId={bookId} />
            <NarrativeMemorySummary
              bookId={bookId}
              onOpenCenter={() => onOpen(createMemoryCenterNode(bookId))}
            />
          </div>
        )}

        {activeSubTab === "canvas" && (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 text-muted-foreground">
            <MapIcon className="size-8 text-primary/60" />
            <p className="text-xs font-medium text-foreground">故事画布已在中央打开</p>
            <p className="text-2xs leading-relaxed">
              推进 / 故事树 / 执行共用同一个画布 Tab，在画布顶部切换；故事树里再分章节、因果、脉络与发展历程。
            </p>
            <Button size="xs" variant="outline" className="h-7 justify-start text-2xs" onClick={() => openProgressionCanvas("tree")}>
              🌳 打开故事树
            </Button>
            <Button size="xs" variant="outline" className="h-7 justify-start text-2xs" onClick={() => openProgressionCanvas("board")}>
              📊 打开推进（下一章该写什么）
            </Button>
            <Button size="xs" variant="outline" className="h-7 justify-start text-2xs" onClick={() => openProgressionCanvas("chronicle")}>
              🧬 打开章节脉络
            </Button>
          </div>
        )}

        {activeSubTab === "foreshadowing" && (
          <LedgerProgressTable
            bookId={bookId}
            currentChapter={currentChapter > 0 ? currentChapter : undefined}
            onOpen={onOpen}
            onJumpToChapter={onJumpToChapter}
          />
        )}
      </div>
    </div>
  );
}
