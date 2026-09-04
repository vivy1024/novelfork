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
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { StoryProgressBoard } from "./StoryProgressBoard";

const CanonicalTreesPanel = lazy(() =>
  import("./CanonicalTreesPanel").then((m) => ({ default: m.CanonicalTreesPanel })),
);

// ─── 视图定义 ─────────────────────────────────────────────────────────────

/**
 * 故事推进的视图分两层（IA 重构）：
 *  - board     推进（默认，主视觉）：章 × 剧情线网格 + 下一章焦点 + 伏笔债务
 *  - chronicle 章节脉络（参考）：表/里世界分枝树
 *  - network   关系网（参考）：共现关系树
 *
 * 为什么主视觉不再是图：调研 Plottr / Arc Studio / Scrivener / Aeon / Twine 等后确认，
 * 线性叙事的「推进」主视觉几乎都是看板/章节网格（≈45%），力导向图当推进主视觉没有成功案例
 * ——图只在真·分支叙事和「角色关系」子视图里成立。故图整体降级到参考区。
 *
 * 原「发展历程」三层（事件流/关系演化/矛盾冲突）已从推进页移除：
 * 它们是叙事记忆的浏览视图，归 NarrativeMemoryPanel，不回答「下一章写什么」。
 */
export type StoryProgressionView = "tree" | "board" | "chronicle" | "network" | "timeline";

export interface StoryProgressionViewDef {
  readonly id: StoryProgressionView;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  /** 参考视图不是主视觉，UI 上分组显示。 */
  readonly reference?: boolean;
}

export const STORY_PROGRESSION_VIEWS: readonly StoryProgressionViewDef[] = [
  { id: "tree", label: "故事树", description: "世界观 / 关系树 / 章节 / 发展历程 / 脉络 / 总图", icon: FolderTree },
  { id: "board", label: "推进", description: "章 × 剧情线网格，含下一章该写什么", icon: LayoutGrid },
  { id: "timeline", label: "发展历程", description: "按章看已经发生的事", icon: Clock, reference: true },
  { id: "chronicle", label: "章节脉络", description: "表世界摘要与里世界角色变化", icon: Dna, reference: true },
  { id: "network", label: "关系网", description: "按共现枢纽展开的关系树", icon: Network, reference: true },
] as const;

const LEGACY_VIEW_ALIASES: Record<string, StoryProgressionView> = {
  map: "network",
  evolution: "timeline",
  outline: "tree",
};

export function isStoryProgressionView(value: unknown): value is StoryProgressionView {
  return value === "tree" || value === "board" || value === "chronicle" || value === "network" || value === "timeline";
}

/** 兼容旧的 initialView 取值（历史侧栏入口可能仍传 map/evolution）。 */
export function normalizeStoryProgressionView(value: unknown): StoryProgressionView {
  if (isStoryProgressionView(value)) return value;
  if (typeof value === "string" && LEGACY_VIEW_ALIASES[value]) return LEGACY_VIEW_ALIASES[value]!;
  return "tree";
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
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function StoryProgressionCanvas({
  bookId,
  initialView = "tree",
  currentChapter,
  onOpenChapter,
  onOpenEntityDetail,
  onSendToNarrator,
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
          {STORY_PROGRESSION_VIEWS.map((def, index) => {
            const Icon = def.icon;
            const active = view === def.id;
            const firstReference = def.reference && !STORY_PROGRESSION_VIEWS[index - 1]?.reference;
            return (
              <span key={def.id} className="flex items-center gap-1">
                {/* 分隔符明确区分主视觉与参考视图 */}
                {firstReference ? (
                  <span className="mx-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="h-4 w-px bg-border" aria-hidden />
                    参考
                  </span>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={def.description}
                  onClick={() => setView(def.id)}
                  className={
                    "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors "
                    + (active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  <Icon className="h-3 w-3" /> {def.label}
                </button>
              </span>
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
        {view === "tree" ? (
          <div className="h-full min-h-0" data-testid="story-progression-tree">
            <Suspense fallback={fallback("正在铺开正图…")}>
              <CanonicalTreesPanel
                bookId={bookId}
                {...(onOpenEntityDetail
                  ? { onOpenEntry: (entryId: string, label: string) => openEntityDetail(label, entryId) }
                  : {})}
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
        ) : view === "timeline" ? (
          <div className="h-full min-h-0" data-testid="story-progression-timeline">
            <Suspense fallback={fallback("正在铺开发展历程树…")}>
              <CanonicalTreesPanel
                bookId={bookId}
                initialKind="timeline"
                showSwitcher={false}
                {...(onOpenEntityDetail
                  ? { onOpenEntry: (entryId: string, label: string) => openEntityDetail(label, entryId) }
                  : {})}
                {...(onOpenChapter ? { onOpenChapter } : {})}
                {...(onSendToNarrator ? { onSendToNarrator } : {})}
              />
            </Suspense>
          </div>
        ) : view === "chronicle" ? (
          <div className="h-full min-h-0" data-testid="story-progression-chronicle">
            <Suspense fallback={fallback("正在铺开章节脉络树…")}>
              <CanonicalTreesPanel
                bookId={bookId}
                initialKind="chronicle"
                showSwitcher={false}
                {...(onOpenEntityDetail
                  ? { onOpenEntry: (entryId: string, label: string) => openEntityDetail(label, entryId) }
                  : {})}
                {...(onOpenChapter ? { onOpenChapter } : {})}
                {...(onSendToNarrator ? { onSendToNarrator } : {})}
              />
            </Suspense>
          </div>
        ) : (
          <div className="h-full min-h-0" data-testid="story-progression-network">
            <Suspense fallback={fallback("正在铺开关系树…")}>
              <CanonicalTreesPanel
                bookId={bookId}
                initialKind="relations"
                showSwitcher={false}
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

      {view === "chronicle" || view === "network" || view === "timeline" ? (
        <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            这是参考视图，回答「已经写了什么」。看层级结构用故事树，看「下一章该写什么」用推进。
          </span>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto h-6 px-1.5 text-[10px]"
            data-testid="story-progression-back-to-board"
            onClick={() => setView("tree")}
          >
            回到故事树
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

export default StoryProgressionCanvas;
