import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Crosshair,
  Dna,
  GitFork,
  History,
  Loader2,
  ScrollText,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { StoryMapNodeData } from "./StoryMapCanvas";
import { DevelopmentTimelineView } from "./development-timeline";

/** 故事地图体量大（React Flow），懒加载避免拖慢画布首帧。 */
const StoryMapCanvas = lazy(() =>
  import("./StoryMapCanvas").then((m) => ({ default: m.StoryMapCanvas })),
);

const ChronicleHelixCanvas = lazy(() =>
  import("./ChronicleHelixCanvas").then((m) => ({ default: m.ChronicleHelixCanvas })),
);

// ─── 视图定义 ─────────────────────────────────────────────────────────────

/**
 * 故事推进大屏画布的三种空间视图（IA 收敛后）：
 * - map       故事地图：章 × 线索情节板
 * - evolution 发展历程：叙事记忆时间线（只读聚合，默认 timeline）
 * - chronicle 编年史对照：表世界（章面）与里世界（角色内在）分轨对照
 *
 * 大纲总览已收敛至侧栏「章节与大纲」，不再是画布视图。
 * 世界网点云仍作为独立组件保留，不占用发展历程权威入口。
 */
export type StoryProgressionView = "map" | "evolution" | "chronicle";

export interface StoryProgressionViewDef {
  readonly id: StoryProgressionView;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const STORY_PROGRESSION_VIEWS: readonly StoryProgressionViewDef[] = [
  { id: "evolution", label: "发展历程", description: "动态事件与角色演化时间线", icon: History },
  { id: "chronicle", label: "双螺旋编年史", description: "里世界 / 表世界对照条", icon: Dna },
  { id: "map", label: "故事地图", description: "章 × 线索情节板", icon: GitFork },
] as const;

export function isStoryProgressionView(value: unknown): value is StoryProgressionView {
  return value === "map" || value === "evolution" || value === "chronicle";
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface StoryProgressionCanvasProps {
  readonly bookId: string;
  /** 初始视图；外部再次变更时会同步切换内部视图（侧栏跳转入口）。 */
  readonly initialView?: StoryProgressionView;
  /** 当前写作章节号（由宿主透传，用于徽标与发展历程定位）。 */
  readonly currentChapter?: number;
  readonly runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  /** 地图节点点击 → 跳转打开对应章节（与写作主面板协同）。 */
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 地图规划节点 → 提升为正式大纲条目/手稿章节。 */
  readonly onPromoteOutlineNode?: (node: StoryMapNodeData) => void;
  /** 发展历程节点点击 → 打开实体详情抽屉；带 entryId 时宿主可直接跳角色卡。 */
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 故事地图空态 → 把主支线梳理意图交给叙述者执行。 */
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function StoryProgressionCanvas({
  bookId,
  initialView = "evolution",
  currentChapter,
  runtimeFetch,
  onOpenChapter,
  onPromoteOutlineNode,
  onOpenEntityDetail,
  onSendToNarrator,
}: StoryProgressionCanvasProps) {
  // 顶层状态管理当前视图；initialView 变化时同步（侧栏跳转同一 tab 换视图）。
  const [view, setView] = useState<StoryProgressionView>(
    isStoryProgressionView(initialView) ? initialView : "evolution",
  );
  useEffect(() => {
    if (isStoryProgressionView(initialView)) setView(initialView);
  }, [initialView]);

  // 聚焦实体（标签栏）：作用于发展历程图谱聚焦。
  const [focusInput, setFocusInput] = useState("");
  const [appliedFocus, setAppliedFocus] = useState("");
  const applyFocus = useCallback(() => {
    setAppliedFocus(focusInput.trim());
  }, [focusInput]);

  // ── 视图渲染 ────────────────────────────────────────────────────────────

  if (!bookId) {
    return (
      <div className="flex h-full min-h-[80vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="story-progression-canvas">
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p>尚未绑定书籍，无法打开故事推进画布。</p>
        <p className="text-xs">请先在左侧选择一本书籍。</p>
      </div>
    );
  }

  const renderMapView = () => (
    <div className="h-full min-h-[80vh]" data-testid="story-progression-map">
      <Suspense
        fallback={
          <div className="flex h-full min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载故事地图…
          </div>
        }
      >
        {/* 只读画布：节点可拖拽/缩放/点击跳章，但停用连线手柄等写操作 */}
        <StoryMapCanvas
          bookId={bookId}
          runtimeFetch={runtimeFetch}
          onOpenChapter={onOpenChapter}
          onPromote={onPromoteOutlineNode}
          onSendToNarrator={onSendToNarrator}
        />
      </Suspense>
    </div>
  );

  const renderEvolutionView = () => (
    <div className="h-full min-h-[80vh]" data-testid="story-progression-evolution">
      {/* key 绑定聚焦实体：切换聚焦时重建工作区以应用 initialFocusEntity */}
      <DevelopmentTimelineView
        key={`evolution:${appliedFocus || "all"}`}
        bookId={bookId}
        currentChapter={currentChapter}
        frameClassName="h-full min-h-[80vh]"
        initialFocusEntity={appliedFocus || undefined}
        onOpenEntityDetail={onOpenEntityDetail}
        onOpenChapter={onOpenChapter}
      />
    </div>
  );

  const renderChronicleView = () => (
    <div className="h-full min-h-[80vh]" data-testid="story-progression-chronicle">
      <Suspense
        fallback={
          <div className="flex h-full min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在铺开里/表世界对照…
          </div>
        }
      >
        <ChronicleHelixCanvas
          bookId={bookId}
          currentChapter={currentChapter}
          onOpenEntityDetail={onOpenEntityDetail}
        />
      </Suspense>
    </div>
  );

  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="story-progression-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold">故事画布</span>
          <Badge variant="outline" data-testid="story-progression-chapter-badge">
            第 {currentChapter ?? "?"} 章
          </Badge>
        </div>
        <nav
          className="flex items-center gap-1 rounded-md bg-muted/60 p-1"
          role="tablist"
          aria-label="故事画布视图切换"
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
                  "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors " +
                  (active ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3 w-3" /> {def.label}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Input
            value={focusInput}
            onChange={(event) => setFocusInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFocus();
            }}
            placeholder="聚焦实体（角色 / 卷）"
            aria-label="聚焦实体"
            className="h-7 w-44 text-xs"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={applyFocus} disabled={!focusInput.trim()}>
            <Crosshair className="mr-1 h-3 w-3" /> 聚焦
          </Button>
          {appliedFocus && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setAppliedFocus("");
                setFocusInput("");
              }}
            >
              <X className="mr-1 h-3 w-3" /> 清除
            </Button>
          )}
        </div>
      </header>

      {/* 流视图高度标准：各视图统一 h-full + 80vh 下限；滚动收敛在视图体内 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {view === "map" ? renderMapView() : view === "chronicle" ? renderChronicleView() : renderEvolutionView()}
      </div>
    </section>
  );
}

export default StoryProgressionCanvas;
