/**
 * 故事脉络（Storyline）侧栏面板 —— 推进中心形态。
 *
 * 顶部是所有 tab 共享的「推进驾驶舱」：
 * 1. 位置锚定条：当前第 N 章 / 目标 M 章 · 进度%（打开即见，无需切 tab）；
 * 2. NEXT 下一步卡：维护提醒（缺卷纲 / 提拔规划中的纲 / 待审事件 / 记忆过期）优先；都没有时引用
 *    故事画布「下一章」页的同一份计划（next-chapter-plan），侧栏不再自算第二套伏笔或下一章判断。
 *
 * 标题行右侧是「打开故事画布」按钮（落在「下一章」；推进 / 故事树在画布顶部切换）。
 * 两个能力 tab 保持单一权威入口：
 * 1. 「章节与大纲」：章节树 + 大纲树 + 一键提拔（★大纲唯一权威入口）；
 * 2. 「章后事实」：轻量摘要卡（待审/高风险计数），完整面板在中央 Tab 打开。
 * 伏笔只在故事画布「下一章」页的伏笔账本（原「进度账本」子页签已下线）。
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FilePlus2, FileText, ListTree, Map as MapIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { invalidateApiPaths, useApi } from "@/hooks/use-api";
import { StaleSettlementList, freshnessPath, useStaleSettlementCount } from "./StaleSettlementList";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import { NarrativeMemorySummary } from "../NarrativeMemoryPanel";
import { describeNextChapterSuggestion } from "../next-chapter-plan";
import { useNextChapterPlan } from "../use-next-chapter-plan";
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
  /**
   * 已不再使用：侧栏头部的「当前语境」按钮只是切到写作视图，与活动栏「写作」完全重复、名不副实，已下线。
   * 保留可选字段只为不打断宿主的现有传参。
   */
  onSwitchView?: (view: "write") => void;
  onAction?: (action: ResourceTreeAction) => void;
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 叙述者通道：NEXT 卡的「让叙述者生成卷纲」等 seed 动作经由它一键发送。 */
  onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 本书目标总章数（来自 book 配置），用于进度百分比；缺省时只显示当前章号。 */
  bookTargetChapters?: number;
  /**
   * 已不再使用：原「进度账本」行上的来源/到期章跳转，账本下线后侧栏没有章号跳转。
   * 保留可选字段只为不打断宿主的现有传参。
   */
  onJumpToChapter?: (chapterNumber: number) => void;
}

function collectBranchIds(nodes: readonly WorkbenchResourceNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if ((node.children?.length ?? 0) > 0) {
      into.push(node.id);
      collectBranchIds(node.children!, into);
    }
  }
  return into;
}

function isPositiveChapterNumber(value: unknown): boolean {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

/**
 * 章节树只放章节。chapters/ 下不是章节文件的笔记（例如「作者说清单.md」）认不出章号，
 * 此前被当成章节挂在树上、点开进了章节编辑器；没有章节的空卷目录点了也没有反应。
 * 两者都不进这棵树——它们在「资源」的文件树里照常可见、可编辑。
 */
export function pruneStoryChapterTree(nodes: readonly WorkbenchResourceNode[]): WorkbenchResourceNode[] {
  const result: WorkbenchResourceNode[] = [];
  for (const node of nodes) {
    if (node.kind === "chapter") {
      if (isPositiveChapterNumber(node.metadata?.chapterNumber)) result.push(node);
      continue;
    }
    const children = node.children ? pruneStoryChapterTree(node.children) : [];
    if (children.length > 0) result.push({ ...node, children });
  }
  return result;
}

interface OutlineVolumeField {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly chapterRange?: { readonly from?: unknown; readonly to?: unknown };
}

function outlineFields(node: WorkbenchResourceNode): Record<string, unknown> | undefined {
  return node.metadata?.fields as Record<string, unknown> | undefined;
}

/** 卷纲条目：fields.volumes 承载全书分卷（唯一权威源），它是容器，不是某一章的纲。 */
function isVolumeOutlineEntry(node: WorkbenchResourceNode): boolean {
  return Array.isArray(outlineFields(node)?.volumes);
}

/** 大纲条目对应的章号：提拔回写的 targetChapterNumber 优先，其次标题里的「第 N 章」。 */
function outlineChapterOf(node: WorkbenchResourceNode): number | undefined {
  const target = Number(outlineFields(node)?.targetChapterNumber);
  if (Number.isInteger(target) && target > 0) return target;
  const match = /第\s*(\d+)\s*章/u.exec(node.title);
  return match ? Number(match[1]) : undefined;
}

/** 卷纲容器的子节点：按章节区间排好的各卷。点它打开卷纲条目本身。 */
function volumeChildren(entry: WorkbenchResourceNode): WorkbenchResourceNode[] {
  const volumes = (outlineFields(entry)?.volumes as readonly OutlineVolumeField[] | undefined) ?? [];
  return volumes
    .map((volume, index) => {
      const from = Number(volume?.chapterRange?.from);
      const to = Number(volume?.chapterRange?.to);
      const title = typeof volume?.title === "string" && volume.title.trim() ? volume.title.trim() : `第 ${index + 1} 卷`;
      const range = Number.isInteger(from) && Number.isInteger(to) && from > 0 && to >= from ? `（第 ${from}–${to} 章）` : "";
      const node: WorkbenchResourceNode = {
        id: `${entry.id}#volume:${typeof volume?.id === "string" && volume.id ? volume.id : index}`,
        kind: "group",
        title: `${title}${range}`,
        capabilities: entry.capabilities,
        metadata: { outlineVolumeOf: entry },
      };
      return { order: Number.isInteger(from) && from > 0 ? from : Number.MAX_SAFE_INTEGER, node };
    })
    .sort((left, right) => left.order - right.order)
    .map((item) => item.node);
}

/**
 * 大纲按推进顺序排：卷纲容器在前（展开成各卷），单章细纲按章号，认不出章号的放最后。
 * 此前按条目创建顺序排列，「第 8 章细纲」会排在卷纲前面。
 */
export function orderOutlineTree(nodes: readonly WorkbenchResourceNode[]): WorkbenchResourceNode[] {
  const rank = (node: WorkbenchResourceNode): number => (isVolumeOutlineEntry(node) ? 0 : 1);
  return nodes
    .map((node) => {
      if (node.kind === "jingwei-entry" && isVolumeOutlineEntry(node)) {
        const volumes = volumeChildren(node);
        return volumes.length > 0 ? { ...node, children: volumes } : node;
      }
      return node.children ? { ...node, children: orderOutlineTree(node.children) } : node;
    })
    .sort((left, right) =>
      rank(left) - rank(right)
      || (outlineChapterOf(left) ?? Number.MAX_SAFE_INTEGER) - (outlineChapterOf(right) ?? Number.MAX_SAFE_INTEGER)
      || left.title.localeCompare(right.title, "zh-CN"));
}

function countOutlineEntries(nodes: readonly WorkbenchResourceNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === "jingwei-entry" || node.kind === "story") count += 1;
    else if (node.children) count += countOutlineEntries(node.children);
  }
  return count;
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
  // 默认全部展开：这两棵树就是用来看章与纲的，卷目录收着等于什么都没显示。
  // 只对首次出现的分支自动展开，作者收起过的不会在刷新后被重新撑开。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(collectBranchIds(nodes)));
  const [seen] = useState<Set<string>>(() => new Set(collectBranchIds(nodes)));

  useEffect(() => {
    const fresh = collectBranchIds(nodes).filter((id) => !seen.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.add(id);
    setExpanded((previous) => new Set([...previous, ...fresh]));
  }, [nodes, seen]);

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
    // 卷纲容器承载全书分卷，提拔它只会建出一个叫「卷纲」的章节并把章号写回卷纲，不给提拔。
    const isVolumeContainer = isOutline && isVolumeOutlineEntry(node);
    const openTarget = node.metadata?.outlineVolumeOf as WorkbenchResourceNode | undefined;
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
            onClick={() => (hasChildren ? toggle(node.id) : onOpen(openTarget ?? node))}
          >
            {hasChildren ? (isExpanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />) : <span className="w-3 shrink-0" />}
            {node.kind === "chapter" ? <FileText className="size-3 shrink-0 text-blue-500" /> : <ListTree className="size-3 shrink-0 text-sky-500" />}
            {/* 章节树用作者语言：「正文 › 卷01 › 第 1 章 雨夜」；资源管理器里才显示真实文件名。 */}
            <span className="min-w-0 flex-1 truncate">{resourceDisplayTitle(node)}</span>
            {stateBadge}
          </button>

          {/* 大纲节点一键提拔落稿到手稿章节；已落稿的条目不再重复提拔（T3 守卫） */}
          {isOutline && !isVolumeContainer && onAction && outlineState !== "drafted" ? (
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

type StorylineSubTab = "outline" | "memory";

// ---------------------------------------------------------------------------
// 推进驾驶舱：位置锚定 + NEXT 下一步
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
  readonly key: "outline-empty" | "promote-outline" | "review-pending" | "resettle-stale" | "next-chapter";
  readonly label: string;
  /** 点击后切到哪个 tab；undefined 表示叙述者 seed 动作或打开故事画布。 */
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
 * NEXT 规则：按序取第一个命中，永远只给一条建议。
 * 前四级是维护提醒：1 缺纲 → 叙述者 seed；2 有规划未落稿 → 提拔；3 有待审 → 章后事实；
 * 4 有记忆过期的章 → 章后事实重新结算。
 * 都没有时给「下一章写什么」——这一句只引用故事画布「下一章」页的计划（describeNextChapterSuggestion），
 * 侧栏不另算伏笔到期或下一章；计划还没读到时引导去画布看。
 */
export function resolveNextAction(input: {
  readonly hasOutline: boolean;
  readonly plannedCount: number;
  readonly pendingCount: number;
  /** 正文结算后又被改过的章数（记忆过期）。 */
  readonly staleCount?: number;
  /** 下一章计划的一句话建议（来自 next-chapter-plan）；计划未就绪时缺省。 */
  readonly nextChapterSuggestion?: string;
}): NextAction {
  if (!input.hasOutline) return { key: "outline-empty", label: "让叙述者生成第一卷卷纲" };
  if (input.plannedCount > 0) return { key: "promote-outline", tab: "outline", label: `提拔规划中的大纲落稿（${input.plannedCount} 条）` };
  if (input.pendingCount > 0) return { key: "review-pending", tab: "memory", label: `处理章后待审事件（${input.pendingCount} 条）` };
  if ((input.staleCount ?? 0) > 0) return { key: "resettle-stale", tab: "memory", label: `重新结算记忆过期的章节（${input.staleCount} 章）` };
  return { key: "next-chapter", label: input.nextChapterSuggestion ?? "打开故事画布，看下一章写什么" };
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
        title={next.label}
        className="w-full flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-left text-2xs text-foreground transition-colors hover:bg-primary/10"
      >
        <Sparkles className="size-3 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{next.label}</span>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
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
  onAction,
  onSendToNarrator,
  bookTargetChapters,
}: StorylineAndPlanningSidebarPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<StorylineSubTab>("outline");

  /** 打开统一的大屏「故事画布」：同一本书共用一个 Tab，落在「下一章」，其余视图在画布顶部切换。 */
  const openProgressionCanvas = () => {
    onOpen(createStoryProgressionNode(bookId, "next"));
  };

  const storyChapterNodes = useMemo(() => pruneStoryChapterTree(chapterTreeNodes), [chapterTreeNodes]);
  const orderedOutlineNodes = useMemo(() => orderOutlineTree(outlineTreeNodes), [outlineTreeNodes]);
  const outlineEntryCount = useMemo(() => countOutlineEntries(outlineTreeNodes), [outlineTreeNodes]);

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
  // 下一章建议只引用故事画布「下一章」页的同一份计划，不另算伏笔到期。
  const nextChapterPlan = useNextChapterPlan(bookId, currentChapter > 0 ? currentChapter : undefined);
  const reloadNextChapterPlan = nextChapterPlan.reload;
  useWritingProgressRefresh(bookId, () => {
    reloadNextChapterPlan();
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
  const nextChapterSuggestion = nextChapterPlan.plan ? describeNextChapterSuggestion(nextChapterPlan.plan) : undefined;
  const next = useMemo(
    () => resolveNextAction({
      hasOutline: outlineTreeNodes.length > 0,
      plannedCount,
      pendingCount,
      staleCount,
      ...(nextChapterSuggestion ? { nextChapterSuggestion } : {}),
    }),
    [outlineTreeNodes.length, plannedCount, pendingCount, staleCount, nextChapterSuggestion],
  );

  /** NEXT 卡点击的唯一入口：tab 类动作切 tab；叙述者 seed 动作一键发送；下一章建议打开画布「下一章」看全貌。 */
  const handleNextActivate = (action: NextAction) => {
    if (action.tab) {
      setActiveSubTab(action.tab);
      return;
    }
    if (action.key === "outline-empty") {
      void onSendToNarrator?.(OUTLINE_SEED_MESSAGE);
      return;
    }
    if (action.key === "next-chapter") openProgressionCanvas();
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
          {/* 原「故事画布」子页签点开只剩一段说明文字，改为一个明确的按钮：打开画布并落在「下一章」。 */}
          <Button
            size="xs"
            variant="outline"
            className="h-7 gap-1 text-2xs"
            title="在中央打开故事画布：下一章 / 推进 / 故事树"
            data-testid="storyline-open-canvas"
            onClick={openProgressionCanvas}
          >
            <MapIcon className="size-3.5 text-primary" />
            打开故事画布
          </Button>
        </div>

        {/* 2 个核心功能 Tab 切换（带明确的高亮状态） */}
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="xs"
            variant={activeSubTab === "outline" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-2xs font-medium transition-colors",
              activeSubTab === "outline" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => setActiveSubTab("outline")}
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
            onClick={() => setActiveSubTab("memory")}
          >
            <Sparkles className="size-3.5 text-amber-500" />
            <span className="truncate">章后事实</span>
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
              {/* 此前数的是顶层节点（「正文」目录 1 个、分类组 1 个），七章两条纲也显示「章节 1 · 大纲 1」。 */}
              <span className="text-2xs text-muted-foreground">章节 {draftedChapters.size} · 大纲 {outlineEntryCount}</span>
            </div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-2xs font-medium text-muted-foreground">章节树</div>
                <StorylineResourceTree nodes={storyChapterNodes} emptyLabel="暂无章节" onOpen={onOpen} onAction={onAction} />
              </div>
              <div>
                <div className="mb-1 text-2xs font-medium text-muted-foreground">大纲</div>
                <StorylineResourceTree nodes={orderedOutlineNodes} emptyLabel="暂无大纲条目" draftedChapters={draftedChapters} onOpen={onOpen} onAction={onAction} />
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

      </div>
    </div>
  );
}
