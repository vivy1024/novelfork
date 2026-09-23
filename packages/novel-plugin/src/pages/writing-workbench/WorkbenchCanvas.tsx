import { useCallback, useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import {
  countChapterLength,
  resolveLengthCountingMode,
  type LengthLanguage,
} from "@vivy1024/novelfork-core/utils/length-metrics";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Save, FileText, AlertCircle, Loader2, GitCompare, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { fetchJson } from "@/hooks/use-api";
import { resourceNeedsDetailHydration } from "./ResourceDetailLoader";
import { ResourceViewer } from "./resource-viewers";
import { summarizeStyleProfile } from "./resource-viewers/style-profile-summary";
import { isChapterWorkflowNode } from "./chapter-workflow-node";
import { ChapterActionsBar } from "./ChapterActionsBar";
import { ResourceHistoryPanel, type ResourceHistoryEntry } from "./ResourceHistoryPanel";
import { saveEditorState, getEditorState } from "./ide/editor-state-cache";

import { JingweiEntryEditor, type JingweiEntrySavePayload } from "./JingweiEntryEditor";
import { ChapterContextRail } from "./ChapterContextRail";
import { NewBookGuide, type GuidedSetupOutcome } from "./NewBookGuide";
import { StatusBar } from "./StatusBar";
import { ChapterToolbar } from "./ChapterToolbar";
import { QualityCenterPanel } from "./panels/QualityCenterPanel";
import { QualityPanel } from "./panels/QualityPanel";
import type { ToolPanelId } from "./useWorkbenchResources";
import { GovernanceCockpitPanel } from "./GovernanceCockpitPanel";

// 作品基础只看设定类的树；结构类的树归故事推进（见 StoryProgressionCanvas 的 PROGRESSION_TREE_KINDS）。
const LORE_TREE_KINDS = ["worldview", "relations"] as const;

// Lazy-loaded tool panels
const StoryProgressionCanvas = lazy(() => import("./StoryProgressionCanvas").then(m => ({ default: m.StoryProgressionCanvas })));
const CanonicalTreesPanel = lazy(() => import("./CanonicalTreesPanel").then(m => ({ default: m.CanonicalTreesPanel })));
const NarrativeMemoryPanel = lazy(() => import("./NarrativeMemoryPanel").then(m => ({ default: m.NarrativeMemoryPanel })));
const CharacterArcsPanel = lazy(() => import("./CharacterArcsPanel").then(m => ({ default: m.CharacterArcsPanel })));
const TensionCurvePanel = lazy(() => import("./TensionCurvePanel").then(m => ({ default: m.TensionCurvePanel })));
const ChapterSettlementBanner = lazy(() => import("./ChapterSettlementBanner").then(m => ({ default: m.ChapterSettlementBanner })));
const CompliancePanel = lazy(() => import("./CompliancePanel").then(m => ({ default: m.CompliancePanel })));
const ForeshadowingBoard = lazy(() => import("./ForeshadowingBoard").then(m => ({ default: m.ForeshadowingBoard })));
const RuntimeStatePanel = lazy(() => import("./RuntimeStatePanel").then(m => ({ default: m.RuntimeStatePanel })));
const CoreShiftPanel = lazy(() => import("./CoreShiftPanel").then(m => ({ default: m.CoreShiftPanel })));
const CollaborationVersionPanel = lazy(() => import("./CollaborationVersionPanel").then(m => ({ default: m.CollaborationVersionPanel })));
const CharacterCardPage = lazy(() => import("./CharacterCardPage").then(m => ({ default: m.CharacterCardPage })));
import { VariantsPanel } from "./VariantsPanel";
import { SceneSpecPanel, type SceneSpec } from "./SceneSpecPanel";
import type { CanvasContext, OpenResourceTab, WorkspaceResourceRef, WorkspaceResourceViewKind } from "@/shared/agent-native-workspace";
import { createStoryProgressionNode, type WorkbenchResourceKind, type WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WorkbenchCanvasContext extends CanvasContext {
  activeResourceId: string | null;
  activeKind: WorkbenchResourceKind | null;
  dirty: boolean;
  contentPreview: string;
}

function toWorkspaceResourceRef(node: WorkbenchResourceNode): WorkspaceResourceRef {
  return {
    kind: node.kind,
    id: node.id,
    title: node.title,
    path: node.path,
    ...(typeof node.metadata?.bookId === "string" ? { bookId: node.metadata.bookId } : {}),
  };
}

function toResourceViewKind(kind: WorkbenchResourceKind): WorkspaceResourceViewKind {
  switch (kind) {
    case "chapter":
      return "chapter-editor";
    case "story":
    case "jingwei":
      return "markdown-viewer";
    case "jingwei-section":
      return "jingwei-category-view";
    case "jingwei-entry":
      return "jingwei-entry-editor";
    case "narrative-line":
    case "storyline":
      return "narrative-line";
    case "tool-result":
      return "tool-result";
    default:
      return "unsupported";
  }
}

function toOpenResourceTab(node: WorkbenchResourceNode, dirty: boolean): OpenResourceTab {
  return {
    id: node.id,
    nodeId: node.id,
    kind: toResourceViewKind(node.kind),
    title: node.title,
    dirty,
    source: "user",
  };
}

function saveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const resourceTypeLabels: Partial<Record<WorkbenchResourceKind, string>> = {
  chapter: "章节",
  story: "大纲与设定",
  jingwei: "经纬资料",
  "jingwei-section": "经纬分区",
  "jingwei-entry": "经纬条目",
  "narrative-line": "叙事线",
  storyline: "叙事线",
  "tool-result": "工具结果",
  tool: "工具",
  unsupported: "不支持",
};

function resourceTypeLabel(kind: WorkbenchResourceKind): string {
  return resourceTypeLabels[kind] ?? kind;
}

function asFinitePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function countEditorWords(text: string, language: LengthLanguage): number {
  return countChapterLength(text, resolveLengthCountingMode(language));
}

function resolveBookLanguage(nodes: readonly WorkbenchResourceNode[]): LengthLanguage {
  const book = asRecord(nodes.find((candidate) => candidate.kind === "book")?.metadata?.book);
  return book?.language === "en" ? "en" : "zh";
}

function resolveBookPlatform(nodes: readonly WorkbenchResourceNode[]): string | undefined {
  const book = asRecord(nodes.find((candidate) => candidate.kind === "book")?.metadata?.book);
  return typeof book?.platform === "string" ? book.platform : undefined;
}

function resolveChapterWordTarget(node: WorkbenchResourceNode, nodes: readonly WorkbenchResourceNode[], sceneSpec: SceneSpec | null): number | undefined {
  if (sceneSpec?.wordTarget) return sceneSpec.wordTarget;
  const metadata = node.metadata ?? {};
  const telemetry = asRecord(metadata.lengthTelemetry);
  const book = asRecord(nodes.find((candidate) => candidate.kind === "book")?.metadata?.book);
  return asFinitePositiveNumber(metadata.wordTarget)
    ?? asFinitePositiveNumber(metadata.chapterTarget)
    ?? asFinitePositiveNumber(telemetry?.target)
    ?? asFinitePositiveNumber(book?.chapterWordCount);
}

function ChapterStatusBar({
  chapterNumber,
  content,
  targetWords,
  language,
  sceneSpec,
  onOpenBlueprint,
}: {
  chapterNumber?: number;
  content: string;
  targetWords?: number;
  language: LengthLanguage;
  sceneSpec: SceneSpec | null;
  onOpenBlueprint: () => void;
}) {
  const wordCount = countEditorWords(content, language);
  const unit = language === "en" ? "words" : "字";
  const delta = typeof targetWords === "number" ? wordCount - targetWords : undefined;
  const targetLabel = typeof targetWords === "number" ? `${targetWords.toLocaleString()} ${unit}` : "未设置";
  const progressLabel = typeof delta === "number"
    ? delta === 0 ? "正好达到目标" : delta > 0 ? `超出 ${delta.toLocaleString()} ${unit}` : `还差 ${Math.abs(delta).toLocaleString()} ${unit}`
    : "暂无目标字数";

  return (
    <div data-testid="chapter-status-bar" className="shrink-0 border-b border-border/70 bg-muted/20 px-4 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        {typeof chapterNumber === "number" ? <span>第 {chapterNumber} 章</span> : null}
        <span>蓝图：</span>
        {sceneSpec ? (
          <button type="button" className="font-medium text-primary hover:underline" onClick={onOpenBlueprint}>
            已生成 · {sceneSpec.scenes.length} 场
          </button>
        ) : (
          <span>未生成</span>
        )}
        <span>正文 {wordCount.toLocaleString()} / 目标 {targetLabel}</span>
        <Badge variant="outline" className="h-4 px-1.5 text-2xs">{progressLabel}</Badge>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolPanelView — renders tool panel content in the canvas area
// ---------------------------------------------------------------------------

function ToolPanelLoading() {
  return <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}

/**
 * 本书当前（最大已完成）章号。权威源是资源树：book 节点带后端算出的 nextChapter
 * （GET /api/books/:bookId 用最大章号 + 1），退化时用 chapter 节点的最大 chapterNumber。
 * 两者都拿不到时返回 undefined —— 伏笔看板会显式显示「悬念未知」，不能编默认值。
 */
export function resolveCurrentChapter(nodes: readonly WorkbenchResourceNode[] | undefined): number | undefined {
  if (!nodes || nodes.length === 0) return undefined;
  let maxChapter = 0;
  let nextChapter: number | undefined;
  const walk = (node: WorkbenchResourceNode) => {
    if (node.kind === "book") {
      const raw = Number(node.metadata?.nextChapter);
      if (Number.isSafeInteger(raw) && raw > 0) nextChapter = raw;
    }
    const chapterNumber = Number(node.metadata?.chapterNumber);
    if (Number.isSafeInteger(chapterNumber) && chapterNumber > maxChapter) maxChapter = chapterNumber;
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  if (maxChapter > 0) return maxChapter;
  // nextChapter = 最大章号 + 1；只有 nextChapter 时反推已完成章号。
  if (nextChapter !== undefined && nextChapter > 1) return nextChapter - 1;
  return undefined;
}

function ToolPanelView({ toolPanel, bookId, bookPlatform, repositoryPath, currentChapter, onJumpToChapter, onOpenJingweiEntry, onSendToNarrator }: { toolPanel: ToolPanelId; bookId: string; bookPlatform?: string; repositoryPath?: string; currentChapter?: number; onJumpToChapter?: (chapterNumber: number) => void; onOpenJingweiEntry?: (entryId: string) => boolean; onSendToNarrator?: (message: string) => Promise<void> | void }) {
  switch (toolPanel) {
    // 工作流不再是工具面板：它的唯一入口是「故事推进 › 执行」。
    case "quality":
      return (
        <Suspense fallback={<ToolPanelLoading />}>
          <QualityCenterPanel
            bookId={bookId}
            currentChapter={currentChapter}
            onJumpToChapter={onJumpToChapter}
            onOpenJingweiEntry={onOpenJingweiEntry}
          />
        </Suspense>
      );
    case "tension":
      return <Suspense fallback={<ToolPanelLoading />}><TensionCurvePanel bookId={bookId} onJumpToChapter={onJumpToChapter} /></Suspense>;
    case "arcs":
      return <Suspense fallback={<ToolPanelLoading />}><CharacterArcsPanel bookId={bookId} onClose={() => {}} /></Suspense>;
    case "compliance":
      return <Suspense fallback={<ToolPanelLoading />}><CompliancePanel bookId={bookId} bookPlatform={bookPlatform} onClose={() => {}} /></Suspense>;
    case "foreshadowing":
      return <Suspense fallback={<ToolPanelLoading />}><ForeshadowingBoard bookId={bookId} currentChapter={currentChapter} onJumpToChapter={onJumpToChapter} /></Suspense>;
    case "governance":
      return <GovernanceCockpitPanel bookId={bookId} />;
    case "runtime":
      return <Suspense fallback={<ToolPanelLoading />}><RuntimeStatePanel bookId={bookId} /></Suspense>;
    case "coreshift":
      return <Suspense fallback={<ToolPanelLoading />}><CoreShiftPanel bookId={bookId} /></Suspense>;
    case "collaboration-version":
      return <Suspense fallback={<ToolPanelLoading />}><CollaborationVersionPanel bookId={bookId} repositoryPath={repositoryPath} /></Suspense>;
    default:
      return <div className="p-4 text-muted-foreground">未知工具面板</div>;
  }
}

export interface ChapterActionHandlers {
  onGetHistory: (resourceId: string) => Promise<ResourceHistoryEntry[]>;
  onDelete?: (resourceId: string) => Promise<void>;
}

export interface JingweiActionHandlers {
  onSave: (entryId: string, payload: JingweiEntrySavePayload) => Promise<void>;
  onDelete?: (entryId: string) => Promise<void>;
}

export interface WorkbenchCanvasProps {
  node: WorkbenchResourceNode | null;
  nodes?: readonly WorkbenchResourceNode[];
  bookId?: string;
  repositoryPath?: string;
  runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  onGuideComplete?: (outcome?: GuidedSetupOutcome) => void;
  chapterActions?: ChapterActionHandlers;
  jingweiActions?: JingweiActionHandlers;
  /** 外部容器 ref，操作按钮通过 portal 渲染到此处（IDE 模式用） */
  toolbarSlotRef?: RefObject<HTMLDivElement | null>;
  /** 当前 canvas 是否为激活状态（多实例模式下控制 portal 行为） */
  isActive?: boolean;
  /** 工具面板（如伏笔看板）跳转到指定章节，由上层打开对应章节 Tab */
  onJumpToChapter?: (chapterNumber: number) => void;
  /** 关联条目跳转；返回 false 表示目标资源不存在。 */
  onOpenJingweiEntry?: (entryId: string) => boolean;
  /** 图谱节点打开实体详情抽屉。 */
  onOpenEntityDetail?: (entity: string) => void;
  /** 大纲/规划节点一键提拔落稿为手稿章节 */
  onPromoteOutline?: (node: WorkbenchResourceNode) => void;
  /**
   * 章后事实面板的轻量跳转通道：打开发展历程（故事画布）/伏笔账本等合成节点。
   * 由宿主传入 handleOpen，保证跳转走统一的 Tab 打开链路。
   */
  onOpenResourceNode?: (node: WorkbenchResourceNode) => void;
  /**
   * 选段语义动作（续写/润色/改写/扩写/精简）的执行通道。
   * 产品 HTTP 适配层没有 Provider，这类动作必须由 Runtime 的叙述者执行。
   */
  onSendToNarrator?: (message: string) => Promise<void> | void;
}

export function WorkbenchCanvas({ node, nodes = [], bookId, repositoryPath, runtimeFetch, onSave, onCanvasContextChange = () => undefined, onGuideComplete, chapterActions, jingweiActions, toolbarSlotRef, isActive = true, onJumpToChapter, onOpenJingweiEntry, onOpenEntityDetail, onPromoteOutline, onSendToNarrator, onOpenResourceNode }: WorkbenchCanvasProps) {
  const [content, setContent] = useState(node?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ResourceHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [sceneSpecOpen, setSceneSpecOpen] = useState(false);
  const [sceneSpec, setSceneSpec] = useState<SceneSpec | null>(null);
  const [sceneSpecLoading, setSceneSpecLoading] = useState(false);
  const [contextRailOpen, setContextRailOpen] = useState(true);
  // TipTap 可能规范化 markdown，但 dirty 基准必须始终从当前资源正文开始，
  // 不能把第一次真实编辑误当成规范化基准值。
  const normalizedBaseRef = useRef(node?.content ?? "");

  // 文风指纹 → 划词 AI 的约束摘要。只在打开章节时取；没有指纹或读取失败都视为「无约束」，
  // 划词指令与未接入文风前逐字一致，不因为指纹缺失而阻断改写。
  const [styleProfileSummary, setStyleProfileSummary] = useState<string | undefined>(undefined);
  const isChapterNode = Boolean(node && isChapterWorkflowNode(node));
  useEffect(() => {
    if (!bookId || !isChapterNode) {
      setStyleProfileSummary(undefined);
      return;
    }
    let cancelled = false;
    void fetchJson<{ profile?: unknown }>(`/api/books/${encodeURIComponent(bookId)}/style/profile`)
      .then((data) => {
        if (!cancelled) setStyleProfileSummary(summarizeStyleProfile(data?.profile));
      })
      .catch(() => {
        if (!cancelled) setStyleProfileSummary(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, isChapterNode]);

  useEffect(() => {
    setContent(node?.content ?? "");
    setDirty(false);
    setSaveError(null);
    setHistoryEntries(null);
    setHistoryError(null);
    setSceneSpec(null);
    setSceneSpecOpen(false);
    setContextRailOpen(true);
    normalizedBaseRef.current = node?.content ?? ""; // reset on node change
  }, [node]);

  useEffect(() => {
    onCanvasContextChange({
      activeResourceId: node?.id ?? null,
      activeKind: node?.kind ?? null,
      activeTabId: node?.id,
      activeResource: node ? toWorkspaceResourceRef(node) : undefined,
      openTabs: node ? [toOpenResourceTab(node, dirty)] : [],
      dirty,
      contentPreview: content.slice(0, 500),
    });
  }, [content, dirty, node, onCanvasContextChange]);

  // ide:save 自定义事件监听（必须在所有 early return 之前声明，避免 hooks 数量变化）
  const saveRef = useRef(() => {});
  useEffect(() => {
    const handler = () => { saveRef.current(); };
    window.addEventListener("ide:save", handler);
    return () => window.removeEventListener("ide:save", handler);
  }, []);

  // ── 编辑器状态缓存（Tab 切换时保存/恢复滚动位置） ──
  const containerRef = useRef<HTMLDivElement>(null);
  const prevIsActiveRef = useRef(isActive);

  // isActive 从 true → false：保存当前滚动位置
  useLayoutEffect(() => {
    if (prevIsActiveRef.current && !isActive && node) {
      const el = containerRef.current;
      if (el) {
        // 查找内层 TipTap 编辑器滚动容器（ChapterEditor 的 editorRef）
        const inner = el.querySelector<HTMLElement>(".chapter-editor-wrapper");
        saveEditorState(node.id, {
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          innerScrollTop: inner?.scrollTop,
        });
      }
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, node]);

  // isActive 从 false → true：恢复滚动位置（需等待 DOM 渲染完成）
  useEffect(() => {
    if (!prevIsActiveRef.current && isActive && node) {
      const el = containerRef.current;
      if (!el) return;
      const cached = getEditorState(node.id);
      if (!cached) return;
      // requestAnimationFrame 等 display:none → contents 布局完成
      const raf = requestAnimationFrame(() => {
        el.scrollTop = cached.scrollTop;
        el.scrollLeft = cached.scrollLeft;
        if (typeof cached.innerScrollTop === "number") {
          const inner = el.querySelector<HTMLElement>(".chapter-editor-wrapper");
          if (inner) inner.scrollTop = cached.innerScrollTop;
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    // 注意：不更新 prevIsActiveRef，由上方 useLayoutEffect 统一管理
  }, [isActive, node]);

  if (!node) {
    if (bookId) {
      return <DefaultCockpitViewWithGuide bookId={bookId} bookTitle={nodes.find(n => n.kind === "book")?.title ?? bookId} nodes={nodes} currentChapter={resolveCurrentChapter(nodes)} onGuideComplete={onGuideComplete} onJumpToChapter={onJumpToChapter} />;
    }
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>请先选择或创建一本作品</p>
      </div>
    );
  }

  // Tool panel nodes — render tool panel content directly in canvas
  if (node.kind === "tool" && bookId) {
    const toolPanel = node.metadata?.toolPanel as ToolPanelId | undefined;
    if (toolPanel) {
      return (
        <div className="flex h-full flex-col min-h-0">
          <header className="shrink-0 flex items-center border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">{node.title}</h2>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <ToolPanelView
              toolPanel={toolPanel}
              bookId={bookId}
              bookPlatform={resolveBookPlatform(nodes)}
              repositoryPath={repositoryPath}
              currentChapter={resolveCurrentChapter(nodes)}
              onJumpToChapter={onJumpToChapter}
              onOpenJingweiEntry={onOpenJingweiEntry}
              onSendToNarrator={onSendToNarrator}
            />
          </div>
        </div>
      );
    }
  }

  // 设定图谱 — 作品基础的中央视图，只放回答「设定是什么」的两棵树。
  if (node.metadata?.isLoreTrees && bookId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="lore-trees-view">
        <Suspense fallback={<ToolPanelLoading />}>
          <CanonicalTreesPanel
            bookId={bookId}
            kinds={LORE_TREE_KINDS}
            initialKind="worldview"
            onOpenEntry={(entryId: string, label: string) => {
              // 条目已载入就直接跳经纬卡；否则退回实体详情抽屉，至少让名字有去处。
              if (onOpenJingweiEntry?.(entryId)) return;
              onOpenEntityDetail?.(label);
            }}
            {...(onJumpToChapter ? { onOpenChapter: onJumpToChapter } : {})}
            {...(onSendToNarrator ? { onSendToNarrator } : {})}
          />
        </Suspense>
      </div>
    );
  }

  // 故事推进大屏画布 — 地图/发展历程/双螺旋三视图统一工作台（独立「故事画布」视图入口）
  if ((node.kind === "story-progression" || node.id.startsWith("story-progression:") || node.metadata?.isStoryProgression) && bookId) {
    // metadata 是宽松的 record，取出来先收窄成 string；非法值由画布归一化到故事树
    const rawPreferredView = node.metadata?.preferredView;
    const preferredView = typeof rawPreferredView === "string" ? rawPreferredView : undefined;
    // 旧视图名（map/evolution）由画布内部归一化到故事树，这里只需透传偏好值
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <Suspense fallback={<ToolPanelLoading />}>
          <StoryProgressionCanvas
            bookId={bookId}
            initialView={preferredView}
            currentChapter={resolveCurrentChapter(nodes)}
            onOpenChapter={onJumpToChapter}
            onOpenEntityDetail={onOpenEntityDetail}
            onSendToNarrator={onSendToNarrator}
          />
        </Suspense>
      </div>
    );
  }

  // 章后事实中央面板 — IA 收敛后的唯一权威入口（侧栏只放轻量摘要卡）。
  if (node.metadata?.isMemoryCenter && bookId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <Suspense fallback={<ToolPanelLoading />}>
          <NarrativeMemoryPanel
            bookId={bookId}
            currentChapter={resolveCurrentChapter(nodes)}
            onOpenDevelopmentTimeline={() => onOpenResourceNode?.(createStoryProgressionNode(bookId, "timeline"))}
            onOpenChapter={onJumpToChapter}
          />
        </Suspense>
      </div>
    );
  }

  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const needsHydration = resourceNeedsDetailHydration(node);
  const hydrateError = typeof node.metadata?.detailError === "string" ? node.metadata.detailError : null;

  async function handleSave() {
    if (!node || readonly || needsHydration || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(node, content);
      setDirty(false);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  // saveRef 赋值（放在 early return 之后是安全的，因为 ref 已在上方声明）
  saveRef.current = handleSave;

  // 工具栏按钮（可 portal 到外部容器，也可本地渲染）
  const toolbarButtons = (
    <div className="flex items-center gap-1.5">
      {saveError && <span role="alert" className="text-xs text-destructive truncate max-w-48">保存失败：{saveError}</span>}
      <Button aria-label="保存" title="保存" size="sm" disabled={readonly || needsHydration || !dirty || saving} onClick={handleSave}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
      </Button>
      {isChapterWorkflowNode(node) && (
        <Button size="sm" variant="ghost" className="gap-1" onClick={() => setVariantsOpen(true)} title="生成变体">
          <GitCompare className="size-3.5" />
        </Button>
      )}
      {isChapterWorkflowNode(node) && bookId && (
        <Button size="sm" variant="ghost" className="gap-1" disabled={sceneSpecLoading}
          onClick={async () => {
            setSceneSpecLoading(true);
            try {
              const chapterNumber = typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : 1;
              const data = await fetchJson<{ data?: { sceneSpec?: SceneSpec } }>(
                `/api/books/${encodeURIComponent(bookId)}/scene-spec`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chapterNumber, userDirectives: content.slice(0, 200) }),
                },
              );
              if (data.data?.sceneSpec) { setSceneSpec(data.data.sceneSpec); setSceneSpecOpen(true); }
            } finally { setSceneSpecLoading(false); }
          }}
          title="生成章节蓝图"
        >
          <FileText className="size-3.5" />
        </Button>
      )}
    </div>
  );

  const contextChapterNumber = typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : undefined;
  const showContextRail = Boolean(bookId) && isChapterWorkflowNode(node);

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Header（IDE 模式下 toolbar 通过 portal 渲染到 EditorTabs 右侧） */}
      {!toolbarSlotRef && (
        <header data-testid="workbench-resource-header" className="shrink-0 border-b border-border px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold truncate">{node.title}</h2>
              <Badge variant="secondary" className="text-2xs shrink-0">{resourceTypeLabel(node.kind)}</Badge>
              {readonly && <Badge variant="outline" className="text-2xs shrink-0">只读</Badge>}
              {dirty && <Badge className="text-2xs shrink-0 bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge>}
              {!dirty && !needsHydration && !readonly && <span className="text-2xs text-muted-foreground">已保存</span>}
            </div>
            {toolbarButtons}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            <span>资源类型：{node.kind === "story" ? "Story" : resourceTypeLabel(node.kind)}</span>
            {node.path ? <span>真实路径：{node.path}</span> : null}
            <span>读写能力：{readonly ? "只读" : "可编辑"}</span>
            <span>保存状态：{needsHydration ? "待加载" : dirty ? "未保存" : "已保存"}</span>
          </div>
          {readonly && (
            <div className="mt-1 text-2xs text-muted-foreground">
              只读原因：当前资源由合同标记为只读，保存入口已禁用。
            </div>
          )}
        </header>
      )}
      {/* IDE 模式：portal 渲染操作按钮到 EditorTabs 右侧 */}
      {isActive && toolbarSlotRef && toolbarSlotRef.current && createPortal(toolbarButtons, toolbarSlotRef.current)}

      {/* Alerts */}
      {needsHydration && (
        <div role="alert" className="shrink-0 flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/10 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <Loader2 className="size-3.5 animate-spin" />
          章节详情未加载，正在加载内容...
        </div>
      )}
      {hydrateError && (
        <div className="shrink-0 flex items-center gap-2 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          加载失败：{hydrateError}
        </div>
      )}

      {/* Chapter actions bar */}
      {node.metadata?.isChapter === true && chapterActions && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <ChapterActionsBar
            resourceId={String(node.metadata?.resourceId ?? node.id.replace("chapter:", ""))}
            chapterNumber={typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : undefined}
            version={typeof node.metadata?.version === "number" ? node.metadata.version : undefined}
            wordCount={typeof node.metadata?.wordCount === "number" ? node.metadata.wordCount : undefined}
            status={typeof node.metadata?.status === "string" ? node.metadata.status : undefined}
            onDelete={chapterActions.onDelete}
            onToggleHistory={async (resourceId) => {
              if (historyEntries) { setHistoryEntries(null); return; }
              setHistoryLoading(true);
              setHistoryError(null);
              try {
                const entries = await chapterActions.onGetHistory(resourceId);
                setHistoryEntries(entries);
              } catch (cause) {
                setHistoryError(cause instanceof Error ? cause.message : "加载历史失败");
              } finally {
                setHistoryLoading(false);
              }
            }}
          />
        </div>
      )}

      {/* Version history panel */}
      {(historyEntries || historyLoading || historyError) && (
        <ResourceHistoryPanel
          entries={historyEntries ?? []}
          loading={historyLoading}
          error={historyError}
          onClose={() => { setHistoryEntries(null); setHistoryError(null); }}
        />
      )}

      {isChapterWorkflowNode(node) && (
        <ChapterStatusBar
          chapterNumber={typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : undefined}
          content={content}
          targetWords={resolveChapterWordTarget(node, nodes, sceneSpec)}
          language={resolveBookLanguage(nodes)}
          sceneSpec={sceneSpec}
          onOpenBlueprint={() => setSceneSpecOpen(true)}
        />
      )}

      {/* Editor + 本章上下文侧栏 */}
      <div ref={containerRef} className={`flex-1 min-h-0 ${showContextRail ? "flex overflow-hidden" : "overflow-y-auto"}`}>
        <div className={showContextRail ? "min-w-0 min-h-0 flex-1 overflow-y-auto" : "h-full"}>
          {needsHydration ? null : node.kind === "jingwei-entry" && jingweiActions && !node.metadata?.fileName ? (() => {
            // 角色类目 → 酒馆风格大屏角色卡（参考 SillyTavern）
            const entryCategory = typeof node.metadata?.category === "string" ? node.metadata.category : "";
            const rawPriorityTier = node.metadata?.priorityTier;
            const priorityTier: "core" | "relevant" | "reference" | "auto" =
              rawPriorityTier === "core" || rawPriorityTier === "relevant" || rawPriorityTier === "reference" ? rawPriorityTier : "auto";
            const entryData = {
              id: String(node.metadata?.entryId ?? node.id.replace("jingwei-entry:", "")),
              title: node.title,
              contentMd: content,
              sectionId: typeof node.metadata?.sectionId === "string" ? node.metadata.sectionId : undefined,
              updatedAt: typeof node.metadata?.updatedAt === "string" ? node.metadata.updatedAt : undefined,
              category: entryCategory || undefined,
              fields: asRecord(node.metadata?.fields),
              priorityTier,
              status: typeof node.metadata?.status === "string" ? node.metadata.status : undefined,
              layer: typeof node.metadata?.layer === "string" ? node.metadata.layer : undefined,
              version: typeof node.metadata?.version === "number" ? node.metadata.version : undefined,
              relatedEntryIds: Array.isArray(node.metadata?.relatedEntryIds) ? node.metadata.relatedEntryIds.filter((id): id is string => typeof id === "string") : undefined,
              aliases: Array.isArray(node.metadata?.aliases) ? node.metadata.aliases.filter((alias): alias is string => typeof alias === "string") : undefined,
              visibility: (node.metadata?.visibility === "global" || node.metadata?.visibility === "nested" ? node.metadata.visibility : "tracked") as "global" | "nested" | "tracked",
              visibleAfterChapter: typeof node.metadata?.visibleAfterChapter === "number" ? node.metadata.visibleAfterChapter : undefined,
              visibleUntilChapter: typeof node.metadata?.visibleUntilChapter === "number" ? node.metadata.visibleUntilChapter : undefined,
              parentId: typeof node.metadata?.parentId === "string" ? node.metadata.parentId : null,
              conflictStatus: (node.metadata?.conflictStatus === "pending" || node.metadata?.conflictStatus === "resolved" ? node.metadata.conflictStatus : "none") as "pending" | "resolved" | "none",
              conflictDetail: typeof node.metadata?.conflictDetail === "string" ? node.metadata.conflictDetail : undefined,
            };
            if (entryCategory === "characters") {
              return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">加载角色卡...</div>}>
                  <CharacterCardPage
                    entry={entryData}
                    bookId={bookId}
                    saving={false}
                    onSave={async (entryId, payload) => {
                      await jingweiActions.onSave(entryId, payload as unknown as Parameters<typeof jingweiActions.onSave>[1]);
                    }}
                    onNavigateToEntry={(entryId) => {
                      if (!onOpenJingweiEntry?.(entryId)) setSaveError(`关联条目不存在或尚未载入：${entryId}`);
                    }}
                  />
                </Suspense>
              );
            }
            return (
              <JingweiEntryEditor
                bookId={bookId}
                entry={entryData}
                sourceLabel={node.metadata?.isNarrativeMemoryEntry ? "故事推进" : "作品基础资料"}
                onSave={jingweiActions.onSave}
                onDelete={jingweiActions.onDelete}
                onNavigateToEntry={(entryId) => {
                  if (!onOpenJingweiEntry?.(entryId)) setSaveError(`关联条目不存在或尚未载入：${entryId}`);
                }}
              />
            );
          })() : (
            <ResourceViewer node={{ ...node, content }} bookId={bookId} language={resolveBookLanguage(nodes)} onSendToNarrator={onSendToNarrator} styleProfileSummary={styleProfileSummary} onContentChange={(nextContent) => {
              setContent(nextContent);
              setDirty(nextContent !== normalizedBaseRef.current);
              setSaveError(null);
            }} onTabComplete={bookId && isChapterWorkflowNode(node) ? async (currentContent, cursorPosition) => {
              const contextBefore = currentContent.slice(Math.max(0, cursorPosition - 500), cursorPosition);
              try {
                const data = await fetchJson<{ text?: string; content?: string }>(
                  `/api/books/${encodeURIComponent(bookId)}/inline-write`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mode: "continuation", context: contextBefore, maxTokens: 80 }),
                  },
                );
                return data.text ?? data.content ?? null;
              } catch { return null; }
            } : undefined} />
          )}
        </div>

        {showContextRail ? (
          contextRailOpen ? (
            <div className="relative flex min-h-0 shrink-0 border-l border-border">
              <ChapterContextRail
                bookId={bookId!}
                chapterNumber={contextChapterNumber}
                onOpenJingweiEntry={onOpenJingweiEntry}
                className="border-0"
              />
              <button
                type="button"
                onClick={() => setContextRailOpen(false)}
                className="absolute left-0 top-2 z-10 -translate-x-1/2 rounded-full border border-border bg-card p-1 text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
                title="收起本章上下文"
                aria-label="收起本章上下文"
                data-testid="chapter-context-collapse"
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setContextRailOpen(true)}
              className="flex w-7 shrink-0 items-start justify-center border-l border-border bg-card pt-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="展开本章上下文"
              aria-label="展开本章上下文"
              data-testid="chapter-context-expand"
            >
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </button>
          )
        ) : null}
      </div>

      {/* 变体面板（右侧抽屉） */}
      {isChapterWorkflowNode(node) && (
        <Sheet open={variantsOpen} onOpenChange={setVariantsOpen}>
          <SheetContent side="right" className="w-[400px] sm:w-[480px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>变体对比</SheetTitle>
            </SheetHeader>
            <div className="p-4">
              <VariantsPanel bookId={bookId ?? ""} onClose={() => setVariantsOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* 章节蓝图面板（右侧抽屉） */}
      {sceneSpec && (
        <Sheet open={sceneSpecOpen} onOpenChange={setSceneSpecOpen}>
          <SheetContent side="right" className="w-[400px] sm:w-[480px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>章节蓝图</SheetTitle>
            </SheetHeader>
            <div className="p-4">
              <SceneSpecPanel spec={sceneSpec} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* T4b 改章 stale 横幅：dirty 时防抖比对指纹，提示重结算 */}
      {isChapterWorkflowNode(node) && bookId && dirty && typeof node.metadata?.chapterNumber === "number" && content.trim() && (
        <Suspense fallback={null}>
          <ChapterSettlementBanner
            bookId={bookId}
            chapterNumber={node.metadata.chapterNumber}
            content={content}
            onAskResettle={() => onSendToNarrator?.(`请对第 ${node.metadata?.chapterNumber} 章重新执行 memory.settle_chapter（force=true），正文已修改需要刷新叙事记忆。`)}
          />
        </Suspense>
      )}

      {/* 章节体检工具栏（仅正式章节显示） */}
      {isChapterWorkflowNode(node) && bookId && (
        <ChapterToolbar
          bookId={bookId}
          chapterNumber={typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : undefined}
          content={content}
          bookPlatform={resolveBookPlatform(nodes)}
          onApplyContent={(nextContent) => {
            setContent(nextContent);
            setDirty(nextContent !== normalizedBaseRef.current);
            setSaveError(null);
          }}
          onSendToNarrator={onSendToNarrator}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DefaultCockpitViewWithGuide — 新书显示引导，已完成引导显示 Cockpit
// ---------------------------------------------------------------------------

function containsChapterNode(nodes: readonly WorkbenchResourceNode[] | undefined): boolean {
  return nodes?.some((node) => node.kind === "chapter" || containsChapterNode(node.children)) ?? false;
}

function DefaultCockpitViewWithGuide({ bookId, bookTitle, nodes, currentChapter, onGuideComplete, onJumpToChapter }: { bookId: string; bookTitle: string; nodes?: readonly WorkbenchResourceNode[]; currentChapter?: number; onGuideComplete?: (outcome?: GuidedSetupOutcome) => void; onJumpToChapter?: (chapterNumber: number) => void }) {
  const storageKey = `novelfork:guide-completed:${bookId}`;
  const hasChapters = containsChapterNode(nodes);
  const [guideCompleted, setGuideCompleted] = useState(() => {
    if (hasChapters) return true;
    try { return localStorage.getItem(storageKey) === "true"; } catch { return false; }
  });

  useEffect(() => {
    if (hasChapters) setGuideCompleted(true);
  }, [hasChapters]);

  const handleGuideComplete = useCallback((outcome?: GuidedSetupOutcome) => {
    try { localStorage.setItem(storageKey, "true"); } catch { /* ignore */ }
    setGuideCompleted(true);
    // outcome 带着 Skills 推荐与题材簇，供上层交给叙述者做建书收尾编排。
    onGuideComplete?.(outcome);
  }, [storageKey, onGuideComplete]);

  return guideCompleted
    ? <DefaultCockpitView bookId={bookId} currentChapter={currentChapter} onJumpToChapter={onJumpToChapter} />
    : <NewBookGuide bookId={bookId} bookTitle={bookTitle} onComplete={handleGuideComplete} />;
}

// ---------------------------------------------------------------------------
// DefaultCockpitView — 作品状态仪表盘 + 经纬浏览 + 可展开面板
// ---------------------------------------------------------------------------

interface OverviewStats {
  volumeProgress: { current: number; total: number; percent: number };
  foreshadowing: { planted: number; recovered: number; recoveryRate: number };
  activePlotLines: number;
  wordCount: { total: number };
  chapterCount: number;
}

function StatCard({ label, value, sub, className, active, onClick }: {
  label: string; value: string; sub?: string; className?: string;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-3 transition-colors ${onClick ? "cursor-pointer hover:border-primary/50 hover:bg-accent/30" : ""} ${active ? "border-primary/60 bg-primary/5" : "border-border"} ${className ?? ""}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="text-2xs text-muted-foreground">{label}</div>
        {onClick && active ? <ChevronUp className="size-3 text-muted-foreground" /> : null}
      </div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-2xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

type ExpandedPanel = "quality" | null;

function DefaultCockpitView({ bookId, currentChapter, onJumpToChapter }: { bookId: string; currentChapter?: number; onJumpToChapter?: (chapterNumber: number) => void }) {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);

  // Fetch overview stats
  useEffect(() => {
    let active = true;
    fetchJson<OverviewStats>(`/api/books/${encodeURIComponent(bookId)}/overview-stats`)
      .then(data => { if (active && data) setStats(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [bookId]);

  const togglePanel = useCallback((panel: ExpandedPanel) => {
    setExpandedPanel(prev => prev === panel ? null : panel);
  }, []);

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 状态卡片网格（作品总览）—— StatCard 点击展开对应面板 */}
      {stats && (
        <div className="shrink-0 grid grid-cols-3 gap-2 px-3 pt-3 pb-2">
          <StatCard
            label="章节进度" value={`${stats.chapterCount} 章`}
            sub={`目标 ${stats.volumeProgress.total} · ${stats.volumeProgress.percent}%`}
            active={expandedPanel === "quality"}
            onClick={() => togglePanel("quality")}
          />
          <StatCard
            label="伏笔回收" value={`${stats.foreshadowing.recoveryRate}%`}
            sub={`埋 ${stats.foreshadowing.planted} / 收 ${stats.foreshadowing.recovered}`}
          />
          <StatCard
            label="总字数"
            value={stats.wordCount.total >= 10000 ? `${(stats.wordCount.total / 10000).toFixed(1)} 万字` : `${stats.wordCount.total.toLocaleString()} 字`}
            sub="作品累计正文"
          />
          <div className="col-span-3 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex items-center justify-between text-2xs text-muted-foreground mb-1">
              <span>卷进度</span>
              <span>{stats.volumeProgress.current} / {stats.volumeProgress.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(stats.volumeProgress.percent, 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* 可展开的详情面板（Task D: StatCard 点击联动）；伏笔详情已收敛至侧栏「伏笔账本」唯一入口 */}
      {expandedPanel && (
        <div className="shrink-0 border-b border-border px-3 pb-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground">质量监控</h3>
              <button type="button" onClick={() => setExpandedPanel(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <ChevronUp className="size-3.5" />
              </button>
            </div>
            <Suspense fallback={<ToolPanelLoading />}>
              {expandedPanel === "quality" && <QualityPanel bookId={bookId} />}
            </Suspense>
          </div>
        </div>
      )}

      {/* 主区域：驾驶舱概览（近期章节结果 + 待处理伏笔，与左侧经纬视图不重复） */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <CockpitOverview bookId={bookId} />
      </div>

      {/* 底部状态条（纯信息展示，设置入口已移至 ActivityBar） */}
      <StatusBar bookId={bookId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CockpitOverview — 驾驶舱主区：近期章节结果 + 待处理伏笔（真实接口，不与经纬视图重复）
// ---------------------------------------------------------------------------

interface CockpitListItem {
  id: string;
  text?: string;
  title?: string;
  sourceChapter?: number;
  status?: string;
}

function CockpitOverview({ bookId }: { bookId: string }) {
  const [chapterResults, setChapterResults] = useState<CockpitListItem[]>([]);
  const [hooks, setHooks] = useState<CockpitListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchJson<{ items?: CockpitListItem[] }>(`/api/books/${encodeURIComponent(bookId)}/cockpit/recent-chapter-results?limit=8`).catch(() => null),
      fetchJson<{ items?: CockpitListItem[] }>(`/api/books/${encodeURIComponent(bookId)}/cockpit/open-hooks?limit=8`).catch(() => null),
    ]).then(([chapters, hk]) => {
      if (!active) return;
      setChapterResults(Array.isArray(chapters?.items) ? chapters.items : []);
      setHooks(Array.isArray(hk?.items) ? hk.items : []);
      setLoading(false);
    });
    return () => { active = false; };
  }, [bookId]);

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
      {/* 近期章节结果 */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-xs font-semibold text-foreground">近期章节结果</h3>
        {chapterResults.length === 0 ? (
          <p className="text-2xs text-muted-foreground">暂无章节结果。让 AI 写一章后会出现在这里。</p>
        ) : (
          <ul className="space-y-2">
            {chapterResults.map(item => (
              <li key={item.id} className="rounded-md bg-muted/40 p-2 text-xs">
                <div className="font-medium text-foreground">{item.title || item.id}</div>
                <div className="mt-1 text-2xs text-muted-foreground">状态：{item.status || 'unknown'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 待处理伏笔 */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-xs font-semibold text-foreground">待处理伏笔</h3>
        {hooks.length === 0 ? (
          <p className="text-2xs text-muted-foreground">暂无待回收伏笔。</p>
        ) : (
          <ul className="space-y-1">
            {hooks.map((h) => (
              <li key={h.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/40">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="line-clamp-2 flex-1 text-muted-foreground">{(h.text || "").replace(/^pending hooks：/, "").trim() || "（空）"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PenLineIcon() {
  return <FileText className="size-3.5 shrink-0 text-violet-500" />;
}
