import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  Dna,
  FolderTree,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  Network,
  ScrollText,
  Swords,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { StoryProgressBoard } from "./StoryProgressBoard";

const NextChapterPanel = lazy(() =>
  import("./NextChapterPanel").then((m) => ({ default: m.NextChapterPanel })),
);
const CanonicalTreesPanel = lazy(() =>
  import("./CanonicalTreesPanel").then((m) => ({ default: m.CanonicalTreesPanel })),
);
const WorkflowTimelinePanel = lazy(() =>
  import("./WorkflowTimelinePanel").then((m) => ({ default: m.WorkflowTimelinePanel })),
);

// ─── 视图定义 ─────────────────────────────────────────────────────────────

/**
 * 故事推进的视图（IA 重构）：
 *  - next      下一章（默认，主视觉）：一屏回答「下一章写什么」——焦点 + 建议 + 情节板 + 伏笔账本
 *  - board     推进：章 × 剧情线网格 + 下一章焦点 + 伏笔债务
 *  - tree      故事树（参考）：章节 / 因果 / 脉络 / 发展历程；世界观与人物关系在「作品基础」
 *  - workflow  执行：按创作工作流方案逐道工序推进本章
 *
 * 为什么主视觉不再是图：调研 Plottr / Arc Studio / Scrivener / Aeon / Twine 等后确认，
 * 线性叙事的「推进」主视觉几乎都是看板/章节网格（≈45%），力导向图当推进主视觉没有成功案例
 * ——图只在真·分支叙事和「角色关系」子视图里成立。故图整体降级到参考区。
 *
 * 原「发展历程」三层（事件流/关系演化/矛盾冲突）已从推进页移除：
 * 它们是叙事记忆的浏览视图，归 NarrativeMemoryPanel，不回答「下一章写什么」。
 */
export type StoryProgressionView = "next" | "board" | "tree" | "workflow";

export interface StoryProgressionViewDef {
  readonly id: StoryProgressionView;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const STORY_PROGRESSION_VIEWS: readonly StoryProgressionViewDef[] = [
  { id: "next", label: "下一章", description: "一屏回答「下一章写什么」：焦点 + 建议 + 情节板 + 伏笔账本", icon: Swords },
  { id: "board", label: "推进", description: "章 × 剧情线网格，含下一章该写什么", icon: LayoutGrid },
  { id: "tree", label: "故事树", description: "章节 / 因果 / 脉络 / 发展历程（世界观与人物关系在「作品基础」）", icon: FolderTree },
  // 工作流的归宿：它回答的是「这一章按什么工序推进」，属于推进镜头，不是一个可选分析工具。
  { id: "workflow", label: "执行", description: "按创作工作流方案逐道工序推进本章", icon: Workflow },
] as const;

const PROGRESSION_TREE_KINDS: readonly import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind[] = [
  "chapters",
  "causal",
  "chronicle",
  "timeline",
] as const;

export const LEGACY_VIEW_TARGETS: Record<string, { view: StoryProgressionView; treeKind?: import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind }> = {
  board: { view: "board" },
  tree: { view: "tree", treeKind: "chapters" },
  timeline: { view: "tree", treeKind: "timeline" },
  evolution: { view: "tree", treeKind: "timeline" },
  chronicle: { view: "tree", treeKind: "chronicle" },
  network: { view: "tree", treeKind: "causal" },
  map: { view: "tree", treeKind: "causal" },
  outline: { view: "tree", treeKind: "chapters" },
};

export function isStoryProgressionView(value: unknown): value is StoryProgressionView {
  return value === "next" || value === "tree" || value === "board" || value === "workflow";
}

/** 兼容旧的 initialView 取值；非法或缺省进「下一章」整合页。 */
export function normalizeStoryProgressionView(value: unknown): StoryProgressionView {
  if (isStoryProgressionView(value)) return value;
  if (typeof value === "string" && LEGACY_VIEW_TARGETS[value]) return LEGACY_VIEW_TARGETS[value].view;
  return "next";
}

export function resolveInitialTreeKind(value: unknown): import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind | undefined {
  if (typeof value === "string" && LEGACY_VIEW_TARGETS[value]) return LEGACY_VIEW_TARGETS[value].treeKind;
  return undefined;
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface StoryProgressionCanvasProps {
  readonly bookId: string;
  /** 初始视图；外部再次变更时会同步切换内部视图（侧栏跳转入口）。 */
  /** 初始视图；缺省进故事树。 */
  readonly initialView?: StoryProgressionView | string;
  /** 当前写作章节号（由宿主透传）。 */
  readonly currentChapter?: number;
  /** 节点/格子点击 → 跳转打开对应章节（与写作主面板协同）。 */
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 打开实体详情抽屉；带 entryId 时宿主可直接跳经纬条目卡。 */
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 把意图交给叙述者执行（规划下一章 / 补缺失线索）。 */
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 当前打开的本书叙述者会话；「执行」视图的工作流作用在它身上。 */
  readonly narratorId?: string;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function StoryProgressionCanvas({
  bookId,
  initialView = "tree",
  currentChapter,
  onOpenChapter,
  onOpenEntityDetail,
  onSendToNarrator,
  narratorId,
}: StoryProgressionCanvasProps) {
  const [view, setView] = useState<StoryProgressionView>(() => normalizeStoryProgressionView(initialView));
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    setView(normalizeStoryProgressionView(initialView));
  }, [initialView]);

  // Esc 退出全景
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const openEntityDetail = useCallback(
    (entity: string, entryId?: string) => onOpenEntityDetail?.(entity, entryId),
    [onOpenEntityDetail],
  );

  if (!bookId) {
    return (
      <div
        className="flex h-full min-h-[80vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
        data-testid="story-progression-canvas"
      >
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p>尚未绑定书籍，无法打开故事推进。</p>
        <p className="text-xs">请先在左侧选择一本书籍。</p>
      </div>
    );
  }

  const fallback = (label: string) => (
    <div className="flex h-full min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );

  return (
    <section
      className={
        fullscreen
          ? "fixed inset-0 z-[80] flex flex-col bg-background"
          : "flex h-full min-h-0 flex-col"
      }
      data-testid="story-progression-canvas"
      data-fullscreen={fullscreen ? "true" : "false"}
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold">故事推进</span>
          <Badge variant="outline" data-testid="story-progression-chapter-badge">
            第 {currentChapter ?? "?"} 章
          </Badge>
        </div>

        <nav
          className="flex items-center gap-1 rounded-md bg-muted/60 p-1"
          role="tablist"
          aria-label="故事推进视图切换"
        >
          {STORY_PROGRESSION_VIEWS.map((def) => {
            const Icon = def.icon;
            const active = view === def.id;
            return (
              <button
                key={def.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={def.description}
                onClick={() => setView(def.id)}
                className={
                  "flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors "
                  + (active ? "bg-background font-medium shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" /> {def.label}
              </button>
            );
          })}
        </nav>

        <Button
          size="xs"
          variant={fullscreen ? "default" : "outline"}
          className="ml-auto h-7 gap-1 text-xs"
          title={fullscreen ? "退出全景（Esc）" : "进入全景模式"}
          data-testid="story-progression-fullscreen"
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          {fullscreen ? "退出全景" : "全景"}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2" data-testid="story-progression-viewport">
        {view === "next" ? (
          <div className="h-full min-h-0 overflow-y-auto" data-testid="story-progression-next">
            <Suspense fallback={fallback("正在组装下一章计划…")}>
              <NextChapterPanel
                bookId={bookId}
                {...(currentChapter !== undefined ? { currentChapter } : {})}
                {...(onOpenChapter ? { onOpenChapter } : {})}
                {...(onSendToNarrator ? { onSendToNarrator } : {})}
              />
            </Suspense>
          </div>
        ) : view === "board" ? (
          <div className="h-full min-h-0" data-testid="story-progression-board">
            <StoryProgressBoard
              bookId={bookId}
              {...(currentChapter !== undefined ? { currentChapter } : {})}
              {...(onOpenChapter ? { onOpenChapter } : {})}
              {...(onOpenEntityDetail ? { onOpenEntityDetail: openEntityDetail } : {})}
              {...(onSendToNarrator ? { onSendToNarrator } : {})}
              compactHeader={fullscreen}
            />
          </div>
        ) : view === "workflow" ? (
          <div className="h-full min-h-0 overflow-y-auto" data-testid="story-progression-workflow">
            <Suspense fallback={fallback("正在载入工作流…")}>
              <WorkflowTimelinePanel
                bookId={bookId}
                {...(currentChapter !== undefined ? { currentChapter } : {})}
                {...(onSendToNarrator ? { onSendToNarrator } : {})}
                {...(narratorId ? { narratorId } : {})}
              />
            </Suspense>
          </div>
        ) : (
          <div className="h-full min-h-0" data-testid="story-progression-tree">
            <Suspense fallback={fallback("正在铺开正图…")}>
              <CanonicalTreesPanel
                bookId={bookId}
                kinds={PROGRESSION_TREE_KINDS}
                initialKind={resolveInitialTreeKind(initialView)}
                {...(onOpenEntityDetail
                  ? { onOpenEntry: (entryId: string, label: string) => openEntityDetail(label, entryId) }
                  : {})}
                {...(onOpenChapter ? { onOpenChapter } : {})}
                {...(onSendToNarrator ? { onSendToNarrator } : {})}
              />
            </Suspense>
          </div>
        )}
      </div>
    </section>
  );
}

export default StoryProgressionCanvas;
