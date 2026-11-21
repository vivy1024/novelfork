import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  FolderTree,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { StoryProgressBoard } from "./StoryProgressBoard";

const CanonicalTreesPanel = lazy(() =>
  import("./CanonicalTreesPanel").then((m) => ({ default: m.CanonicalTreesPanel })),
);
const OutlineOverviewPanel = lazy(() =>
  import("./OutlineOverviewPanel").then((m) => ({ default: m.OutlineOverviewPanel })),
);

// ─── 视图定义 ─────────────────────────────────────────────────────────────

/**
 * 故事画布的视图：聚焦全局叙事结构，去除与写作台/AI 筹备台重复的「写下一章/推荐」页。
 *  - overview  大纲总览（默认）：分卷大纲进度点亮总览，直达章节与推进网格
 *  - board     推进网格：章 × 剧情线网格 + 张力曲线 + 伏笔债务账本
 *  - tree      故事树：发展历程 / 因果树（世界观与人物关系在「作品基础」）
 */
export type StoryProgressionView = "overview" | "board" | "tree";

type CanonicalTreeKind = import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind;

export interface StoryProgressionViewDef {
  readonly id: StoryProgressionView;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const STORY_PROGRESSION_VIEWS: readonly StoryProgressionViewDef[] = [
  { id: "overview", label: "大纲总览", description: "分卷大纲进度点亮总览，直达章节与卷纲规划", icon: ScrollText },
  { id: "board", label: "推进网格", description: "章 × 剧情线推进网格与伏笔债务账本", icon: LayoutGrid },
  { id: "tree", label: "故事树", description: "发展历程 / 因果脉络树（世界观与人物关系在「作品基础」）", icon: FolderTree },
] as const;

const PROGRESSION_TREE_KINDS: readonly import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind[] = [
  "chronicle",
  "causal",
] as const;

export const LEGACY_VIEW_TARGETS: Record<string, { view: StoryProgressionView; treeKind?: import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind }> = {
  // 旧的「下一章」与「执行」入口统一平滑落到「大纲总览」，不白屏
  next: { view: "overview" },
  workflow: { view: "overview" },
  overview: { view: "overview" },
  board: { view: "board" },
  tree: { view: "tree", treeKind: "chronicle" },
  timeline: { view: "tree", treeKind: "chronicle" },
  evolution: { view: "tree", treeKind: "chronicle" },
  chronicle: { view: "tree", treeKind: "chronicle" },
  network: { view: "tree", treeKind: "causal" },
  map: { view: "tree", treeKind: "causal" },
  outline: { view: "tree", treeKind: "chronicle" },
  chapters: { view: "tree", treeKind: "chronicle" },
};

export function isStoryProgressionView(value: unknown): value is StoryProgressionView {
  return value === "overview" || value === "board" || value === "tree";
}

/** 兼容旧的 initialView 取值；非法或缺省进「大纲总览」。 */
export function normalizeStoryProgressionView(value: unknown): StoryProgressionView {
  if (isStoryProgressionView(value)) return value;
  if (typeof value === "string" && LEGACY_VIEW_TARGETS[value]) return LEGACY_VIEW_TARGETS[value].view;
  return "overview";
}

export function resolveInitialTreeKind(value: unknown): import("../../engine/narrative-taxonomy/canonical-trees").CanonicalTreeKind | undefined {
  if (typeof value === "string" && LEGACY_VIEW_TARGETS[value]) return LEGACY_VIEW_TARGETS[value].treeKind;
  return undefined;
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface StoryProgressionCanvasProps {
  readonly bookId: string;
  /** 初始视图；外部再次变更时会同步切换内部视图（侧栏跳转入口）。缺省进「大纲总览」。 */
  readonly initialView?: StoryProgressionView | string;
  /** 当前写作章节号（由宿主透传）。 */
  readonly currentChapter?: number;
  /** 节点/格子点击 → 跳转打开对应章节（与写作主面板协同）。 */
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 兼容保留，画布本身不再堆砌重复的「写下一章」主按钮。 */
  readonly onOpenWriteView?: () => void;
  /** 打开实体详情抽屉；带 entryId 时宿主可直接跳经纬条目卡。 */
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 把意图交给叙述者执行（起草卷纲 / 补缺失线索）。 */
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function StoryProgressionCanvas({
  bookId,
  initialView = "overview",
  currentChapter,
  onOpenChapter,
  onOpenEntityDetail,
  onSendToNarrator,
}: StoryProgressionCanvasProps) {
  const [view, setView] = useState<StoryProgressionView>(() => normalizeStoryProgressionView(initialView));
  const [fullscreen, setFullscreen] = useState(false);
  const [treeKindOverride, setTreeKindOverride] = useState<CanonicalTreeKind | undefined>(undefined);

  useEffect(() => {
    setView(normalizeStoryProgressionView(initialView));
    setTreeKindOverride(undefined);
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
        className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
        data-testid="story-progression-canvas"
      >
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p>尚未绑定书籍，无法打开故事画布。</p>
        <p className="text-xs">请先在左侧选择一本书籍。</p>
      </div>
    );
  }

  const fallback = (label: string) => (
    <div className="flex h-full min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
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
        <div className="flex shrink-0 items-center gap-2">
          <ScrollText className="h-4 w-4 shrink-0 text-success" />
          <span className="whitespace-nowrap text-sm font-semibold">故事画布</span>
          <Badge variant="outline" className="shrink-0 whitespace-nowrap tabular-nums" data-testid="story-progression-chapter-badge">
            第 {currentChapter ?? "?"} 章
          </Badge>
        </div>

        <nav
          className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 p-1"
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
                  "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded px-2.5 text-xs transition-colors "
                  + (active ? "bg-background font-medium shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{def.label}</span>
              </button>
            );
          })}
        </nav>

        <Button
          size="xs"
          variant={fullscreen ? "default" : "outline"}
          className="ml-auto h-7 shrink-0 gap-1 whitespace-nowrap px-2.5 text-xs"
          title={fullscreen ? "退出全景（Esc）" : "进入全景模式"}
          data-testid="story-progression-fullscreen"
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          <span>{fullscreen ? "退出全景" : "全景"}</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2" data-testid="story-progression-viewport">
        {view === "overview" ? (
          <div className="h-full min-h-0 overflow-y-auto" data-testid="story-progression-overview">
            <Suspense fallback={fallback("正在加载大纲总览…")}>
              <OutlineOverviewPanel
                bookId={bookId}
                {...(currentChapter !== undefined ? { currentChapter } : {})}
                {...(onOpenChapter ? { onOpenChapter } : {})}
                onOpenBoardProgress={() => setView("board")}
                onOpenStoryTree={() => { setTreeKindOverride("chronicle"); setView("tree"); }}
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
              hideNextChapterCard
            />
          </div>
        ) : (
          <div className="h-full min-h-0" data-testid="story-progression-tree">
            <Suspense fallback={fallback("正在铺开正图…")}>
              <CanonicalTreesPanel
                bookId={bookId}
                kinds={PROGRESSION_TREE_KINDS}
                initialKind={treeKindOverride ?? resolveInitialTreeKind(initialView)}
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
