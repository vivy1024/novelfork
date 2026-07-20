import { useCallback, useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Save, FileText, AlertCircle, Loader2, GitCompare, ChevronDown, ChevronUp } from "lucide-react";
import { resourceNeedsDetailHydration } from "./ResourceDetailLoader";
import { ResourceViewer } from "./resource-viewers";
import { isChapterWorkflowNode } from "./chapter-workflow-node";
import { ChapterActionsBar } from "./ChapterActionsBar";
import { ResourceHistoryPanel, type ResourceHistoryEntry } from "./ResourceHistoryPanel";
import { saveEditorState, getEditorState } from "./ide/editor-state-cache";

import { JingweiEntryEditor } from "./JingweiEntryEditor";
import { JingweiPanel } from "./jingwei/JingweiPanel";
import { NewBookGuide } from "./NewBookGuide";
import { PresetSuggestionCard } from "./PresetSuggestionCard";
import { StatusBar } from "./StatusBar";
import { ChapterToolbar } from "./ChapterToolbar";
import { QualityPanel } from "./panels/QualityPanel";
import type { ToolPanelId } from "./useWorkbenchResources";

// Lazy-loaded tool panels
const NarrativeMemoryGraphWorkspace = lazy(() => import("./NarrativeMemoryGraphWorkspace").then(m => ({ default: m.NarrativeMemoryGraphWorkspace })));
const BookHealthSummary = lazy(() => import("./BookHealthSummary").then(m => ({ default: m.BookHealthSummary })));
const DailyProgressCard = lazy(() => import("./DailyProgressCard").then(m => ({ default: m.DailyProgressCard })));
const CharacterArcsPanel = lazy(() => import("./CharacterArcsPanel").then(m => ({ default: m.CharacterArcsPanel })));
const StyleDriftPanel = lazy(() => import("./StyleDriftPanel").then(m => ({ default: m.StyleDriftPanel })));
const CompliancePanel = lazy(() => import("./CompliancePanel").then(m => ({ default: m.CompliancePanel })));
const ForeshadowingBoard = lazy(() => import("./ForeshadowingBoard").then(m => ({ default: m.ForeshadowingBoard })));
const RuntimeStatePanel = lazy(() => import("./RuntimeStatePanel").then(m => ({ default: m.RuntimeStatePanel })));
const CoreShiftPanel = lazy(() => import("./CoreShiftPanel").then(m => ({ default: m.CoreShiftPanel })));
const CollaborationVersionPanel = lazy(() => import("./CollaborationVersionPanel").then(m => ({ default: m.CollaborationVersionPanel })));
const BeatProgressBar = lazy(() => import("./BeatProgressBar").then(m => ({ default: m.BeatProgressBar })));
import { VariantsPanel } from "./VariantsPanel";
import { SceneSpecPanel, type SceneSpec } from "./SceneSpecPanel";
import type { CanvasContext, OpenResourceTab, WorkspaceResourceRef, WorkspaceResourceViewKind } from "@/shared/agent-native-workspace";
import type { WorkbenchResourceKind, WorkbenchResourceNode } from "./useWorkbenchResources";

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

// ---------------------------------------------------------------------------
// ToolPanelView — renders tool panel content in the canvas area
// ---------------------------------------------------------------------------

function ToolPanelLoading() {
  return <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}

function ToolPanelView({ toolPanel, bookId, repositoryPath, onJumpToChapter }: { toolPanel: ToolPanelId; bookId: string; repositoryPath?: string; onJumpToChapter?: (chapterNumber: number) => void }) {
  switch (toolPanel) {
    case "quality":
      return <QualityPanel bookId={bookId} />;
    case "health":
      return <Suspense fallback={<ToolPanelLoading />}><BookHealthSummary bookId={bookId} /></Suspense>;
    case "progress":
      return <Suspense fallback={<ToolPanelLoading />}><DailyProgressCard /></Suspense>;
    case "arcs":
      return <Suspense fallback={<ToolPanelLoading />}><CharacterArcsPanel bookId={bookId} onClose={() => {}} /></Suspense>;
    case "drift":
      return <Suspense fallback={<ToolPanelLoading />}><StyleDriftPanel bookId={bookId} onClose={() => {}} /></Suspense>;
    case "compliance":
      return <Suspense fallback={<ToolPanelLoading />}><CompliancePanel bookId={bookId} onClose={() => {}} /></Suspense>;
    case "foreshadowing":
      return <Suspense fallback={<ToolPanelLoading />}><ForeshadowingBoard bookId={bookId} onJumpToChapter={onJumpToChapter} /></Suspense>;
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
  onSave: (entryId: string, payload: { title: string; contentMd: string }) => Promise<void>;
  onDelete?: (entryId: string) => Promise<void>;
}

export interface WorkbenchCanvasProps {
  node: WorkbenchResourceNode | null;
  nodes?: readonly WorkbenchResourceNode[];
  bookId?: string;
  repositoryPath?: string;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  onGuideComplete?: () => void;
  chapterActions?: ChapterActionHandlers;
  jingweiActions?: JingweiActionHandlers;
  /** 外部容器 ref，操作按钮通过 portal 渲染到此处（IDE 模式用） */
  toolbarSlotRef?: RefObject<HTMLDivElement | null>;
  /** 当前 canvas 是否为激活状态（多实例模式下控制 portal 行为） */
  isActive?: boolean;
  /** 工具面板（如伏笔看板）跳转到指定章节，由上层打开对应章节 Tab */
  onJumpToChapter?: (chapterNumber: number) => void;
}

export function WorkbenchCanvas({ node, nodes = [], bookId, repositoryPath, onSave, onCanvasContextChange = () => undefined, onGuideComplete, chapterActions, jingweiActions, toolbarSlotRef, isActive = true, onJumpToChapter }: WorkbenchCanvasProps) {
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
  // TipTap 初始化时会规范化 markdown（如标准化换行/标题），导致首次 onContentChange
  // 的内容 ≠ node.content 但语义相同。用 ref 记录规范化后的基准值，避免误标 dirty。
  const normalizedBaseRef = useRef<string | null>(null);

  useEffect(() => {
    setContent(node?.content ?? "");
    setDirty(false);
    setSaveError(null);
    setHistoryEntries(null);
    setHistoryError(null);
    normalizedBaseRef.current = null; // reset on node change
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
      return <DefaultCockpitViewWithGuide bookId={bookId} bookTitle={nodes.find(n => n.kind === "book")?.title ?? bookId} nodes={nodes} onGuideComplete={onGuideComplete} onJumpToChapter={onJumpToChapter} />;
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
            <ToolPanelView toolPanel={toolPanel} bookId={bookId} repositoryPath={repositoryPath} onJumpToChapter={onJumpToChapter} />
          </div>
        </div>
      );
    }
  }

  // Jingwei panel entry — render JingweiPanel directly
  if (node.kind === "jingwei" && node.metadata?.action === "open-jingwei-panel" && bookId) {
    return (
      <div className="flex h-full flex-col min-h-0">
        <JingweiPanel bookId={bookId} />
      </div>
    );
  }

  // Narrative Memory Graph — render NarrativeMemoryGraphWorkspace directly
  if (node.id === "narrative-memory-graph" && bookId) {
    return (
      <div className="flex h-full flex-col min-h-0">
        <Suspense fallback={<ToolPanelLoading />}><NarrativeMemoryGraphWorkspace bookId={bookId} /></Suspense>
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
      {saveError && <span className="text-xs text-destructive truncate max-w-48">{saveError}</span>}
      <Button size="sm" disabled={readonly || needsHydration || !dirty || saving} onClick={handleSave}>
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
              const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/scene-spec`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chapterNumber, userDirectives: content.slice(0, 200) }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.data?.sceneSpec) { setSceneSpec(data.data.sceneSpec); setSceneSpecOpen(true); }
              }
            } finally { setSceneSpecLoading(false); }
          }}
          title="生成章节蓝图"
        >
          <FileText className="size-3.5" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Header（IDE 模式下 toolbar 通过 portal 渲染到 EditorTabs 右侧） */}
      {!toolbarSlotRef && (
        <header className="shrink-0 flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold truncate">{node.title}</h2>
            <Badge variant="secondary" className="text-[10px] shrink-0">{resourceTypeLabel(node.kind)}</Badge>
            {readonly && <Badge variant="outline" className="text-[10px] shrink-0">只读</Badge>}
            {dirty && <Badge className="text-[10px] shrink-0 bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge>}
            {!dirty && !needsHydration && !readonly && <span className="text-[10px] text-muted-foreground">已保存</span>}
          </div>
          {toolbarButtons}
        </header>
      )}
      {/* IDE 模式：portal 渲染操作按钮到 EditorTabs 右侧 */}
      {isActive && toolbarSlotRef && toolbarSlotRef.current && createPortal(toolbarButtons, toolbarSlotRef.current)}

      {/* Alerts */}
      {needsHydration && (
        <div className="shrink-0 flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/10 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <Loader2 className="size-3.5 animate-spin" />
          正在加载内容...
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

      {/* Editor */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto">
        {needsHydration ? null : node.kind === "jingwei-entry" && jingweiActions && !node.metadata?.fileName ? (
          <JingweiEntryEditor
            entry={{
              id: String(node.metadata?.entryId ?? node.id.replace("jingwei-entry:", "")),
              title: node.title,
              contentMd: content,
              sectionId: typeof node.metadata?.sectionId === "string" ? node.metadata.sectionId : undefined,
              updatedAt: typeof node.metadata?.updatedAt === "string" ? node.metadata.updatedAt : undefined,
            }}
            sourceLabel={node.metadata?.isNarrativeMemoryEntry ? "叙事记忆" : "经纬资料"}
            onSave={jingweiActions.onSave}
            onDelete={jingweiActions.onDelete}
          />
        ) : (
          <ResourceViewer node={{ ...node, content }} bookId={bookId} onContentChange={(nextContent) => {
            setContent(nextContent);
            // TipTap 首次 onContentChange 是规范化产物（非用户编辑），记为基准值。
            // 后续编辑与基准值比较，避免规范化差异误标 dirty。
            if (normalizedBaseRef.current === null) {
              normalizedBaseRef.current = nextContent;
              setDirty(false);
            } else {
              setDirty(nextContent !== normalizedBaseRef.current);
            }
            setSaveError(null);
          }} onTabComplete={bookId && isChapterWorkflowNode(node) ? async (currentContent, cursorPosition) => {
            const contextBefore = currentContent.slice(Math.max(0, cursorPosition - 500), cursorPosition);
            try {
              const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/inline-write`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "continuation", context: contextBefore, maxTokens: 80 }),
              });
              if (!res.ok) return null;
              const data = await res.json();
              return data.text ?? data.content ?? null;
            } catch { return null; }
          } : undefined} />
        )}
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

      {/* 章节体检工具栏（仅正式章节显示） */}
      {isChapterWorkflowNode(node) && bookId && (
        <ChapterToolbar bookId={bookId} chapterNumber={typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : undefined} />
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

function DefaultCockpitViewWithGuide({ bookId, bookTitle, nodes, onGuideComplete, onJumpToChapter }: { bookId: string; bookTitle: string; nodes?: readonly WorkbenchResourceNode[]; onGuideComplete?: () => void; onJumpToChapter?: (chapterNumber: number) => void }) {
  const storageKey = `novelfork:guide-completed:${bookId}`;
  const presetSuggestedKey = `novelfork:preset-suggested:${bookId}`;
  // Skip guide if book already has chapters (old book without localStorage mark)
  const hasChapters = containsChapterNode(nodes);
  const [guideCompleted, setGuideCompleted] = useState(() => {
    if (hasChapters) return true;
    try { return localStorage.getItem(storageKey) === "true"; } catch { return false; }
  });
  // nodes 在工作台首次挂载后异步加载；已有章节时必须立即退出新书引导。
  useEffect(() => {
    if (hasChapters) setGuideCompleted(true);
  }, [hasChapters]);
  // 建书引导刚完成时弹出预设推荐（仅一次，用 localStorage 标记避免重复）
  const [showPresetSuggestion, setShowPresetSuggestion] = useState(false);

  const handleGuideComplete = useCallback(() => {
    try { localStorage.setItem(storageKey, "true"); } catch { /* ignore */ }
    setGuideCompleted(true);
    // 引导完成后，若未提示过预设推荐，则展示
    try {
      if (localStorage.getItem(presetSuggestedKey) !== "true") {
        setShowPresetSuggestion(true);
      }
    } catch {
      setShowPresetSuggestion(true);
    }
    onGuideComplete?.();
  }, [storageKey, presetSuggestedKey, onGuideComplete]);

  const handlePresetSuggestionClose = useCallback(() => {
    try { localStorage.setItem(presetSuggestedKey, "true"); } catch { /* ignore */ }
    setShowPresetSuggestion(false);
  }, [presetSuggestedKey]);

  if (!guideCompleted) {
    return <NewBookGuide bookId={bookId} bookTitle={bookTitle} onComplete={handleGuideComplete} />;
  }

  return (
    <>
      <DefaultCockpitView bookId={bookId} onJumpToChapter={onJumpToChapter} />
      {showPresetSuggestion && (
        <PresetSuggestionCard bookId={bookId} onClose={handlePresetSuggestionClose} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// DefaultCockpitView — 作品状态仪表盘 + 经纬浏览 + 可展开面板
// ---------------------------------------------------------------------------

interface OverviewStats {
  volumeProgress: { current: number; total: number; percent: number };
  foreshadowing: { planted: number; recovered: number; recoveryRate: number };
  activePlotLines: number;
  wordCount: { today: number; total: number };
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
        <div className="text-[10px] text-muted-foreground">{label}</div>
        {onClick && (active ? <ChevronUp className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />)}
      </div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

type ExpandedPanel = "foreshadowing" | "quality" | "words" | null;

function DefaultCockpitView({ bookId, onJumpToChapter }: { bookId: string; onJumpToChapter?: (chapterNumber: number) => void }) {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);

  // Fetch overview stats
  useEffect(() => {
    let active = true;
    fetch(`/api/books/${encodeURIComponent(bookId)}/overview-stats`)
      .then(r => r.ok ? r.json() : null)
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
            active={expandedPanel === "foreshadowing"}
            onClick={() => togglePanel("foreshadowing")}
          />
          <StatCard
            label="今日字数" value={`${stats.wordCount.today.toLocaleString()}`}
            sub={`总计 ${(stats.wordCount.total / 10000).toFixed(1)} 万字`}
            active={expandedPanel === "words"}
            onClick={() => togglePanel("words")}
          />
          {/* 节拍进度条（Task C: BeatProgressBar 接入驾驶舱） */}
          <div className="col-span-3 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>卷进度</span>
              <span>{stats.volumeProgress.current} / {stats.volumeProgress.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(stats.volumeProgress.percent, 100)}%` }} />
            </div>
            {/* BeatProgressBar：默认节拍模板进度 */}
            <div className="mt-2">
              <Suspense fallback={null}>
                <BeatProgressBar templateId="default" />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* 可展开的详情面板（Task D: StatCard 点击联动） */}
      {expandedPanel && (
        <div className="shrink-0 border-b border-border px-3 pb-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground">
                {expandedPanel === "foreshadowing" ? "伏笔详情" : expandedPanel === "quality" ? "质量监控" : "写作统计"}
              </h3>
              <button type="button" onClick={() => setExpandedPanel(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <ChevronUp className="size-3.5" />
              </button>
            </div>
            <Suspense fallback={<ToolPanelLoading />}>
              {expandedPanel === "foreshadowing" && <ForeshadowingBoard bookId={bookId} onJumpToChapter={onJumpToChapter} />}
              {expandedPanel === "quality" && <QualityPanel bookId={bookId} />}
              {expandedPanel === "words" && <DailyProgressCard />}
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
      fetch(`/api/books/${encodeURIComponent(bookId)}/cockpit/recent-chapter-results?limit=8`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/books/${encodeURIComponent(bookId)}/cockpit/open-hooks?limit=8`).then(r => r.ok ? r.json() : null).catch(() => null),
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
          <p className="text-[11px] text-muted-foreground">暂无章节结果。让 AI 写一章后会出现在这里。</p>
        ) : (
          <ul className="space-y-2">
            {chapterResults.map(item => (
              <li key={item.id} className="rounded-md bg-muted/40 p-2 text-xs">
                <div className="font-medium text-foreground">{item.title || item.id}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">状态：{item.status || 'unknown'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 待处理伏笔 */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-xs font-semibold text-foreground">待处理伏笔</h3>
        {hooks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">暂无待回收伏笔。</p>
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
