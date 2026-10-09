/**
 * IdeWorkbench — IDE 模式写作工作台
 *
 * 三栏布局：ActivityBar + Sidebar + Editor(含 Tabs) + ChatPanel
 * 参考 VS Code：ActivityBar 图标切换 Sidebar 内容，底部只有全局操作。
 */
import { Component, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import {
  FolderTree, Settings, X,
  Clock, PlusCircle, Search, Sparkles, Lightbulb, ChevronRight, ChevronDown, MessageSquare, PenLine,
  BookOpen, Route, LayoutDashboard, TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchCanvas, type WorkbenchCanvasContext } from "../WorkbenchCanvas";
import { WorkbenchResourceTree } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
import { createLoreTreesNode, createMemoryCenterNode, createStoryProgressionNode, createToolSectionNodes, createWorkflowNode } from "../useWorkbenchResources";
import { CATEGORY_META, normalizeCategory } from "../../../engine/jingwei/unified-categories";
import { groupEntriesByCategory, memoryFactLabel } from "../lore-workspace-split";
import type { ChapterActionHandlers } from "../WorkbenchCanvas";
import type { SelectionCandidate } from "../resource-viewers/ChapterEditor";
import type { JingweiEntrySavePayload } from "../JingweiEntryEditor";
import { EditorTabs } from "./EditorTabs";
import { useIdeTabs, type TabKind, type TabView } from "./use-ide-tabs";
import { useBookFileTree } from "./use-book-file-tree";
import { BookSettingsPanel, type BookSettingsSection } from "../panels/BookSettingsPanel";
import { NarrativeMemoryPanel } from "../NarrativeMemoryPanel";
import { SkillsAndStyleSidebarPanel } from "./SkillsAndStyleSidebarPanel";
import { StyleDistillationWorkspace, type StyleDistillationFetchJson } from "./StyleDistillationWorkspace";
import { StyleVaultPanel } from "./StyleVaultPanel";
import { CharactersAndLoreSidebarPanel, type EntityFactLite } from "./CharactersAndLoreSidebarPanel";
import { StorylineAndPlanningSidebarPanel } from "./StorylineAndPlanningSidebarPanel";
import { EntityDetailDrawer } from "../EntityDetailDrawer";
import { JingweiSidebarToolbar } from "../jingwei/JingweiSidebarToolbar";
import { WriteViewPanel } from "../WriteViewPanel";
import { dispatchWritingProgress } from "../writing-progress-event";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import { useChapterReconcile } from "../use-chapter-reconcile";
import type { GuidedSetupOutcome } from "../NewBookGuide";
import { containsChapterNode } from "../new-book-guide-state";
import { fileBreadcrumbParts, resourceDisplayTitle } from "../chapter-display-title";
import { buildWriteRequestMessage } from "../write-request";
import type { BeatBudgetItem } from "../../../handlers/beat-budget";
import { buildOnboardingRequestMessage } from "../onboarding-request";
import { useIdeKeybindings } from "./use-ide-keybindings";
import { usePanelManager, type ViewId } from "./use-panel-manager";
import { CommandPalette } from "./command-palette";
import { useIdeCommands } from "./use-ide-commands";
import { ProblemsPanel, type EditorIssue } from "./ProblemsPanel";
import { clearEditorState } from "./editor-state-cache";
import { useWorkbenchDialogs } from "./use-workbench-dialogs";
import { useWorkbenchLeaveGuard } from "../use-workbench-leave-guard";
import { toast } from "@/components/ui/toast";
import {
  defaultIdePaneVisibility,
  ideLayoutModeFromWidth,
  ideLayoutSizesToArray,
  idePanesUseOverlay,
  initialIdeLayoutMode,
  loadIdeLayoutSizes,
  mergeIdeLayoutSizes,
  saveIdeLayoutSizes,
  type IdeLayoutMode,
} from "./ide-layout-state";

/**
 * T3 · 提拔回写的大纲 fields 合并：保留 volumeNumber/goal 等既有字段，
 * 仅写入 targetChapterNumber。纯函数，供回写链路与单测共用。
 */
export function buildTargetChapterFields(
  existing: Record<string, unknown> | undefined,
  chapterNumber: number,
): Record<string, unknown> {
  return { ...(existing ?? {}), targetChapterNumber: chapterNumber };
}

/** WorkbenchResourceNode.kind → Tab 图标用的 TabKind（导出仅供测试核对映射表） */export function toTabKind(node: WorkbenchResourceNode): TabKind {
  if (node.kind === "story-progression" || node.metadata?.isStoryProgression) return "story-map";
  if (node.metadata?.isWorkflowRun) return "tool";
  if (node.metadata?.isNarrativeMemoryEntry) return "memory-entry";
  if (node.metadata?.isFile && !node.metadata?.isChapter) return "file";
  switch (node.kind) {
    case "chapter": return "chapter";
    case "jingwei":
    case "jingwei-section":
    case "jingwei-entry": return "jingwei-entry";
    // 大纲/设定 markdown 按文档呈现
    case "story": return "file";
    // 叙事线/故事脉络类挂到 story-map 图谱图标
    case "narrative-line":
    case "storyline": return "story-map";
    case "tool":
    case "tool-group": return "tool";
    default: return "other";
  }
}

/** WorkbenchResourceNode → 归属的 ActivityBar 视图（决定 Tab 落在哪个工作区；导出仅供测试核对映射表） */
export function toTabView(node: WorkbenchResourceNode): TabView {
  // 工作流（按工序写这一章）的入口在写作侧栏，标签归写作视图。
  if (node.metadata?.isWorkflowRun) return "write";
  // 分析工具与文件树同属「资源」视图（同一侧栏的两个分区）。
  if (node.kind === "tool" || node.kind === "tool-group") return "resources";
  // 设定图谱是作品基础的中央视图（从作品基础侧栏打开），不能落到资源：
  // 否则打开时活动栏会跳到资源，作者找不回作品基础。
  if (node.metadata?.isLoreTrees) return "characters-lore";
  // 故事推进大屏画布与叙事记忆条目归入故事推进工作区。
  if (node.metadata?.isNarrativeMemoryEntry || node.metadata?.isMemoryCenter) return "storyline";
  if (node.kind === "story-progression" || node.metadata?.isStoryProgression) return "storyline";
  if (node.kind === "jingwei" || node.kind === "jingwei-section" || node.kind === "jingwei-entry") return "characters-lore";
  return "resources";
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable || target.closest("[contenteditable='true'], .ProseMirror") !== null;
}

// 静态设定 vs 章后推进的切分由 CATEGORY_META.defaultLayer 单一表态，
// 见 ../lore-workspace-split.ts；此处不再维护第二份分类名单或标题黑名单。

function isImageFilePath(path: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp)$/i.test(path);
}

async function ensureOk(response: Response, fallback: string): Promise<Response> {
  if (response.ok) return response;
  let message = fallback;
  try {
    const payload = await response.json() as { error?: string; message?: string };
    message = payload.error ?? payload.message ?? message;
  } catch {
    message = `${fallback} (${response.status})`;
  }
  throw new Error(message);
}

function copyDestinationFor(sourcePath: string, targetDir: string): string {
  const sourceName = sourcePath.split(/[\\/]/).pop() ?? "copy";
  const baseDestination = targetDir ? `${targetDir}/${sourceName}` : sourceName;
  if (baseDestination !== sourcePath) return baseDestination;
  const dot = sourceName.lastIndexOf(".");
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  const ext = dot > 0 ? sourceName.slice(dot) : "";
  return targetDir ? `${targetDir}/${stem} copy${ext}` : `${stem} copy${ext}`;
}

// ── Types ──────────────────────────────────────────────

export type SidebarView = ViewId;

export interface WorkbenchOpenRequest {
  readonly bookId: string;
  readonly node: WorkbenchResourceNode;
  readonly seq: number;
}

export interface IdeWorkbenchProps {
  bookId?: string;
  repositoryPath?: string;
  nodes: readonly WorkbenchResourceNode[];
  selectedNode: WorkbenchResourceNode | null;
  /**
   * 宿主要求打开的资源（叙述者结果卡「在画布打开」、叙述者面板里点开的章节）。
   * 每个 seq 只处理一次；bookId 与当前书不同的请求忽略。
   */
  openRequest?: WorkbenchOpenRequest | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onDeselectNode?: () => void;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  /** 注册宿主导航前的未保存确认；true 放行，false 阻止，卸载时传 null。 */
  onBeforeLeaveChange?: (guard: (() => Promise<boolean>) | null) => void;
  onCreateChapter?: () => void;
  onGuideComplete?: (outcome?: GuidedSetupOutcome) => void;
  chapterActions?: ChapterActionHandlers;
  chatSlot?: ReactNode;
  onSwitchToAgent?: () => void;
  /** 写作视图的「生成蓝图 / 直接写章」：把已确认的指示交给当前叙述者执行。 */
  onSendToNarrator?: (message: string) => Promise<void> | void;
  bookSessions?: readonly { id: string; title: string; updatedAt?: string }[];
  activeSessionId?: string | null;
  onSwitchSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  /** Task C: 底部"问题"面板数据（传入则显示面板） */
  issues?: readonly EditorIssue[];
  /** 问题条目点击回调（如跳转到对应行） */
  onIssueClick?: (issue: EditorIssue) => void;
  /** Runtime facade only provides semantic workspace resources, not legacy file APIs. */
  runtimeProductMode?: boolean;
  /** Authenticated product fetch for book-scoped auxiliary panels. */
  runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  /** 叙述者结果卡送回的选区改写候选；经 Canvas 传给候选章打开的编辑器。 */
  selectionCandidate?: SelectionCandidate | null;
  onDismissSelectionCandidate?: () => void;
}

// ── ViewContainer 定义（VS Code 风格：每个 Sidebar 视图的元数据） ──

// hasPageHead：面板自带 SidebarPageHead 页头，侧栏顶部不再叠 35px 公共标题条，避免双标题。
const SIDEBAR_VIEWS: { id: SidebarView; icon: LucideIcon; label: string; title: string; hasPageHead?: boolean }[] = [
  { id: "write", icon: PenLine, label: "写作", title: "写作", hasPageHead: true },
  // 资源 = 书里的文件 + 分析工具（原「资源管理器」「分析工具」两个入口，本是同一棵资源树的两组节点）。
  { id: "resources", icon: FolderTree, label: "资源", title: "文件与分析工具" },
  { id: "search", icon: Search, label: "搜索", title: "全局搜索" },
  // 作者语言入口：作品基础统一角色册与世界录，故事推进统一章节/语境/演进。
  { id: "characters-lore", icon: BookOpen, label: "作品基础", title: "角色册与世界录", hasPageHead: true },
  { id: "storyline", icon: Route, label: "故事推进", title: "章节、语境与故事演进", hasPageHead: true },
  { id: "skills-style", icon: Sparkles, label: "技能文风", title: "写作技能与文风", hasPageHead: true },
];

function filePathOf(node: WorkbenchResourceNode): string {
  return String(node.metadata?.filePath ?? node.path ?? "").replace(/\\/g, "/");
}

export function loadedFileKey(bookId: string | undefined, nodeId: string): string {
  return `${bookId ?? "global"}:${nodeId}`;
}

/** 只从文件树裁剪 chapters/，不读取正文，也不带入其它目录。 */
function collectChapterTreeNodes(
  nodes: readonly WorkbenchResourceNode[],
  withinChapters = false,
): WorkbenchResourceNode[] {
  const result: WorkbenchResourceNode[] = [];
  for (const node of nodes) {
    const path = filePathOf(node);
    const inChapters = withinChapters || path === "chapters" || path.startsWith("chapters/");
    const children = node.children ? collectChapterTreeNodes(node.children, inChapters) : [];
    if (!inChapters) continue;
    if (node.kind === "chapter" || node.metadata?.isDirectory === true || children.length > 0) {
      result.push(children.length > 0 ? { ...node, children } : node);
    }
  }
  return result;
}

function collectCategoryNodes(
  nodes: readonly WorkbenchResourceNode[],
  category: string,
): WorkbenchResourceNode[] {
  const result: WorkbenchResourceNode[] = [];
  for (const node of nodes) {
    if (node.metadata?.category === category) {
      result.push(node);
      continue;
    }
    if (node.children) result.push(...collectCategoryNodes(node.children, category));
  }
  return result;
}

/** 面包屑中段按路径前缀定位目录节点：目录嵌在树里，必须递归找，只查顶层会静默落空。 */
function findFileNodeBySubPath(
  nodes: readonly WorkbenchResourceNode[],
  subPath: string,
): WorkbenchResourceNode | null {
  for (const node of nodes) {
    const fp = node.metadata?.filePath;
    if (typeof fp === "string" && (fp === subPath || fp.endsWith("/" + subPath) || fp.endsWith("\\" + subPath))) return node;
    const nested = node.children ? findFileNodeBySubPath(node.children, subPath) : null;
    if (nested) return nested;
  }
  return null;
}

// ── Main Component ──────────────────────────────────────

export function IdeWorkbench({
  bookId,
  repositoryPath,
  nodes,
  selectedNode,
  openRequest,
  onOpen,
  onSave,
  onCanvasContextChange,
  onBeforeLeaveChange,
  onGuideComplete,
  chapterActions,
  chatSlot,
  onSwitchToAgent,
  onSendToNarrator,
  bookSessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  issues,
  onIssueClick,
  runtimeProductMode = false,
  runtimeFetch,
  selectionCandidate,
  onDismissSelectionCandidate,
}: IdeWorkbenchProps) {
  // --- Layout state ---
  const [layoutMode, setLayoutMode] = useState<IdeLayoutMode>(() => initialIdeLayoutMode());
  const [sidebarVisible, setSidebarVisible] = useState(() => defaultIdePaneVisibility(initialIdeLayoutMode()).sidebar);
  const [chatVisible, setChatVisible] = useState(() => defaultIdePaneVisibility(initialIdeLayoutMode()).chat);
  const [showSettings, updateShowSettings] = useState(false);
  const layoutStorageId = bookId ?? "global";
  const initialLayoutSizes = useMemo(() => loadIdeLayoutSizes(layoutStorageId), [layoutStorageId]);
  const layoutSizesRef = useRef(initialLayoutSizes);
  const layoutHostRef = useRef<HTMLDivElement>(null);
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;
  useEffect(() => {
    layoutSizesRef.current = initialLayoutSizes;
  }, [initialLayoutSizes]);
  const handleOuterLayoutDragEnd = useCallback((sizes: number[]) => {
    const next = mergeIdeLayoutSizes(sizes, layoutSizesRef.current);
    layoutSizesRef.current = next;
    saveIdeLayoutSizes(layoutStorageId, next);
  }, [layoutStorageId]);
  useEffect(() => {
    const host = layoutHostRef.current;
    if (!host) return;
    const applyWidth = (width: number) => {
      const nextMode = ideLayoutModeFromWidth(width);
      if (nextMode === layoutModeRef.current) return;
      layoutModeRef.current = nextMode;
      setLayoutMode(nextMode);
      const visibility = defaultIdePaneVisibility(nextMode);
      setSidebarVisible(visibility.sidebar);
      setChatVisible(visibility.chat);
    };
    applyWidth(host.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") applyWidth(width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  // 写作视图「一键修」跳设置时要落到具体分区（如 Writing Skills），不是只打开长表单。
  const [settingsSection, setSettingsSection] = useState<BookSettingsSection | undefined>(undefined);
  const [splitNodeId, updateSplitNodeId] = useState<string | null>(null);
  const splitDraftRef = useRef({ dirty: false, title: "分屏正文" });
  const [entityDetailEntity, setEntityDetailEntity] = useState<string | null>(null);
  // 抽屉按经纬条目 id 读关系；只有名字时由抽屉自己按经纬条目精确匹配。
  const [entityDetailEntryId, setEntityDetailEntryId] = useState<string | undefined>(undefined);
  const [fileClipboard, setFileClipboard] = useState<{ node: WorkbenchResourceNode; mode: "copy" | "cut" } | null>(null);

  const styleDistillationFetch = useCallback<StyleDistillationFetchJson>(async (input, init) => {
    if (runtimeFetch) return runtimeFetch(input, init);
    const response = await fetch(input, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof payload?.error === "string" ? payload.error : "文风蒸馏请求失败"), { status: response.status });
    return payload;
  }, [runtimeFetch]);

  // 文件/条目操作的产品内弹层，取代浏览器原生 confirm/prompt/alert。
  // confirm/prompt/alert 由 useCallback 稳定，可安全进入依赖数组。
  const { confirm: confirmDialog, prompt: promptDialog, alert: alertDialog, element: dialogElement } = useWorkbenchDialogs();

  // --- Command Palette state ---
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"commands" | "files">("commands");

  // --- 命令式面板管理(纯 DOM 操作,学 VS Code CompositePart) ---
  const overlayPanes = idePanesUseOverlay(layoutMode);
  const { activeView, showPanel: revealPanel, hostRef, getContainer, ready: panelsReady } = usePanelManager("resources", overlayPanes ? "overlay" : "split");
  // handleOpen 需要在不重建 callback 链的前提下读取当前视图（它被 handleOpenJingweiEntry/
  // handleJumpToChapter/handleResourceAction 等层层引用，activeView 进依赖会全链路重建）。
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  // --- Tabs ---
  // activeView 本身就是当前七个 ActivityBar ViewId 之一，直接作为 Tab 归属值。
  const tabView: TabView = activeView;
  const ideTabs = useIdeTabs(bookId, tabView);
  const ideTabsRef = useRef(ideTabs);
  ideTabsRef.current = ideTabs;

  const guardLeave = useWorkbenchLeaveGuard(JSON.stringify([bookId, activeView]), confirmDialog);
  const dirtyTabTitles = useCallback(() => ideTabsRef.current.tabs.filter(tab => tab.dirty).map(tab => tab.title), []);
  useLayoutEffect(() => {
    if (!onBeforeLeaveChange) return;
    let registered = true;
    onBeforeLeaveChange(async () => {
      if (!registered) return false;
      const titles = dirtyTabTitles();
      if (splitDraftRef.current.dirty) titles.push(splitDraftRef.current.title);
      let allowed = false;
      await guardLeave(titles, () => { allowed = true; });
      // 回调更换/撤销后，即使原弹窗确认同意，也不能替新宿主导航放行。
      return registered && allowed;
    });
    return () => {
      registered = false;
      onBeforeLeaveChange(null);
    };
  }, [dirtyTabTitles, guardLeave, onBeforeLeaveChange]);
  const showPanel = useCallback((view: SidebarView) => {
    void guardLeave(view === activeViewRef.current ? [] : dirtyTabTitles(), () => revealPanel(view));
  }, [dirtyTabTitles, guardLeave, revealPanel]);
  const setShowSettings = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(showSettings) : value;
    void guardLeave(next && !showSettings ? dirtyTabTitles() : [], () => updateShowSettings(next));
  }, [dirtyTabTitles, guardLeave, showSettings]);
  const setSplitNodeId = useCallback((nodeId: string | null) => {
    void guardLeave(nodeId !== splitNodeId && splitDraftRef.current.dirty ? [splitDraftRef.current.title] : [], () => {
      if (nodeId !== splitNodeId) splitDraftRef.current.dirty = false;
      updateSplitNodeId(nodeId);
    });
  }, [guardLeave, splitNodeId]);

  // --- Portal container for toolbar (WorkbenchCanvas → EditorTabs) ---
  const toolbarSlotRef = useRef<HTMLDivElement>(null);

  // --- Lore / 叙事记忆分类树（始终加载,面板始终 mount） ---
  const [jingweiSections, setJingweiSections] = useState<WorkbenchResourceNode[]>([]);
  const [narrativeMemorySections, setNarrativeMemorySections] = useState<WorkbenchResourceNode[]>([]);
  const [entityFacts, setEntityFacts] = useState<readonly EntityFactLite[]>([]);
  const loreLoadGenerationRef = useRef(0);
  const loreLoadAbortRef = useRef<AbortController | null>(null);
  const loadLoreSections = useCallback(async () => {
    if (!bookId) return;
    const generation = ++loreLoadGenerationRef.current;
    loreLoadAbortRef.current?.abort();
    const controller = new AbortController();
    loreLoadAbortRef.current = controller;
    try {
      const fetchJson = runtimeFetch ?? (async (input: string, init?: RequestInit) => {
        const response = await fetch(input, init);
        if (!response.ok) throw new Error(`请求失败：${response.status}`);
        return response.json();
      });
      const [entRes, factsRes] = await Promise.all([
        fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, { signal: controller.signal }),
        fetchJson(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/facts`, { signal: controller.signal }).catch((error) => {
          if (controller.signal.aborted) throw error;
          return { facts: [] };
        }),
      ]);
      if (controller.signal.aborted || generation !== loreLoadGenerationRef.current) return;
      const entries: Array<{
        id: string;
        title: string;
        category?: string;
        contentMd?: string;
        sectionId?: string;
        fields?: Record<string, unknown>;
        priorityTier?: "auto" | "core" | "relevant" | "reference";
        relatedEntryIds?: string[];
        aliases?: string[];
        visibility?: "global" | "tracked" | "nested";
        visibleAfterChapter?: number | null;
        visibleUntilChapter?: number | null;
        parentId?: string | null;
        status?: string;
        layer?: string;
        version?: number;
        updatedAt?: string;
        conflictStatus?: string;
        conflictDetail?: string;
      }> = entRes?.entries ?? [];
      const memoryFacts: Array<{ id: string; subject: string; predicate: string; object: string; category: string; evidenceText?: string; sourceId?: string; sourceChapter?: number }> = factsRes?.facts ?? [];

      const toEntryNode = (e: typeof entries[number]): WorkbenchResourceNode => ({
        id: `jingwei-entry:${e.id}`,
        kind: "jingwei-entry" as const,
        title: e.title,
        content: e.contentMd ?? "",
        capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
        metadata: {
          entryId: e.id,
          sectionId: e.sectionId,
          isJingweiEntry: true,
          category: e.category,
          fields: e.fields,
          priorityTier: e.priorityTier,
          relatedEntryIds: e.relatedEntryIds,
          aliases: e.aliases,
          visibility: e.visibility,
          visibleAfterChapter: e.visibleAfterChapter,
          visibleUntilChapter: e.visibleUntilChapter,
          parentId: e.parentId,
          status: e.status,
          layer: e.layer,
          version: e.version,
          updatedAt: e.updatedAt,
          conflictStatus: e.conflictStatus,
          conflictDetail: e.conflictDetail,
        },
      });
      const toMemoryFactNode = (fact: typeof memoryFacts[number]): WorkbenchResourceNode => ({
        id: `memory-fact:${fact.id}`,
        kind: "file" as const,
        title: fact.subject,
        content: fact.object,
        capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        metadata: { isNarrativeMemoryEntry: true, category: fact.category, sourceId: fact.sourceId, predicate: fact.predicate, evidenceText: fact.evidenceText },
      });

      // 经纬树分「设定」+「推进」两分区：层级归属由 CATEGORY_META.defaultLayer
      // 表态（见 lore-workspace-split）。动态分类（卷纲/伏笔/章摘要等）进「推进」，
      // 不混叙事记忆；一键修跳 outline 也定位到这里。
      const toCategoryNode = (group: { category: string; name: string; entries: typeof entries }): WorkbenchResourceNode => ({
        id: `jingwei-cat:${group.category}`,
        kind: "group" as const,
        title: `${group.name} (${group.entries.length})`,
        capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        metadata: { category: group.category },
        children: group.entries.map((e) => toEntryNode(e)),
      });
      const settingsGroups = groupEntriesByCategory(entries, "settings");
      const progressGroups = groupEntriesByCategory(entries, "progress");
      const nodes: WorkbenchResourceNode[] = [
        ...(settingsGroups.length > 0 ? [{
          id: "jingwei-workspace-settings",
          kind: "group" as const,
          title: "设定",
          capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
          metadata: { workspace: "settings" as const },
          children: settingsGroups.map((g) => toCategoryNode({ category: g.category, name: g.name, entries: g.entries as typeof entries })),
        } satisfies WorkbenchResourceNode] : []),
        ...(progressGroups.length > 0 ? [{
          id: "jingwei-workspace-progress",
          kind: "group" as const,
          title: "推进",
          capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
          metadata: { workspace: "progress" as const },
          children: progressGroups.map((g) => toCategoryNode({ category: g.category, name: g.name, entries: g.entries as typeof entries })),
        } satisfies WorkbenchResourceNode] : []),
      ];
      const factsByCategory = new Map<string, typeof memoryFacts>();
      for (const fact of memoryFacts) {
        const bucket = factsByCategory.get(fact.category);
        if (bucket) bucket.push(fact);
        else factsByCategory.set(fact.category, [fact]);
      }
      const memoryNodes: WorkbenchResourceNode[] = [...factsByCategory.entries()]
        .sort(([a], [b]) => memoryFactLabel(a).localeCompare(memoryFactLabel(b), "zh-CN"))
        .map(([category, facts]) => ({
          id: `memory-cat:${category}`,
          kind: "group" as const,
          title: `${memoryFactLabel(category)} (${facts.length})`,
          capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
          metadata: { category, isNarrativeMemoryEntry: true },
          children: facts.map((fact) => toMemoryFactNode(fact)),
        }));
      setJingweiSections(nodes);
      setNarrativeMemorySections(memoryNodes);
      setEntityFacts(memoryFacts);
    } catch {
      if (controller.signal.aborted || generation !== loreLoadGenerationRef.current) return;
      setJingweiSections([]);
      setNarrativeMemorySections([]);
      setEntityFacts([]);
    } finally {
      if (loreLoadAbortRef.current === controller) loreLoadAbortRef.current = null;
    }
  }, [bookId, runtimeFetch]);

  useEffect(() => {
    void loadLoreSections();
    return () => {
      loreLoadGenerationRef.current += 1;
      loreLoadAbortRef.current?.abort();
    };
  }, [loadLoreSections]);

  // Runtime books use the same bound, server-authorized IDE filesystem gateway
  // as standalone books. The semantic workspace resources remain available to
  // auxiliary panels, but never replace the visible directory tree.
  const fileTree = useBookFileTree(bookId, Boolean(bookId));
  const refreshFileTree = fileTree.refresh;
  const resourceFileNodes = fileTree.nodes;

  useWritingProgressRefresh(bookId, () => {
    void loadLoreSections();
    refreshFileTree();
  });

  // 有正文章节 → 自动跳过建书引导
  useEffect(() => {
    if (!bookId) return;
    // fileTree.nodes 里有 kind="chapter" 的子节点 = 有正文
    const hasChapters = fileTree.nodes.some(n =>
      n.children?.some(c => c.kind === "chapter")
    );
    if (hasChapters) {
      try { localStorage.setItem(`novelfork:guide-completed:${bookId}`, "true"); } catch { /* ignore */ }
    }
  }, [bookId, fileTree.nodes]);

  // --- Derived ---
  const bookRoot = useMemo(() => nodes.find(n => n.kind === "book"), [nodes]);

  /**
   * 作者配置的单章目标字数（book.json chapterWordCount）。
   * 只从 book 节点 metadata 里读真实值；读不到就是 0，由下游显示"未知"而不是编个默认值。
   */
  const bookChapterWordTarget = useMemo(() => {
    const book = bookRoot?.metadata?.book as { chapterWordCount?: unknown } | undefined;
    const target = Number(book?.chapterWordCount);
    return Number.isFinite(target) && target > 0 ? target : 0;
  }, [bookRoot]);

  const bookTargetChapters = useMemo(() => {
    const book = bookRoot?.metadata?.book as { targetChapters?: unknown } | undefined;
    const target = Number(book?.targetChapters);
    return Number.isFinite(target) && target > 0 ? target : undefined;
  }, [bookRoot]);

  // 分析工具节点（「资源」侧栏的分析工具分区 + Tab 解析都需要）
  const toolNodes = useMemo(() => {
    const root = createToolSectionNodes();
    return root.children ?? [];
  }, []);

  const chapterTreeNodes = useMemo(() => collectChapterTreeNodes(fileTree.nodes), [fileTree.nodes]);
  const outlineTreeNodes = useMemo(() => collectCategoryNodes(jingweiSections, "outline"), [jingweiSections]);
  // 章后事实中央面板节点（IA 收敛后的唯一权威入口；侧栏只放轻量摘要卡）。
  const memoryCenterNode = useMemo(() => (bookId ? createMemoryCenterNode(bookId) : null), [bookId]);
  // 故事推进大屏画布的默认节点（evolution 视图）；侧栏跳转会以带 preferredView 的节点覆盖缓存。
  const storyProgressionNode = useMemo(() => (bookId ? createStoryProgressionNode(bookId) : null), [bookId]);
  // 「设定图谱」合成节点：不在资源树里，登记进 resourceMap，Tab 才解析得到（含刷新后恢复的 Tab），否则画布停在书籍总览。
  const loreTreesNode = useMemo(() => (bookId ? createLoreTreesNode(bookId) : null), [bookId]);
  // 「工作流」合成节点（写作视图的中央标签）：同理登记进 resourceMap，刷新后恢复的标签才不会空白。
  const workflowNode = useMemo(() => (bookId ? createWorkflowNode(bookId) : null), [bookId]);

  const resourceMap = useMemo(() => {
    const map = new Map<string, WorkbenchResourceNode>();
    const walk = (n: WorkbenchResourceNode) => { map.set(n.id, n); n.children?.forEach(walk); };
    (nodes as WorkbenchResourceNode[]).forEach(walk);
    // 文件树节点也加入，使点击文件能解析 activeNode
    fileTree.nodes.forEach(walk);
    jingweiSections.forEach(walk);
    narrativeMemorySections.forEach(walk);
    // 工具节点也加入，使点击工具能解析 activeNode → 渲染真实工具面板
    toolNodes.forEach(walk);
    if (memoryCenterNode) map.set(memoryCenterNode.id, memoryCenterNode);
    if (storyProgressionNode) map.set(storyProgressionNode.id, storyProgressionNode);
    if (loreTreesNode) map.set(loreTreesNode.id, loreTreesNode);
    if (workflowNode) map.set(workflowNode.id, workflowNode);
    return map;
  }, [nodes, fileTree.nodes, jingweiSections, narrativeMemorySections, toolNodes, memoryCenterNode, storyProgressionNode, loreTreesNode, workflowNode]);

  // 文件树节点点击后加载的内容缓存；key 带 bookId，避免跨书复用同名资源。
  const [loadedFiles, setLoadedFiles] = useState<Map<string, WorkbenchResourceNode>>(new Map());
  const fileReadGenerationRef = useRef(0);
  const fileReadControllersRef = useRef(new Set<AbortController>());
  const currentBookIdRef = useRef(bookId);
  currentBookIdRef.current = bookId;
  const abortFileReads = useCallback(() => {
    fileReadGenerationRef.current += 1;
    for (const controller of fileReadControllersRef.current) controller.abort();
    fileReadControllersRef.current.clear();
  }, []);
  useEffect(() => {
    abortFileReads();
    setLoadedFiles(new Map());
    return () => abortFileReads();
  }, [abortFileReads, bookId]);

  const activeNode = useMemo(() => {
    if (!ideTabs.activeTabId) return null;
    return loadedFiles.get(loadedFileKey(bookId, ideTabs.activeTabId)) ?? resourceMap.get(ideTabs.activeTabId) ?? null;
  }, [bookId, ideTabs.activeTabId, resourceMap, loadedFiles]);

  // 分屏节点解析
  const splitNode = useMemo(() => {
    if (!splitNodeId) return null;
    return loadedFiles.get(loadedFileKey(bookId, splitNodeId)) ?? resourceMap.get(splitNodeId) ?? null;
  }, [bookId, splitNodeId, resourceMap, loadedFiles]);

  // 多实例条件渲染：收集所有需要保持 mount 的 Tab 节点
  const multiTabNodes = useMemo(() => {
    return ideTabs.tabs
      .map(tab => {
        const node = loadedFiles.get(loadedFileKey(bookId, tab.id)) ?? resourceMap.get(tab.id) ?? null;
        if (!node) return null;
        return { tabId: tab.id, node };
      })
      .filter((x): x is { tabId: string; node: WorkbenchResourceNode } => x !== null);
  }, [bookId, ideTabs.tabs, resourceMap, loadedFiles]);

  // 章节文件对账：叙述者的通用写工具、Runtime 编辑器、外部编辑器改过的章节，服务端补做附带动作后
  // 这里刷新面板；已打开且没有未保存修改的章节读到新正文后原地替换，有未保存修改的只提示，不覆盖作者的输入。
  const loadedFilesRef = useRef(loadedFiles);
  loadedFilesRef.current = loadedFiles;
  useChapterReconcile(bookId, (changes, { reset }) => {
    dispatchWritingProgress({ reason: "chapter-reconcile", ...(bookId ? { bookId } : {}) });
    // 变更不全（服务重启或落后太多）时只刷新面板，不动已打开的标签，避免误丢作者的输入。
    if (reset || !bookId) return;
    const changedPaths = new Set(changes.map((change) => change.path));
    const dirtyTitles: string[] = [];
    for (const tab of ideTabsRef.current.tabs) {
      const key = loadedFileKey(bookId, tab.id);
      const node = loadedFilesRef.current.get(key);
      const filePath = node?.metadata?.filePath;
      // 还没读入过内容的标签，激活时自然会读到新正文。
      if (!node || typeof filePath !== "string" || !changedPaths.has(filePath)) continue;
      if (tab.dirty) {
        dirtyTitles.push(tab.title);
        continue;
      }
      // 先读到新正文再替换，中途不留"空内容"的状态：那会被编辑器当成作者清空了正文。
      void fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(filePath)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`请求失败：${response.status}`);
          return response.json() as Promise<{ content?: string }>;
        })
        .then((data) => {
          if (typeof data.content !== "string" || currentBookIdRef.current !== bookId) return;
          if (ideTabsRef.current.tabs.find((current) => current.id === tab.id)?.dirty) return;
          clearEditorState(tab.id);
          setLoadedFiles((previous) => {
            const current = previous.get(key);
            if (!current) return previous;
            return new Map(previous).set(key, { ...current, content: data.content });
          });
        })
        .catch(() => { /* 下一次对账或重新打开时再读 */ });
    }
    if (dirtyTitles.length > 0) {
      toast(
        `「${dirtyTitles.join("」「")}」已在别处被修改（叙述者或外部编辑器），这里还有未保存的内容；现在保存会覆盖那边的修改。`,
        "info",
      );
    }
  });

  // 恢复的文件 Tab 懒加载内容：active 节点是文件但尚未加载过内容时拉取一次
  useEffect(() => {
    const node = activeNode;
    if (!node || !bookId) return;
    const filePath = node.metadata?.filePath;
    if (!node.metadata?.isFile || typeof filePath !== "string") return;
    const cacheKey = loadedFileKey(bookId, node.id);
    if (loadedFiles.has(cacheKey)) return; // 已加载
    const generation = fileReadGenerationRef.current;
    const controller = new AbortController();
    fileReadControllersRef.current.add(controller);
    fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(filePath)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`请求失败：${response.status}`);
        return response.json() as Promise<{ content?: string }>;
      })
      .then((data) => {
        if (controller.signal.aborted || generation !== fileReadGenerationRef.current || currentBookIdRef.current !== bookId) return;
        const loaded: WorkbenchResourceNode = { ...node, content: data.content ?? "" };
        setLoadedFiles(prev => new Map(prev).set(cacheKey, loaded));
      })
      .catch(() => { /* ignore aborted/stale reads */ })
      .finally(() => fileReadControllersRef.current.delete(controller));
    return () => controller.abort();
  }, [activeNode, bookId, loadedFiles]);

  // 所有关闭入口共用确认；只关闭发起时的目标，不把等待弹窗期间新开的标签算进去。
  const handleCloseTabs = useCallback((tabIds: readonly string[]) => {
    const targets = ideTabsRef.current.tabs.filter(tab => tabIds.includes(tab.id));
    return guardLeave(targets.filter(tab => tab.dirty).map(tab => tab.title), () => {
      for (const tab of targets) {
        ideTabsRef.current.closeTab(tab.id);
        clearEditorState(tab.id);
      }
      setLoadedFiles(previous => {
        const next = new Map(previous);
        for (const tab of targets) next.delete(loadedFileKey(bookId, tab.id));
        return next;
      });
    });
  }, [bookId, guardLeave]);
  const handleCloseTab = useCallback((tabId: string) => handleCloseTabs([tabId]), [handleCloseTabs]);
  const handleCloseAllTabs = useCallback(() => handleCloseTabs(
    ideTabsRef.current.tabs.filter(tab => !tab.pinned).map(tab => tab.id),
  ), [handleCloseTabs]);
  const handleCloseOthers = useCallback((tabId: string) => handleCloseTabs(
    ideTabsRef.current.tabs.filter(tab => tab.id !== tabId && !tab.pinned).map(tab => tab.id),
  ), [handleCloseTabs]);
  const handleCloseRight = useCallback((tabId: string) => {
    const tabs = ideTabsRef.current.tabs;
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index >= 0) void handleCloseTabs(tabs.slice(index + 1).filter(tab => !tab.pinned).map(tab => tab.id));
  }, [handleCloseTabs]);
  const handleCloseSaved = useCallback(() => handleCloseTabs(
    ideTabsRef.current.tabs.filter(tab => !tab.dirty && !tab.pinned).map(tab => tab.id),
  ), [handleCloseTabs]);

  const handleOpen = useCallback((node: WorkbenchResourceNode) => {
    // 核心不变量：Tab 按 toTabView(node) 归属到对应工作区，而 EditorTabs/主区只渲染
    // 当前 ActivityBar 视图的 tab。因此打开后必须把侧栏切到 tab 归属的工作区，
    // 否则跨视图点击（写作页/搜索/故事推进里点角色卡、章节、伏笔等）tab 隐身，
    // 主区看起来"没有反应"。
    const revealTab = (kind: TabKind, view: TabView) => {
      // 标签标题用作者语言：章节显示「第 N 章 标题」，「资源」的文件树里仍是真实文件名。
      ideTabsRef.current.openTab(node.id, resourceDisplayTitle(node), kind, view);
      if (view !== activeViewRef.current) showPanel(view);
      if (idePanesUseOverlay(layoutModeRef.current)) {
        setSidebarVisible(false);
        setChatVisible(false);
      } else if (view !== activeViewRef.current) {
        setSidebarVisible(true);
      }
    };
    // 文件树节点：先加载内容
    if (node.metadata?.isFile && bookId && typeof node.metadata.filePath === "string") {
      const filePath = node.metadata.filePath;
      if (isImageFilePath(filePath)) {
        revealTab("file", "resources");
        onOpen(node);
        return;
      }
      const generation = fileReadGenerationRef.current;
      const controller = new AbortController();
      fileReadControllersRef.current.add(controller);
      void fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(filePath)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`请求失败：${response.status}`);
          return response.json() as Promise<{ content?: string }>;
        })
        .then((data) => {
          if (controller.signal.aborted || generation !== fileReadGenerationRef.current || currentBookIdRef.current !== bookId) return;
          let content = data.content ?? "";
          // 性能保护:超过 500KB 的文件截断显示,避免 TipTap 卡死
          const MAX_CHARS = 500_000;
          if (content.length > MAX_CHARS) {
            content = content.slice(0, MAX_CHARS) + `\n\n---\n注意：文件过大（${(content.length / 1000).toFixed(0)}K 字符），仅显示前 ${MAX_CHARS / 1000}K。请使用外部编辑器打开完整文件。`;
          }
          const loaded: WorkbenchResourceNode = { ...node, content };
          const cacheKey = loadedFileKey(bookId, node.id);
          setLoadedFiles(prev => new Map(prev).set(cacheKey, loaded));
          // 章节是全书主对象：从哪个工作区点开，tab 就落在哪个工作区，
          // 不再把活动栏拽去资源（reducer 会把旧视图里的同章 tab 搬过来，不会重影）。
          if (node.kind === "chapter") revealTab(toTabKind(node), activeViewRef.current);
          else revealTab("file", "resources");
          onOpen(loaded);
        })
        .catch(() => {
          if (controller.signal.aborted || generation !== fileReadGenerationRef.current || currentBookIdRef.current !== bookId) return;
          if (node.kind === "chapter") revealTab(toTabKind(node), activeViewRef.current);
          else revealTab("file", "resources");
          onOpen(node);
        })
        .finally(() => fileReadControllersRef.current.delete(controller));
      return;
    }
    // 搜索/结算历史生成的叙事记忆详情节点不在静态资源树中；缓存完整节点，
    // 否则 Tab 虽会激活，但 activeNode 无法解析，画布仍停留在旧面板而显示空白。
    if (
      node.metadata?.isNarrativeMemoryEntry === true ||
      node.kind === "jingwei-entry" ||
      // 故事画布节点不在静态资源树中（preferredView 随点击变化），必须缓存完整节点：
      // 否则同一 tab 二次跳转时 activeNode 解析回 resourceMap 默认视图，视图切换失效。
      node.metadata?.isStoryProgression === true
    ) {
      setLoadedFiles((previous) => new Map(previous).set(loadedFileKey(bookId, node.id), node));
    }
    // 章节同上：留在点开它的工作区（资源树里的章节点开时当前视图本就是资源，行为不变）。
    if (node.capabilities.open) revealTab(toTabKind(node), node.kind === "chapter" ? activeViewRef.current : toTabView(node));
    onOpen(node);
  }, [onOpen, bookId, showPanel]);

  // 不看 selectedNode：它在后台刷新、保存后都会换成新对象，据它重开会把侧栏拽回资源所在视图。
  const handledOpenRequestRef = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.bookId !== bookId || handledOpenRequestRef.current === openRequest.seq) return;
    handledOpenRequestRef.current = openRequest.seq;
    handleOpen(openRequest.node);
  }, [openRequest, bookId, handleOpen]);

  const handleOpenJingweiEntry = useCallback((entryId: string): boolean => {
    const findEntry = (items: readonly WorkbenchResourceNode[]): WorkbenchResourceNode | null => {
      for (const item of items) {
        if (item.kind === "jingwei-entry" && item.metadata?.entryId === entryId) return item;
        const nested = item.children ? findEntry(item.children) : null;
        if (nested) return nested;
      }
      return null;
    };
    const target = findEntry(jingweiSections);
    if (!target) return false;
    handleOpen(target);
    return true;
  }, [handleOpen, jingweiSections]);

  // 图谱实体节点点击：身份链命中（带 entryId）时直接打开对应经纬条目卡
  // （角色类目落角色卡、世界侧落世界卡）；未命中回落实体详情抽屉。
  const handleOpenEntityFromGraph = useCallback((entity: string, entryId?: string) => {
    if (entryId && handleOpenJingweiEntry(entryId)) return;
    setEntityDetailEntryId(entryId);
    setEntityDetailEntity(entity);
  }, [handleOpenJingweiEntry]);

  // 人物关系网的「资料卡」：总是打开实体抽屉（不跳经纬卡），带上条目 id。
  const handleOpenEntityDrawer = useCallback((entity: string, entryId?: string) => {
    setEntityDetailEntryId(entryId);
    setEntityDetailEntity(entity);
  }, []);

  // 按章节号跳转（下一章页、推进板、章后事实等的来源章）：在资源/文件树中找到章节节点并打开
  const handleJumpToChapter = useCallback((chapterNumber: number) => {
    // 章节节点来源有二：资源树（metadata.chapterNumber）与文件树（chapters/NNNN_*.md）
    const findChapterNode = (ns: readonly WorkbenchResourceNode[]): WorkbenchResourceNode | null => {
      for (const n of ns) {
        if (n.kind === "chapter") {
          // 资源树：metadata.chapterNumber 直接匹配
          if (typeof n.metadata?.chapterNumber === "number" && n.metadata.chapterNumber === chapterNumber) {
            return n;
          }
          // 文件树：从 chapters/NNNN_xxx.md 解析章节号
          const filePath = typeof n.metadata?.filePath === "string" ? n.metadata.filePath : n.path;
          if (typeof filePath === "string") {
            const m = filePath.match(/chapters[\\/](\d{4})_/);
            if (m && parseInt(m[1], 10) === chapterNumber) return n;
          }
        }
        if (n.children) {
          const found = findChapterNode(n.children);
          if (found) return found;
        }
      }
      return null;
    };

    const target = findChapterNode(nodes) ?? findChapterNode(fileTree.nodes);
    if (target) {
      handleOpen(target);
    } else {
      toast(`找不到第 ${chapterNumber} 章的章文件`, "warning");
    }
  }, [nodes, fileTree.nodes, handleOpen]);

  // --- URL 参数驱动面板（?panel=foreshadowing 等） ---
  const urlPanelConsumedRef = useRef(false);
  useEffect(() => {
    if (!bookId || urlPanelConsumedRef.current) return;
    let panelId: string | null = null;
    try {
      panelId = new URLSearchParams(window.location.search).get("panel");
    } catch { /* non-URL env */ }
    if (!panelId) return;
    urlPanelConsumedRef.current = true;
    const nodeId = `tool:${panelId}`;
    const toolNode = resourceMap.get(nodeId);
    if (toolNode) {
      handleOpen(toolNode);
    }
    // Clean up the URL parameter without triggering a page reload
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("panel");
      window.history.replaceState(null, "", url.toString());
    } catch { /* ignore */ }
  }, [bookId, resourceMap, handleOpen]);

  const handleCanvasContextChange = useCallback((ctx: WorkbenchCanvasContext) => {
    const { activeTabId, setDirty } = ideTabsRef.current;
    const tabId = ctx.activeTabId;
    if (tabId) setDirty(tabId, ctx.dirty);
    if (tabId === activeTabId || !tabId) onCanvasContextChange?.(ctx);
    // 切换已挂载的 Tab 时也让画布重新上报上下文，后台保存只更新自身 dirty。
  }, [onCanvasContextChange, ideTabs.activeTabId]);

  // 经纬条目保存/删除（调 API），供 WorkbenchCanvas 的 JingweiEntryEditor 使用
  const jingweiActions = useMemo(() => {
    if (!bookId) return undefined;
    return {
      onSave: async (entryId: string, payload: JingweiEntrySavePayload) => {
        const body: Record<string, unknown> = {
          title: payload.title,
          contentMd: payload.contentMd,
        };
        if (payload.priorityTier !== undefined) body.priorityTier = payload.priorityTier;
        if (payload.layer !== undefined) body.layer = payload.layer;
        if (payload.status !== undefined) body.status = payload.status;
        if (payload.category !== undefined) body.category = payload.category;
        if (payload.aliases !== undefined) body.aliases = payload.aliases;
        if (payload.relatedEntryIds !== undefined) body.relatedEntryIds = payload.relatedEntryIds;
        if (payload.fields !== undefined) body.fields = payload.fields;
        if (payload.visibility !== undefined || payload.visibleAfterChapter !== undefined || payload.visibleUntilChapter !== undefined) {
          body.visibilityRule = {
            type: payload.visibility ?? "tracked",
            ...(payload.visibleAfterChapter != null ? { visibleAfterChapter: payload.visibleAfterChapter } : {}),
            ...(payload.visibleUntilChapter != null ? { visibleUntilChapter: payload.visibleUntilChapter } : {}),
          };
        }
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message ?? `经纬保存失败（${response.status}）`);
        }
        // 保存后刷新侧栏树，避免改分类/状态/层级后树漂移
        void loadLoreSections();
      },
      onDelete: async (entryId: string) => {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(`经纬删除失败（${response.status}）`);
        void loadLoreSections();
      },
    };
  }, [bookId, loadLoreSections]);

  // ── 面包屑导航 ──
  // 解析某段面包屑的可导航目标：解析不到就回 null，渲染侧据此把该段画成不可点，
  // 不再保留「看着能点、点了没反应」的死段。
  const resolveBreadcrumbTarget = useCallback((segment: string, index: number): WorkbenchResourceNode | "close-all" | null => {
    if (index === 0) return "close-all"; // 书名 → 关闭所有 tab 回到驾驶舱
    if (!activeNode) return null;

    // 文件节点：尝试拼接路径段找到对应资源
    if (activeNode.metadata?.isFile) {
      const filePath = activeNode.metadata?.filePath;
      if (typeof filePath !== "string") return null;
      const parts = filePath.split(/[\\/]/).filter(Boolean);
      const subPath = parts.slice(0, index).join("/");
      return subPath ? findFileNodeBySubPath(fileTree.nodes, subPath) : null;
    }

    // 经纬条目：分类段 → 分类节点（节点嵌在「设定 / 推进」工作区分组里，递归找）
    if (activeNode.kind === "jingwei-entry" || activeNode.kind === "jingwei") {
      const catMeta = CATEGORY_META.find(m => m.name === segment);
      if (!catMeta) return null;
      return collectCategoryNodes(jingweiSections, catMeta.id)[0] ?? null;
    }
    return null;
  }, [activeNode, fileTree.nodes, jingweiSections]);

  const handleBreadcrumbNavigate = useCallback((segment: string, index: number) => {
    const target = resolveBreadcrumbTarget(segment, index);
    if (target === "close-all") { void handleCloseAllTabs(); return; }
    if (target) handleOpen(target);
  }, [resolveBreadcrumbTarget, handleOpen, handleCloseAllTabs]);

  const canNavigateBreadcrumb = useCallback(
    (segment: string, index: number) => resolveBreadcrumbTarget(segment, index) !== null,
    [resolveBreadcrumbTarget],
  );

  // ActivityBar click: VS Code 行为 — 同一个图标折叠，不同图标切换
  // ActivityBar click: 命令式切换面板
  const handleViewClick = useCallback((view: SidebarView) => {
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
      return;
    }
    showPanel(view);
    setSidebarVisible(true);
    if (idePanesUseOverlay(layoutModeRef.current)) setChatVisible(false);
  }, [activeView, sidebarVisible, showPanel]);
  const handleChatToggle = useCallback(() => {
    setChatVisible((visible) => {
      const next = !visible;
      if (next && idePanesUseOverlay(layoutModeRef.current)) setSidebarVisible(false);
      return next;
    });
  }, []);

  // ── 写作视图：只读就绪查询 + 少数一键修工具 ──
  const writeViewCallTool = useCallback(async (tool: string, input: Record<string, unknown>) => {
    if (!bookId) throw new Error("尚未绑定书籍。");
    const fetchJson = runtimeFetch ?? (async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`请求失败：${response.status}`);
      return response.json();
    });
    const base = `/api/books/${encodeURIComponent(bookId)}`;
    const post = (path: string, body: Record<string, unknown>) => fetchJson(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    switch (tool) {
      // 只读查询走 HTTP；任何写入都必须经叙述者与 Runtime 权限确认。
      case "write.preflight":
        return post("/write/preflight", input);
      // 卷驾驶舱只读当前卷上下文：复用写作就绪路由的 outline.volume(action=get)，
      // 不新造 fetch 封装，也不在前端拼装书籍路径或 narrator 标识。
      case "outline.volume":
        return fetchJson(`${base}/write/volume`);
      default:
        throw new Error(`写作视图不直接执行 ${tool}，请在对话中调用。`);
    }
  }, [bookId, runtimeFetch]);

  const handleRunWrite = useCallback((payload: {
    mode: "blueprint" | "chapter";
    chapterNumber: number;
    directive: string;
    acceptFocusDefault: boolean;
    beatBudget?: readonly BeatBudgetItem[];
  }) => {
    void onSendToNarrator?.(buildWriteRequestMessage(payload));
  }, [onSendToNarrator]);

  /**
   * 章节保存包装：保存落盘后派发写作进度事件，写作视图据此自动刷新就绪、
   * 卷驾驶舱与本章提议，去掉「保存后必须手动点刷新」。用一次性 DOM 事件而非
   * 轮询定时器：只在真正保存成功时触发一次。
   */
  const handleSaveWithProgress = useCallback(async (node: WorkbenchResourceNode, content: string) => {
    const generation = fileReadGenerationRef.current;
    await onSave(node, content);
    if (currentBookIdRef.current !== bookId || generation !== fileReadGenerationRef.current) return;
    // 文件 Tab 优先读取 loadedFiles；成功后同步这份缓存，避免重挂载时显示保存前的正文。
    setLoadedFiles((previous) => {
      const key = loadedFileKey(bookId, node.id);
      const cached = previous.get(key);
      if (!cached) return previous;
      return new Map(previous).set(key, { ...cached, content });
    });
    dispatchWritingProgress({ reason: "chapter-save", ...(bookId ? { bookId } : {}) });
  }, [bookId, onSave]);

  /**
   * 建书十一问完成 → 把 Skills 启用确认与深追问交给叙述者。
   *
   * 消息模板留在小说领域侧；工具执行、权限确认与 AskUserQuestion 渲染全在
   * Runtime。没有可用叙述者时只刷新工作台，不静默丢步骤。
   */
  const handleGuideCompleteWithOnboarding = useCallback((outcome?: GuidedSetupOutcome) => {
    onGuideComplete?.(outcome);
    if (!onSendToNarrator) return;
    void Promise.resolve(onSendToNarrator(buildOnboardingRequestMessage({
      ...(bookRoot?.title ? { bookTitle: bookRoot.title } : {}),
      ...(outcome?.recommendedWritingSkills
        ? { recommendedWritingSkills: outcome.recommendedWritingSkills.map((skill) => ({ name: skill.name, reason: skill.reason })) }
        : {}),
      ...(outcome?.matchedGenreCluster !== undefined ? { matchedGenreCluster: outcome.matchedGenreCluster } : {}),
    }))).catch(() => undefined);
  }, [bookRoot?.title, onGuideComplete, onSendToNarrator]);

  /**
   * 写作视图「一键修」→ 打开写作设置并定位分区。
   * `style-disabled` 的判据是当前项目 `.novelfork/skills/` 的实际文件，
   * 唯一能改它的界面是这里的 Writing Skills 面板。
   */
  const handleOpenSettingsSection = useCallback((section?: BookSettingsSection) => {
    setSettingsSection(section);
    setShowSettings(true);
  }, [setShowSettings]);

  /**
   * 写作视图「一键修」→ 切到角色与设定视图并定位分类。
   *
   * 角色与设定树分「设定」「推进」两个顶层分区（见 loadLoreSections），
   * 动态分类（outline 卷纲等）在「推进」分区下，同样可定位。
   */
  const handleOpenLorePanel = useCallback((category?: string) => {
    setShowSettings(false);
    showPanel("characters-lore");
    setSidebarVisible(true);
    if (idePanesUseOverlay(layoutModeRef.current)) setChatVisible(false);
    if (category) {
      const findCategory = (items: readonly WorkbenchResourceNode[]): WorkbenchResourceNode | null => {
        for (const item of items) {
          if (item.metadata?.category === category) return item;
          const nested = item.children ? findCategory(item.children) : null;
          if (nested) return nested;
        }
        return null;
      };
      const target = findCategory(jingweiSections);
      if (target) handleOpen(target);
    }
  }, [showPanel, jingweiSections, handleOpen, setShowSettings]);

  /**
   * 回到作品总览：「资源」侧栏顶部的「作品总览」，以及写作视图起书引导卡的「先回答建书十一问」。
   *
   * 作品总览（新书时是十一问）长在「资源」视图没有激活标签时的中央画布上。这里切到
   * 「资源」并让它的标签暂时不激活（标签保留，作者的未保存内容不受影响）。
   * 窄屏下侧栏是浮层，会盖住画布，所以顺手收起。
   */
  const handleShowBookOverview = useCallback(() => {
    setShowSettings(false);
    ideTabsRef.current.deactivateView?.("resources");
    showPanel("resources");
    if (idePanesUseOverlay(layoutModeRef.current)) {
      setSidebarVisible(false);
      setChatVisible(false);
    } else {
      setSidebarVisible(true);
    }
  }, [showPanel, setShowSettings]);

  // 与作品总览同一判据：资源树里已有章节的书不再显示十一问。
  const bookHasChapters = useMemo(() => containsChapterNode(nodes), [nodes]);

  // ── 快捷键系统 ──
  const keybindingActions = useMemo(() => ({
    save: () => {
      window.dispatchEvent(new CustomEvent("ide:save"));
    },
    closeTab: () => {
      const tabId = ideTabsRef.current.activeTabId;
      if (tabId) void handleCloseTab(tabId);
    },
    toggleSidebar: () => {
      setSidebarVisible((visible) => {
        const next = !visible;
        if (next && idePanesUseOverlay(layoutModeRef.current)) setChatVisible(false);
        return next;
      });
    },
    toggleChat: handleChatToggle,
    nextTab: () => {
      const { tabs, activeTabId, activateTab } = ideTabsRef.current;
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex(t => t.id === activeTabId);
      activateTab(tabs[(idx + 1) % tabs.length].id);
    },
    prevTab: () => {
      const { tabs, activeTabId, activateTab } = ideTabsRef.current;
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex(t => t.id === activeTabId);
      activateTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    },
    switchView: (view: SidebarView) => {
      setShowSettings(false);
      showPanel(view);
      setSidebarVisible(true);
      if (idePanesUseOverlay(layoutModeRef.current)) setChatVisible(false);
    },
    openCommandPalette: () => {
      setPaletteMode("commands");
      setPaletteOpen(true);
    },
    openQuickOpen: () => {
      setPaletteMode("files");
      setPaletteOpen(true);
    },
  }), [handleChatToggle, handleCloseTab, setShowSettings, showPanel]);
  useIdeKeybindings(keybindingActions);

  // ── 命令面板 ──
  const ideCommandOptions = useMemo(() => ({
    switchView: keybindingActions.switchView,
    toggleSidebar: keybindingActions.toggleSidebar,
    toggleChat: keybindingActions.toggleChat,
    setShowSettings,
    closeTab: keybindingActions.closeTab,
    closeAllTabs: handleCloseAllTabs,
    // 导入是写操作：交给叙述者执行，保留 Runtime 的权限确认；没有叙述者会话时明说而不静默。
    openImportWizard: onSendToNarrator
      ? () => { void onSendToNarrator(
        "我要导入一本已有的旧书继续写。请先问我要导入的文本或文件，然后用 pipeline.import_chapters（autoSettle+extractBrief）导入；拆书产物先留在 needs-review，等我确认再入 canon。",
      ); }
      : () => { void alertDialog({ title: "导入旧书", description: "先在对话里开启叙述者会话，再导入旧书。" }); },
    sendToNarrator: (message: string) => { void onSendToNarrator?.(message); },
  }), [onSendToNarrator, alertDialog, keybindingActions, setShowSettings, handleCloseAllTabs]);
  const ideCommands = useIdeCommands(ideCommandOptions);

  // Quick Open: flatten file tree + jingwei entries into palette commands
  const quickOpenCommands = useMemo(() => {
    const items: import("./command-palette").PaletteCommand[] = [];
    const walkFiles = (nodes: readonly WorkbenchResourceNode[]) => {
      for (const n of nodes) {
        if (n.metadata?.isFile) {
          items.push({
            id: `qo:${n.id}`,
            label: n.title,
            category: "文件",
            execute: () => handleOpen(n),
          });
        }
        if (n.children) walkFiles(n.children);
      }
    };
    walkFiles(fileTree.nodes);
    // Jingwei entries
    for (const section of jingweiSections) {
      if (section.children) {
        for (const entry of section.children) {
          items.push({
            id: `qo:${entry.id}`,
            label: entry.title,
            category: "作品基础",
            execute: () => handleOpen(entry),
          });
        }
      }
    }
    return items;
  }, [fileTree.nodes, jingweiSections, handleOpen]);

  // ── 文件树右键菜单操作 ──
  const handleResourceAction = useCallback(async (action: import("../WorkbenchResourceTree").ResourceTreeAction) => {
    if (!bookId) return;
    const { type, node } = action;
    const filePath = node.metadata?.filePath;
    if (type === "delete" && typeof filePath === "string") {
      const isDir = node.metadata?.isDirectory === true;
      const warning = isDir ? "此文件夹及其所有内容将被递归删除，" : "";
      const confirmed = await confirmDialog({
        title: `确认删除 "${node.title}"？`,
        description: `${warning}此操作不可撤销。`,
        confirmLabel: "删除",
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath }),
        }), "删除文件失败");
        refreshFileTree();
      } catch (err) {
        await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
      }
    } else if (type === "rename" && typeof filePath === "string") {
      const newName = action.newName ?? await promptDialog({ title: "重命名", defaultValue: node.title, confirmLabel: "重命名" });
      if (!newName || newName === node.title) return;
      const dir = filePath.replace(/[/\\][^/\\]+$/, "");
      const newPath = dir ? `${dir}/${newName}` : newName;
      try {
        await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: filePath, to: newPath }),
        }), "重命名文件失败");
        refreshFileTree();
      } catch (err) {
        await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
      }
    } else if (type === "create") {
      // 经纬条目创建
      if (node.kind === "jingwei-section" && bookId) {
        const title = await promptDialog({ title: "新建设定条目", placeholder: "条目标题", confirmLabel: "创建" });
        if (!title) return;
        const category = node.metadata?.category ?? node.id.replace("jingwei-section:", "");
        try {
          await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, category, contentMd: "" }),
          }), "创建设定条目失败");
        } catch (err) {
          await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
        }
      }
    } else if (type === "create-file" && typeof filePath === "string") {
      const name = action.name ?? await promptDialog({ title: "新建文件", placeholder: "文件名", confirmLabel: "创建" });
      if (!name) return;
      const dir = node.metadata?.isDirectory ? filePath : filePath.replace(/[/\\][^/\\]+$/, "");
      try {
        await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dir ? `${dir}/${name}` : name, content: "" }),
        }), "创建文件失败");
        refreshFileTree();
      } catch (err) {
        await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
      }
    } else if (type === "create-folder" && typeof filePath === "string") {
      const name = action.name ?? await promptDialog({ title: "新建文件夹", placeholder: "文件夹名", confirmLabel: "创建" });
      if (!name) return;
      const dir = node.metadata?.isDirectory ? filePath : filePath.replace(/[/\\][^/\\]+$/, "");
      try {
        await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files/mkdir`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dir ? `${dir}/${name}` : name }),
        }), "创建文件夹失败");
        refreshFileTree();
      } catch (err) {
        await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
      }
    } else if (type === "copy-path" && typeof filePath === "string") {
      try {
        await navigator.clipboard?.writeText(filePath);
      } catch {
        // Clipboard may be unavailable in non-secure contexts; ignore silently.
      }
    } else if (type === "copy" && typeof filePath === "string") {
      setFileClipboard({ node, mode: "copy" });
    } else if (type === "cut" && typeof filePath === "string") {
      setFileClipboard({ node, mode: "cut" });
    } else if (type === "paste" && fileClipboard && typeof fileClipboard.node.metadata?.filePath === "string") {
      const targetPath = typeof filePath === "string" ? filePath : "";
      const targetDir = node.metadata?.isDirectory ? targetPath : targetPath.replace(/[/\\][^/\\]+$/, "");
      const sourcePath = fileClipboard.node.metadata.filePath;
      const sourceName = sourcePath.split(/[\\/]/).pop() ?? fileClipboard.node.title;
      const moveDestination = targetDir ? `${targetDir}/${sourceName}` : sourceName;
      const destination = fileClipboard.mode === "copy" ? copyDestinationFor(sourcePath, targetDir) : moveDestination;
      try {
        if (fileClipboard.mode === "cut") {
          await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: sourcePath, to: destination }),
          }), "移动文件失败");
          setFileClipboard(null);
        } else {
          const readResponse = await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(sourcePath)}`), "读取源文件失败");
          const read = await readResponse.json();
          await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: destination, content: read.content ?? "" }),
          }), "复制文件失败");
        }
        refreshFileTree();
      } catch (err) {
        await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
      }
    } else if (type === "move" && action.targetNode && typeof filePath === "string") {
      const targetPath = action.targetNode.metadata?.filePath;
      if (typeof targetPath !== "string") return;
      const targetDir = action.targetNode.metadata?.isDirectory ? targetPath : targetPath.replace(/[/\\][^/\\]+$/, "");
      const sourceName = filePath.split(/[\\/]/).pop() ?? node.title;
      const destination = targetDir ? `${targetDir}/${sourceName}` : sourceName;
      try {
        await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/files/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: filePath, to: destination }),
        }), "移动文件失败");
        refreshFileTree();
      } catch (err) {
        await alertDialog({ title: "操作失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
      }
    } else if (type === "open-side") {
      // 文件树节点此时只解析到裸节点（正文尚未载入），直接开分屏会看到空白；
      // 与 handleOpen 同一链路：先读正文写入 loadedFiles，再开分屏。
      const alreadyLoaded = loadedFilesRef.current.has(loadedFileKey(bookId, node.id));
      if (node.metadata?.isFile && typeof node.metadata?.filePath === "string" && !alreadyLoaded) {
        const filePath = node.metadata.filePath;
        const generation = fileReadGenerationRef.current;
        const controller = new AbortController();
        fileReadControllersRef.current.add(controller);
        void fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(filePath)}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(`请求失败：${response.status}`);
            return response.json() as Promise<{ content?: string }>;
          })
          .then((data) => {
            if (controller.signal.aborted || generation !== fileReadGenerationRef.current || currentBookIdRef.current !== bookId) return;
            const loaded: WorkbenchResourceNode = { ...node, content: data.content ?? "" };
            setLoadedFiles(prev => new Map(prev).set(loadedFileKey(bookId, node.id), loaded));
            setSplitNodeId(node.id);
          })
          .catch((err) => {
            if (controller.signal.aborted || generation !== fileReadGenerationRef.current || currentBookIdRef.current !== bookId) return;
            void alertDialog({ title: "在侧边打开失败", description: err instanceof Error ? err.message : "未知错误", destructive: true });
          })
          .finally(() => fileReadControllersRef.current.delete(controller));
        return;
      }
      setSplitNodeId(node.id);
    } else if (type === "generate-variant" || type === "scene-spec") {
      // 章节专属操作：打开章节文件，用户通过编辑器工具栏操作
      handleOpen(node);
    } else if (type === "promote-outline") {
      // 大纲节点一键提拔至手稿章节 (OpenWrite 风格)
      const outlineTitle = node.title.replace(/^第\s*\d+\s*[章卷节篇幕]\s*[:：\s]*/u, "").trim() || node.title;
      const targetTitle = await promptDialog({
        title: "将大纲提拔为新章节",
        description: `将大纲「${node.title}」作为新章节立项，内容将自动载入写作蓝图。`,
        defaultValue: outlineTitle,
        confirmLabel: "创建章节",
      });
      if (!targetTitle) return;

      try {
        const createRes = await ensureOk(
          await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: targetTitle,
              content: node.content ? `# ${targetTitle}\n\n${node.content}` : `# ${targetTitle}\n\n`,
            }),
          }),
          "创建手稿章节失败",
        );
        const chapterData = await createRes.json() as { chapter?: { id: string; chapterNumber?: number; title?: string } };
        toast("已提拔为手稿章节", "success");
        refreshFileTree();

        // T3 身份链回写：把新章号写进大纲条目 fields.targetChapterNumber，
        // 大纲与章节从此可互相推导（drafted 徽标、防重复提拔）。失败不阻断已建章节。
        const entryId = typeof node.metadata?.entryId === "string" ? node.metadata.entryId : undefined;
        const promotedChapterNumber = chapterData.chapter?.chapterNumber;
        if (entryId && typeof promotedChapterNumber === "number") {
          try {
            const encodedEntry = encodeURIComponent(entryId);
            const entryRes = await ensureOk(
              await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodedEntry}`),
              "读取大纲条目失败",
            );
            const entryPayload = await entryRes.json() as { entry?: { fields?: Record<string, unknown> } };
            const nextFields = buildTargetChapterFields(entryPayload.entry?.fields, promotedChapterNumber);
            await ensureOk(
              await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodedEntry}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: nextFields, source: "user", revisionReason: "promote-outline" }),
              }),
              "回写大纲目标章号失败",
            );
            void loadLoreSections();
          } catch (writeBackErr) {
            toast(`章节已创建，但大纲目标章号回写失败：${writeBackErr instanceof Error ? writeBackErr.message : String(writeBackErr)}`, "error");
          }
        }

        // 自动定位并切到写作视图
        showPanel("write");
        setSidebarVisible(true);
        if (chapterData.chapter?.id) {
          handleOpen({
            id: `chapter:${chapterData.chapter.id}`,
            kind: "chapter",
            title: chapterData.chapter.title ?? targetTitle,
            capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
          });
        }
      } catch (err) {
        await alertDialog({
          title: "提拔章节失败",
          description: err instanceof Error ? err.message : "未知错误",
          destructive: true,
        });
      }
    }
  }, [bookId, fileClipboard, refreshFileTree, setSplitNodeId, handleOpen, showPanel, confirmDialog, promptDialog, alertDialog]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeNode || isTextEditingTarget(event.target)) return;
      const isModifier = event.ctrlKey || event.metaKey;
      if (isModifier && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void handleResourceAction({ type: "copy", node: activeNode });
      } else if (isModifier && event.key.toLowerCase() === "x") {
        event.preventDefault();
        void handleResourceAction({ type: "cut", node: activeNode });
      } else if (isModifier && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void handleResourceAction({ type: "paste", node: activeNode });
      } else if (event.key === "Escape") {
        setFileClipboard(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeNode, handleResourceAction]);

  // 作品总览（新书时是建书十一问）：「资源」视图没有激活标签时显示。
  const bookOverviewCanvas = (
    <WorkbenchCanvas
      node={null}
      nodes={nodes}
      bookId={bookId}
      repositoryPath={repositoryPath}
      runtimeFetch={runtimeFetch}
      onSave={handleSaveWithProgress}
      onCanvasContextChange={handleCanvasContextChange}
      onGuideComplete={handleGuideCompleteWithOnboarding}
      chapterActions={chapterActions}
      jingweiActions={jingweiActions}
      toolbarSlotRef={toolbarSlotRef}
      onJumpToChapter={handleJumpToChapter}
      onOpenWriteView={() => keybindingActions.switchView("write")}
      onOpenJingweiEntry={handleOpenJingweiEntry}
      onOpenEntityDetail={handleOpenEntityFromGraph}
      onOpenEntityDrawer={handleOpenEntityDrawer}
      onSendToNarrator={onSendToNarrator}
      {...(activeSessionId ? { narratorId: activeSessionId } : {})}
      selectionCandidate={selectionCandidate}
      onDismissSelectionCandidate={onDismissSelectionCandidate}
      onPromoteOutline={(outlineNode) => {
        void handleResourceAction({ type: "promote-outline", node: outlineNode });
      }}
    />
  );

  return (
    <>
      <div
        className="flex h-full w-full bg-background"
        style={{ minHeight: 0 }}
        data-testid="ide-workbench"
        data-layout-mode={layoutMode}
        data-pane-overlay={overlayPanes ? "true" : "false"}
        data-sidebar-visible={sidebarVisible ? "true" : "false"}
        data-chat-visible={chatVisible ? "true" : "false"}
      >
      {/* ── ActivityBar：64px 宽，每项「图标＋文字」，不用悬停也能认出每个入口；左侧 2px 强调条标当前项 ── */}
      <div className="flex h-full w-16 shrink-0 flex-col justify-between items-center border-r border-border bg-secondary" data-nf-surface="rail">
        <div className="flex flex-col items-center gap-0.5 pt-2">
          {SIDEBAR_VIEWS.map(v => (
            <ActivityBarItem
              key={v.id}
              icon={v.icon}
              label={v.label}
              active={activeView === v.id && sidebarVisible && !showSettings}
              onClick={() => { setShowSettings(false); handleViewClick(v.id); }}
            />
          ))}
        </div>
        <div className="flex flex-col items-center gap-0.5 pb-2">
          <ActivityBarItem
            icon={MessageSquare}
            label="AI 对话"
            active={chatVisible && !showSettings}
            onClick={handleChatToggle}
          />
          <ActivityBarItem
            icon={Settings}
            label="写作设置"
            active={showSettings}
            onClick={() => { setSettingsSection(undefined); setShowSettings(v => !v); }}
          />
        </div>
      </div>

      {/* ── Main Area（Sidebar + Editor + Chat） ── */}
      <div ref={layoutHostRef} className="relative flex-1" style={{ minWidth: 0, minHeight: 0, height: "100%" }}>
        <Allotment
          key={`outer-layout:${layoutStorageId}`}
          proportionalLayout={false}
          defaultSizes={ideLayoutSizesToArray(initialLayoutSizes)}
          onDragEnd={handleOuterLayoutDragEnd}
        >
          {/* Sidebar — 纯 DOM 面板管理,React 通过 portal 渲染内容 */}
          <Allotment.Pane minSize={150} preferredSize={220} visible={!overlayPanes && sidebarVisible}>
            <div className="flex h-full flex-col border-r border-border bg-card">
              {/* Sidebar 标题：只给未接 SidebarPageHead 的面板兜底（资源、搜索）；接了页头的面板自带标题，不再叠加。 */}
              {!SIDEBAR_VIEWS.find(v => v.id === activeView)?.hasPageHead && (
                <div className="flex h-[35px] shrink-0 items-center border-b border-border px-2" data-testid="sidebar-view-title">
                  <span className="text-2xs font-semibold text-foreground uppercase tracking-wide pl-3">
                      {SIDEBAR_VIEWS.find(v => v.id === activeView)?.title ?? "资源"}
                  </span>
                </div>
              )}
              {/* PanelManager 宿主:面板容器由 JS 创建,React 通过 portal 往里渲染 */}
              <div ref={overlayPanes ? undefined : hostRef} className="flex-1 relative" />
              {/* Portal 渲染各面板内容到 PanelManager 创建的 DOM 容器 */}
              {panelsReady && getContainer("write") && createPortal(
                <WriteViewPanel
                  bookId={bookId}
                  callTool={writeViewCallTool}
                  onSwitchView={(view) => keybindingActions.switchView(view)}
                  onOpenSettings={handleOpenSettingsSection}
                  onOpenLorePanel={handleOpenLorePanel}
                  onSendToNarrator={onSendToNarrator}
                  onRunWrite={handleRunWrite}
                  chapterWordTarget={bookChapterWordTarget}
                  onJumpToChapter={handleJumpToChapter}
                  visible={activeView === "write" && sidebarVisible && !showSettings}
                  hasChapters={bookHasChapters}
                  onOpenNewBookGuide={handleShowBookOverview}
                  {...(workflowNode ? { onOpenWorkflow: () => handleOpen(workflowNode) } : {})}
                  {...(bookId ? { onOpenStoryCanvas: () => handleOpen(createStoryProgressionNode(bookId, "next")) } : {})}
                />,
                getContainer("write")!
              )}
              {/* 资源：作品总览入口 + 文件树 + 分析工具（原「资源管理器」「分析工具」两个入口合并） */}
              {panelsReady && getContainer("resources") && createPortal(
                <ResourcesSidebarPanel
                  overviewActive={activeView === "resources" && !ideTabs.activeTabId && !showSettings}
                  onShowOverview={handleShowBookOverview}
                  files={resourceFileNodes.length > 0
                    // 排序偏好沿用原资源管理器的存储键，作者选过的排序不丢。
                    ? <WorkbenchResourceTree nodes={resourceFileNodes} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} cutNodeIds={fileClipboard?.mode === "cut" ? [fileClipboard.node.id] : []} sortStorageKey={`novelfork:resource-tree-sort:${bookId ?? "global"}:explorer`} />
                    : fileTree.loading
                      ? <div className="flex items-center justify-center px-4 py-6"><span role="status" aria-live="polite" className="text-xs text-muted-foreground">正在扫描文件…</span></div>
                      : fileTree.error
                        ? <div className="flex items-center justify-center px-4 py-6 text-center"><span role="alert" className="break-words text-xs text-destructive">{fileTree.error}</span></div>
                        : <div className="flex items-center justify-center px-4 py-6"><span className="text-xs text-muted-foreground">暂无文件</span></div>}
                  tools={<WorkbenchResourceTree nodes={toolNodes} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} toolbar={false} ariaLabel="分析工具" />}
                />,
                getContainer("resources")!
              )}
              {/* 角色与设定：彻底统一经纬设定与角色当前时态 */}
              {panelsReady && getContainer("characters-lore") && createPortal(
                bookId
                  ? <CharactersAndLoreSidebarPanel
                      bookId={bookId}
                      nodes={jingweiSections}
                      facts={entityFacts}
                      selectedNodeId={activeNode?.id ?? null}
                      onOpen={handleOpen}
                      onAction={handleResourceAction}
                      onChanged={() => void loadLoreSections()}
                    />
                  : <div className="flex h-full items-center justify-center p-4 text-center">
                      <span className="text-xs text-muted-foreground">先打开一本书，再查看角色与设定。</span>
                    </div>,
                getContainer("characters-lore")!
              )}
               {/* 故事推进：章节与大纲、章后事实，顶部打开故事画布（下一章 / 推进 / 故事树） */}
              {panelsReady && getContainer("storyline") && createPortal(
                bookId
                  ? <StorylineAndPlanningSidebarPanel
                      bookId={bookId}
                      chapterTreeNodes={chapterTreeNodes}
                      outlineTreeNodes={outlineTreeNodes}
                      selectedNodeId={activeNode?.id ?? null}
                      onOpen={handleOpen}
                      onSwitchView={(view) => keybindingActions.switchView(view)}
                      onAction={handleResourceAction}
                      onOpenEntityDetail={handleOpenEntityFromGraph}
                      onSendToNarrator={onSendToNarrator}
                      bookTargetChapters={bookTargetChapters}
                      onJumpToChapter={handleJumpToChapter}
                    />
                  : <div className="flex h-full items-center justify-center p-4 text-center">
                      <span className="text-xs text-muted-foreground">先打开一本书，再查看故事推进。</span>
                    </div>,
                getContainer("storyline")!
              )}
              {panelsReady && getContainer("skills-style") && createPortal(
                bookId
                  ? <SkillsAndStyleSidebarPanel
                      bookId={bookId}
                      onOpenJingweiEntry={(entryId) => handleOpenJingweiEntry(entryId)}
                      onOpenChapter={handleJumpToChapter}
                      onOpenEvents={() => keybindingActions.switchView("storyline")}
                    />
                  : <div className="flex h-full items-center justify-center p-4 text-center">
                      <span className="text-xs text-muted-foreground">先打开一本书，再查看技能与文风。</span>
                    </div>,
                getContainer("skills-style")!
              )}
              {panelsReady && getContainer("search") && createPortal(
                <SearchPanel
                  nodes={nodes}
                  fileNodes={fileTree.nodes}
                  jingweiSections={jingweiSections}
                  memorySections={narrativeMemorySections}
                  onOpen={handleOpen}
                />,
                getContainer("search")!
              )}

            </div>
          </Allotment.Pane>

          {/* Editor */}
          <Allotment.Pane minSize={220}>
            <Allotment proportionalLayout>
              {/* 主编辑区 */}
              <Allotment.Pane minSize={200}>
                <div className="flex h-full flex-col overflow-hidden">
                  {!showSettings && (
                    <EditorTabs
                      tabs={ideTabs.tabs}
                      activeTabId={ideTabs.activeTabId}
                      activeView={tabView}
                      onActivate={ideTabs.activateTab}
                      onClose={handleCloseTab}
                      onCloseOthers={handleCloseOthers}
                      onCloseAll={handleCloseAllTabs}
                      onCloseSaved={handleCloseSaved}
                      onCloseRight={handleCloseRight}
                      onTogglePin={ideTabs.togglePin}
                      onReorder={ideTabs.reorderTabs}
                      actionsSlotRef={toolbarSlotRef}
                      onSplitRight={(tabId) => setSplitNodeId(tabId)}
                    />
                  )}
                  <EditorBreadcrumbs bookTitle={bookRoot?.title} node={activeNode} view={activeView} showSettings={showSettings} onNavigate={handleBreadcrumbNavigate} canNavigate={canNavigateBreadcrumb} />
                  <div className="flex-1 min-h-0">
                  <EditorErrorBoundary>
                    {showSettings && bookId ? (
                      <div className="h-full overflow-y-auto">
                        <BookSettingsPanel
                          bookId={bookId}
                          onBack={() => { setShowSettings(false); setSettingsSection(undefined); }}
                          {...(settingsSection ? { initialSection: settingsSection } : {})}
                        />
                      </div>
                    ) : activeView === "skills-style" && bookId ? (
                      <div className="h-full space-y-5 overflow-y-auto p-5">
                        <StyleDistillationWorkspace
                          bookId={bookId}
                          fetchJson={styleDistillationFetch}
                          onAdopted={() => window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }))}
                        />
                        <StyleVaultPanel bookId={bookId} />
                      </div>
                    ) : activeNode || multiTabNodes.length > 0 ? (
                      <>
                        {/* 多实例条件渲染：所有打开的 Tab 保持 mount，非 active 用 display:none 隐藏 */}
                        {multiTabNodes.map(({ tabId, node: tabNode }) => (
                          <div key={tabId} style={{ display: tabId === ideTabs.activeTabId ? "contents" : "none" }} className="h-full">
                            <WorkbenchCanvas
                              node={tabId === ideTabs.activeTabId ? activeNode : tabNode}
                              nodes={nodes}
                              bookId={bookId}
                              repositoryPath={repositoryPath}
                              runtimeFetch={runtimeFetch}
                              onSave={handleSaveWithProgress}
                              onCanvasContextChange={handleCanvasContextChange}
                              onGuideComplete={handleGuideCompleteWithOnboarding}
                              chapterActions={chapterActions}
                              jingweiActions={jingweiActions}
                              toolbarSlotRef={toolbarSlotRef}
                              isActive={tabId === ideTabs.activeTabId}
                              onJumpToChapter={handleJumpToChapter}
                              onOpenWriteView={() => keybindingActions.switchView("write")}
                              onOpenJingweiEntry={handleOpenJingweiEntry}
                              onOpenEntityDetail={handleOpenEntityFromGraph}
                              onOpenEntityDrawer={handleOpenEntityDrawer}
                              onSendToNarrator={onSendToNarrator}
                              {...(activeSessionId ? { narratorId: activeSessionId } : {})}
                              selectionCandidate={selectionCandidate}
                              onDismissSelectionCandidate={onDismissSelectionCandidate}
                              onOpenResourceNode={handleOpen}
                              onPromoteOutline={(outlineNode) => {
                                void handleResourceAction({ type: "promote-outline", node: outlineNode });
                              }}
                            />
                          </div>
                        ))}
                        {/* 「资源」里有标签但都没激活（点了「作品总览」或起书引导卡要看十一问）：标签保持挂载，前面显示作品总览。 */}
                        {!ideTabs.activeTabId && activeView === "resources" ? bookOverviewCanvas : null}
                      </>
                    ) : activeView === "resources" ? (
                      bookOverviewCanvas
                    ) : (
                      <ViewEmptyState view={activeView} sidebarVisible={sidebarVisible} onShowSidebar={() => handleViewClick(activeView)} />
                    )}
                  </EditorErrorBoundary>
                  </div>
                  {/* Task C: 底部"问题"面板（VS Code Problems 风格） */}
                  {issues && issues.length > 0 && (
                    <ProblemsPanel
                      issues={issues}
                      onIssueClick={onIssueClick}
                    />
                  )}
                </div>
              </Allotment.Pane>

              {/* 分屏参考面板（VS Code "Open to the Side"） */}
              {splitNode && (
                <Allotment.Pane minSize={200}>
                  <div className="flex h-full flex-col overflow-hidden border-l border-border">
                    <div className="flex h-[35px] shrink-0 items-center justify-between border-b border-border bg-secondary/40 px-3">
                      <span className="text-xs text-foreground truncate">{splitNode.title}</span>
                      <button type="button" onClick={() => setSplitNodeId(null)} className="flex size-5 items-center justify-center rounded hover:bg-muted" title="关闭分屏">
                        <X className="size-3" />
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <WorkbenchCanvas
                        node={splitNode}
                        nodes={nodes}
                        bookId={bookId}
                        repositoryPath={repositoryPath}
                        runtimeFetch={runtimeFetch}
                        onSave={handleSaveWithProgress}
                        onCanvasContextChange={(context) => {
                          splitDraftRef.current = { dirty: context.dirty, title: splitNode.title };
                        }}
                        chapterActions={chapterActions}
                        jingweiActions={jingweiActions}
                        onJumpToChapter={handleJumpToChapter}
                        onOpenWriteView={() => keybindingActions.switchView("write")}
                        onOpenJingweiEntry={handleOpenJingweiEntry}
                        onOpenEntityDetail={handleOpenEntityFromGraph}
                        onOpenEntityDrawer={handleOpenEntityDrawer}
                        onSendToNarrator={onSendToNarrator}
                        {...(activeSessionId ? { narratorId: activeSessionId } : {})}
                        selectionCandidate={selectionCandidate}
                        onDismissSelectionCandidate={onDismissSelectionCandidate}
                        onOpenResourceNode={handleOpen}
                        onPromoteOutline={(outlineNode) => {
                          void handleResourceAction({ type: "promote-outline", node: outlineNode });
                        }}
                      />
                    </div>
                  </div>
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>

          {/* Chat Panel（右侧辅助栏，类似 VS Code AuxiliaryBar） */}
          <Allotment.Pane minSize={200} preferredSize={320} visible={!overlayPanes && chatVisible}>
            <div className="flex h-full flex-col border-l border-border bg-card">
              <ChatHeader
                sessions={bookSessions}
                activeSessionId={activeSessionId}
                onSwitchSession={onSwitchSession}
                onCreateSession={onCreateSession}
                onSwitchToAgent={onSwitchToAgent}
              />
              <div className="flex-1 min-h-0 overflow-hidden">
                {chatSlot ?? (
                  <div className="flex h-full flex-col items-center justify-center p-6 gap-4">
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="size-5 text-primary" />
                    </div>
                    <ChatEmptyTip />
                    {onCreateSession && (
                      <button
                        type="button"
                        onClick={onCreateSession}
                        className="mt-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        新建对话
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Allotment.Pane>
        </Allotment>
        {overlayPanes && (sidebarVisible || chatVisible) ? (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/20"
            aria-label="关闭面板"
            data-testid="ide-overlay-backdrop"
            onClick={() => {
              setSidebarVisible(false);
              setChatVisible(false);
            }}
          />
        ) : null}
        {overlayPanes ? (
          <div
            className={`absolute inset-y-0 left-0 z-30 flex w-[min(20rem,calc(100%_-_3rem))] flex-col border-r border-border bg-card shadow-lg transition-transform duration-200 ${sidebarVisible ? "translate-x-0" : "invisible -translate-x-full"}`}
            data-testid="ide-sidebar-overlay"
            aria-hidden={!sidebarVisible}
          >
            <div className="flex h-[35px] shrink-0 items-center justify-between border-b border-border px-2">
              <span className="text-2xs font-semibold text-foreground uppercase tracking-wide pl-3">
                {SIDEBAR_VIEWS.find(v => v.id === activeView)?.title ?? "资源"}
              </span>
              <button type="button" className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/50" aria-label="关闭侧栏" onClick={() => setSidebarVisible(false)}>
                <X className="size-3.5" />
              </button>
            </div>
            <div ref={hostRef} className="flex-1 relative min-h-0" />
          </div>
        ) : null}
        {overlayPanes && chatVisible ? (
          <div className="absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100%_-_3rem))] flex-col border-l border-border bg-card shadow-lg" data-testid="ide-chat-overlay">
            <ChatHeader
              sessions={bookSessions}
              activeSessionId={activeSessionId}
              onSwitchSession={onSwitchSession}
              onCreateSession={onCreateSession}
              onSwitchToAgent={onSwitchToAgent}
              onClose={() => setChatVisible(false)}
            />
            <div className="flex-1 min-h-0 overflow-hidden">
              {chatSlot ?? (
                <div className="flex h-full flex-col items-center justify-center p-6 gap-4">
                  <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="size-5 text-primary" />
                  </div>
                  <ChatEmptyTip />
                  {onCreateSession && (
                    <button
                      type="button"
                      onClick={onCreateSession}
                      className="mt-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      新建对话
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>

    {/* Command Palette overlay */}
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      commands={paletteMode === "commands" ? ideCommands : quickOpenCommands}
      placeholder={paletteMode === "commands" ? "输入命令..." : "输入文件名..."}
      mode={paletteMode}
    />
    {bookId && entityDetailEntity && (
      <EntityDetailDrawer
        bookId={bookId}
        entity={entityDetailEntity}
        {...(entityDetailEntryId ? { entryId: entityDetailEntryId } : {})}
        onClose={() => setEntityDetailEntity(null)}
        onOpenJingweiEntry={handleOpenJingweiEntry}
      />
    )}
    {/* 文件/条目操作弹层（confirm/prompt/alert 的产品内实现） */}
      {dialogElement}
    </>
  );
}

// ── ActivityBarItem ──────────────────────────────────────

function ActivityBarItem({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`relative flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-md transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-primary" />}
      <Icon className="size-5" strokeWidth={active ? 2.1 : 1.7} />
      <span className={`whitespace-nowrap text-2xs leading-none ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
    </button>
  );
}

// ── ResourcesSidebarPanel（「资源」侧栏：作品总览入口 + 文件 + 分析工具） ──
// 文件树与分析工具本是同一棵资源树的两组节点，合成一个视图分两个分区；
// 作品总览原先只能靠「资源管理器里关掉全部标签」进入，这里给一个常驻入口。

/** 导出仅供测试。 */
export function ResourcesSidebarPanel({ overviewActive, onShowOverview, files, tools }: {
  /** 中央正显示作品总览（「资源」视图没有激活标签）。 */
  overviewActive: boolean;
  onShowOverview: () => void;
  files: ReactNode;
  tools: ReactNode;
}) {
  return (
    <div className="flex flex-col pb-2" data-testid="resources-sidebar">
      <div className="px-2 py-1.5">
        <button
          type="button"
          onClick={onShowOverview}
          aria-current={overviewActive ? "page" : undefined}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
            overviewActive ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted"
          }`}
        >
          <LayoutDashboard className="size-4 shrink-0" strokeWidth={1.8} />
          <span className="truncate">作品总览</span>
        </button>
      </div>
      <ResourcesSection title="文件">{files}</ResourcesSection>
      <ResourcesSection title="分析工具">{tools}</ResourcesSection>
    </div>
  );
}

function ResourcesSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label={title} className="border-t border-border/60">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-full items-center gap-1 px-2 text-2xs font-semibold tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        <Chevron className="size-3.5 shrink-0" />
        <span>{title}</span>
      </button>
      {/* 收起只隐藏不卸载：保留树里的展开状态与搜索词。 */}
      <div id={contentId} hidden={!open} className="pb-1">{children}</div>
    </section>
  );
}

// ── ChatHeader ──────────────────────────────────────────

function ChatHeader({
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onSwitchToAgent,
  onClose,
}: {
  sessions?: readonly { id: string; title: string; updatedAt?: string }[];
  activeSessionId?: string | null;
  onSwitchSession?: (id: string) => void;
  onCreateSession?: () => void;
  onSwitchToAgent?: () => void;
  onClose?: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const activeTitle = sessions?.find((s) => s.id === activeSessionId)?.title ?? "Untitled";

  const filtered = useMemo(() => {
    if (!sessions) return [];
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  return (
    <div className="relative shrink-0">
      <div className="flex h-9 items-center border-b border-border px-3">
        <span className="flex-1 truncate text-sm text-muted-foreground">{activeTitle}</span>
        <div className="flex items-center gap-1">
          <button type="button" title="会话历史" aria-label="会话历史" onClick={() => { setShowHistory(v => !v); setSearchQuery(""); }}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50">
            <Clock className="size-4" />
          </button>
          {onCreateSession && (
            <button type="button" title="新建对话" aria-label="新建对话" onClick={onCreateSession}
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50">
              <PlusCircle className="size-4" />
            </button>
          )}
          {onSwitchToAgent && (
            <button type="button" title="切换到 Agent 对话模式" aria-label="切换到 Agent 对话模式" onClick={onSwitchToAgent}
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50">
              <MessageSquare className="size-4" />
            </button>
          )}
          {onClose && (
            <button type="button" title="关闭对话" aria-label="关闭对话" onClick={onClose}
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="absolute right-0 top-9 z-50 w-72 rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input type="text" placeholder="搜索会话..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none" autoFocus />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">无匹配会话</p>
            ) : filtered.map((s) => (
              <button key={s.id} type="button"
                className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                  s.id === activeSessionId ? "bg-green-100 dark:bg-green-900/30 text-foreground font-medium" : "text-foreground hover:bg-muted/50"
                }`}
                onClick={() => { onSwitchSession?.(s.id); setShowHistory(false); }}>
                <span className="truncate">{s.title || "Untitled"}</span>
                <span className="shrink-0 ml-2 text-2xs text-muted-foreground">
                  {s.updatedAt ? formatRelativeTime(s.updatedAt) : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(dateStr).toLocaleDateString();
}

// ── 空白态 Tips ──────────────────────────────────────────

const EMPTY_TIPS: { text: string }[] = [
  { text: "第一次使用？在「学习中心」查看完整教程，5 分钟上手" },
  { text: "新建书籍后，先录入核心设定到作品基础，AI 写作会更准确" },
  { text: "试试说「帮我写下一章」，AI 会根据大纲和设定自动生成" },
  { text: "写作管线会生成正式章节结果，可在章节编辑器里继续修订" },
  { text: "可以用预设控制写作风格——武侠、言情、悬疑各有模板" },
  { text: "写作卡壳？说「给我三个推进方向」让 AI 帮你打开思路" },
  { text: "直接粘贴大纲，AI 会帮你拆分成章节结构" },
  { text: "作品基础管理静态设定；时间线、关系变化和伏笔推进在故事推进里管理" },
  { text: "静态作品设定写入核心规则需有来源；动态事实先进入待确认故事事件" },
  { text: "用「检查一致性」让 AI 做 37 维连续性审查，找出逻辑漏洞" },
  { text: "节奏分析、POV 视角——写作工具栏里都有" },
  { text: "书籍健康度面板能一眼看出哪章需要修订" },
  { text: "每本书可以有多个对话，写作对话和讨论对话分开更清晰" },
  { text: "长对话变慢时，新建一个对话——AI 会自动继承上下文" },
  { text: "子 Agent 可以并行跑多个任务，比如同时审查三章" },
  { text: "在设置里配置模型偏好——不同任务可以用不同模型" },
  { text: "Routines 能自动化重复工作——比如每章写完自动审查" },
  { text: "Agent 有安全沙箱，敏感操作会先征求你的同意" },
  { text: "支持 MCP 协议扩展工具，连接外部知识库或 API" },
];

function ChatEmptyTip() {
  const [tip] = useState(() => EMPTY_TIPS[Math.floor(Math.random() * EMPTY_TIPS.length)]);
  return (
    <div className="flex items-start gap-2 max-w-[260px] rounded-md bg-muted/40 px-3 py-2">
      <Lightbulb className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
      <p className="text-xs text-muted-foreground leading-relaxed">{tip.text}</p>
    </div>
  );
}

// ── EditorBreadcrumbs（编辑器路径导航，VS Code 22px 面包屑） ──

const KIND_LABEL: Record<string, string> = {
  chapter: "章节",
  "jingwei-entry": "作品设定",
  jingwei: "作品基础",
  tool: "分析工具",
  "tool-result": "工具",
  book: "书籍",
};

function breadcrumbSegments(bookTitle: string | undefined, node: WorkbenchResourceNode): string[] {
  const segments: string[] = [bookTitle || "NovelFork"];

  // 文件树节点：按真实文件路径分段；章节显示为「正文 › 卷01 › 第 1 章 标题」，段数不变，
  // 点击某段仍按路径前缀定位（见 handleBreadcrumbNavigate）。
  const filePath = node.metadata?.filePath;
  if (node.metadata?.isFile && typeof filePath === "string") {
    return [bookTitle || "NovelFork", ...fileBreadcrumbParts(node)];
  }

  // 作品设定条目：书 › 作品基础 › 分类 › 条目
  const category = node.metadata?.category;
  if (node.kind === "jingwei-entry" || node.kind === "jingwei") {
    segments.push("作品基础");
    if (typeof category === "string" && category) {
      segments.push(CATEGORY_META.find(m => m.id === normalizeCategory(category).category)?.name ?? category);
    }
    segments.push(node.title);
    return segments;
  }

  // 章节等：书 › 类型 › 标题
  if (node.metadata?.isNarrativeMemoryEntry) {
    segments.push("故事推进");
    segments.push(node.title);
    return segments;
  }
  const kindLabel = KIND_LABEL[node.kind];
  if (kindLabel) segments.push(kindLabel);
  segments.push(node.title);
  return segments;
}

const VIEW_LABEL: Record<SidebarView, string> = {
  write: "写作",
  resources: "资源",
  "characters-lore": "作品基础",
  storyline: "故事推进",
  "skills-style": "技能与文风",
  search: "搜索",
};

function EditorBreadcrumbs({ bookTitle, node, view, showSettings, onNavigate, canNavigate }: {
  bookTitle?: string;
  node: WorkbenchResourceNode | null;
  view: SidebarView;
  showSettings?: boolean;
  /** 点击面包屑段时回调（segment 文本 + index） */
  onNavigate?: (segment: string, index: number) => void;
  /** 该段是否有可解析的导航目标；没有目标的段渲染成不可点（缺省视为全部可点）。 */
  canNavigate?: (segment: string, index: number) => boolean;
}) {
  // 写作设置 → 书 › 写作设置；有激活节点 → 节点路径；否则 → 书 › 视图名
  const segments = showSettings
    ? [bookTitle || "NovelFork", "写作设置"]
    : node
    ? breadcrumbSegments(bookTitle, node)
    : [bookTitle || "NovelFork", VIEW_LABEL[view]];
  return (
    <div style={{ height: 24, minHeight: 24 }} className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-card/50 px-3 [&::-webkit-scrollbar]:hidden">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const clickable = !!onNavigate && !isLast && (canNavigate ? canNavigate(seg, i) : true);
        return (
          <span key={`${seg}-${i}`} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
            <span
              className={`text-2xs truncate max-w-[180px] ${isLast ? "text-foreground" : "text-muted-foreground"} ${clickable ? "cursor-pointer hover:text-foreground hover:underline underline-offset-2 transition-colors" : ""}`}
              onClick={clickable ? () => onNavigate(seg, i) : undefined}
            >
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── ViewEmptyState（无激活 Tab 时的编辑区空态） ──
// 空态模板：这里是什么 + 第一步点哪；侧栏收起时给一个展开按钮，免得「看左侧」指向一块看不见的地方。

const VIEW_EMPTY_COPY: Record<SidebarView, { purpose: string; steps: readonly string[] }> = {
  write: {
    purpose: "这里显示你正在写的章节。",
    steps: ["在左侧「写」里点「写第 N 章」，交给叙述者起草", "或在「改」里打开刚写完的一章继续修"],
  },
  resources: {
    purpose: "这里显示作品总览、书里的文件和分析工具的结果。",
    steps: ["在左侧「文件」里点开任意文件", "或在「分析工具」里选一个工具，结果在这里打开"],
  },
  search: {
    purpose: "在全书里找人名、地名或一句原文。",
    steps: ["在左侧搜索框输入关键词，点结果直接打开"],
  },
  "characters-lore": {
    purpose: "角色、地点、势力和各类设定都在这里。",
    steps: ["在左侧「角色册」或「世界录」点开一张卡即可编辑", "「草案」里是拆书抽出、等你确认的条目"],
  },
  storyline: {
    purpose: "回答「下一章写什么」：剧情线、伏笔和章后事实。",
    steps: ["在左侧点「打开故事画布」，看下一章建议和伏笔账本", "或在「章节与大纲」里打开某一章"],
  },
  "skills-style": {
    purpose: "管理写作技能和本书文风。",
    steps: ["在左侧打开文风预设、文风金库或某个写作技能"],
  },
};

function ViewEmptyState({ view, sidebarVisible, onShowSidebar }: {
  view: SidebarView;
  sidebarVisible: boolean;
  onShowSidebar: () => void;
}) {
  const meta = SIDEBAR_VIEWS.find((item) => item.id === view) ?? SIDEBAR_VIEWS[0]!;
  const copy = VIEW_EMPTY_COPY[view];
  const Icon = meta.icon;
  return (
    <div className="flex h-full items-center justify-center bg-background p-8" data-testid="view-empty-state">
      <div className="flex max-w-sm flex-col items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" strokeWidth={1.8} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground">{meta.label}</p>
          <p className="text-sm text-muted-foreground">{copy.purpose}</p>
        </div>
        <ol className="flex flex-col gap-1.5 text-sm text-foreground">
          {copy.steps.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {!sidebarVisible ? (
          <button
            type="button"
            onClick={onShowSidebar}
            className="mt-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            展开左侧栏
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── SearchPanel（全局搜索面板） ──────────────────────────────

interface SearchResultNode extends WorkbenchResourceNode {
  matchType: "title" | "content";
  matchedLine?: string;
  /** 分组标签 */
  group: string;
}

function SearchPanel({ nodes, fileNodes, jingweiSections, memorySections, onOpen }: {
  nodes: readonly WorkbenchResourceNode[];
  fileNodes: readonly WorkbenchResourceNode[];
  jingweiSections: WorkbenchResourceNode[];
  memorySections: WorkbenchResourceNode[];
  onOpen: (node: WorkbenchResourceNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 收集当前书籍所有可搜索节点。文件树只有路径元数据，语义资源才带正文；
  // 同一 ID 出现两次时优先保留内容更完整的节点。
  const allNodes = useMemo(() => {
    const byId = new Map<string, WorkbenchResourceNode>();
    const walk = (ns: readonly WorkbenchResourceNode[]) => {
      for (const node of ns) {
        const previous = byId.get(node.id);
        if (!previous || (!previous.content && node.content)) byId.set(node.id, node);
        if (node.children) walk(node.children);
      }
    };
    walk(fileNodes);
    walk(nodes);
    walk(jingweiSections);
    walk(memorySections);
    return [...byId.values()];
  }, [fileNodes, nodes, jingweiSections, memorySections]);

  // 搜索逻辑（debounce 150ms）
  const doSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    const lower = q.toLowerCase();
    const matched: SearchResultNode[] = [];
    for (const node of allNodes) {
      const title = node.title ?? "";
      const path = node.path ?? (typeof node.metadata?.filePath === "string" ? node.metadata.filePath : "");
      const metadataText = Object.values(node.metadata ?? {})
        .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
        .join(" ");
      const content = [node.content ?? "", path, metadataText].filter(Boolean).join("\n");
      if (title.toLowerCase().includes(lower)) {
        matched.push({ ...node, matchType: "title", group: nodeKindToGroup(node) });
      } else if (content && content.toLowerCase().includes(lower)) {
        const idx = content.toLowerCase().indexOf(lower);
        const start = Math.max(0, idx - 30);
        const end = Math.min(content.length, idx + q.length + 30);
        const matchedLine = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
        matched.push({ ...node, matchType: "content", matchedLine, group: nodeKindToGroup(node) });
      }
    }
    setResults(matched);
  }, [allNodes]);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 150);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  // 按分组聚合
  const grouped = useMemo(() => {
    const map = new Map<string, SearchResultNode[]>();
    for (const r of results) {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    }
    return map;
  }, [results]);

  // 高亮匹配文本
  const highlight = useCallback((text: string, q: string) => {
    if (!q.trim()) return text;
    const lower = text.toLowerCase();
    const ql = q.toLowerCase();
    const idx = lower.indexOf(ql);
    if (idx === -1) return text;
    return <>{text.slice(0, idx)}<mark className="bg-primary/20 text-foreground rounded-sm px-px">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* 搜索输入框 */}
      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索当前书籍..."
            autoFocus
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none min-w-0"
          />
        </div>
        <p className="mt-1 px-1 text-2xs leading-relaxed text-muted-foreground">
          范围：章节正文、工作区资源、作品基础和故事推进
        </p>
      </div>
      {/* 搜索结果列表 */}
      <div ref={resultsRef} className="flex-1 overflow-y-auto px-1 py-1">
        {query.trim() && results.length === 0 && (
          <p className="px-2 py-4 text-center text-xs leading-relaxed text-muted-foreground">
            当前书籍的章节正文、工作区资源、作品基础和故事推进中没有匹配结果
          </p>
        )}
        {[...grouped.entries()].map(([group, items]) => (
          <div key={group} className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-2xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>{group}</span>
              <span className="text-muted-foreground/50">({items.length})</span>
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                onClick={() => onOpen(item)}
              >
                <span className="text-xs text-foreground truncate">
                  {item.matchType === "title" ? highlight(item.title, query) : item.title}
                </span>
                {item.matchType === "content" && item.matchedLine && (
                  <span className="text-2xs text-muted-foreground truncate leading-snug">
                    {highlight(item.matchedLine, query)}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 节点 → 搜索结果分组名 */
function nodeKindToGroup(node: WorkbenchResourceNode): string {
  if (node.metadata?.isNarrativeMemoryEntry === true) return "故事推进";
  switch (node.kind) {
    case "chapter": return "章节";
    case "jingwei-entry": return "设定条目";
    case "jingwei-section":
    case "jingwei": return "作品基础";
    case "file":
    case "story": return "工作区资源";
    default: return "其他";
  }
}

// ── ErrorBoundary（防止 lazy 面板加载失败崩溃整个编辑器） ──

interface EBState { error: Error | null }
class EditorErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center bg-background">
          <TriangleAlert className="size-7 text-destructive" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">面板加载失败</p>
          <p className="text-xs text-muted-foreground max-w-sm">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
