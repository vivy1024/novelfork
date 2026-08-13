/**
 * IdeWorkbench — IDE 模式写作工作台
 *
 * 三栏布局：ActivityBar + Sidebar + Editor(含 Tabs) + ChatPanel
 * 参考 VS Code：ActivityBar 图标切换 Sidebar 内容，底部只有全局操作。
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import {
  Files, Scroll, Wrench, Settings, X,
  Clock, PlusCircle, Search, Sparkles, Lightbulb, ChevronRight, MessageSquare, PenLine, Brain,
} from "lucide-react";
import { WorkbenchCanvas, type WorkbenchCanvasContext } from "../WorkbenchCanvas";
import { WorkbenchResourceTree } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
import { createToolSectionNodes } from "../useWorkbenchResources";
import { CATEGORY_META, normalizeCategory } from "../../../engine/jingwei/unified-categories";
import { groupEntriesByCategory, memoryFactLabel } from "../lore-workspace-split";
import type { ChapterActionHandlers } from "../WorkbenchCanvas";
import type { JingweiEntrySavePayload } from "../JingweiEntryEditor";
import { EditorTabs } from "./EditorTabs";
import { useIdeTabs, normalizeTabView, type TabKind, type TabView } from "./use-ide-tabs";
import { useBookFileTree } from "./use-book-file-tree";
import { BookSettingsPanel, type BookSettingsSection } from "../panels/BookSettingsPanel";
import { NarrativeMemoryPanel } from "../NarrativeMemoryPanel";
import { JingweiSidebarToolbar } from "../jingwei/JingweiSidebarToolbar";
import { WriteViewPanel, WRITING_PROGRESS_EVENT } from "../WriteViewPanel";
import type { GuidedSetupOutcome } from "../NewBookGuide";
import { buildWriteRequestMessage } from "../write-request";
import { buildOnboardingRequestMessage } from "../onboarding-request";
import { useIdeKeybindings } from "./use-ide-keybindings";
import { usePanelManager, type ViewId } from "./use-panel-manager";
import { CommandPalette } from "./command-palette";
import { useIdeCommands } from "./use-ide-commands";
import { ProblemsPanel, type EditorIssue } from "./ProblemsPanel";
import { clearEditorState } from "./editor-state-cache";
import { useWorkbenchDialogs } from "./use-workbench-dialogs";
import {
  ideLayoutSizesToArray,
  loadIdeLayoutSizes,
  mergeIdeLayoutSizes,
  saveIdeLayoutSizes,
} from "./ide-layout-state";

/** WorkbenchResourceNode.kind → Tab 图标用的 TabKind */
function toTabKind(node: WorkbenchResourceNode): TabKind {
  if (node.metadata?.isNarrativeMemoryEntry) return "memory-entry";
  if (node.metadata?.isFile && !node.metadata?.isChapter) return "file";
  switch (node.kind) {
    case "chapter": return "chapter";
    case "jingwei-entry": return "jingwei-entry";
    case "tool": return "tool";
    default: return "other";
  }
}

/** WorkbenchResourceNode → 归属的 ActivityBar 视图（决定 Tab 落在哪个工作区） */
function toTabView(node: WorkbenchResourceNode): TabView {
  if (node.kind === "tool" || node.kind === "tool-group") return "tools";
  // 叙事记忆条目属于经纬工作区的「进度」分区，与设定共用同一个 Tab 组
  if (node.metadata?.isNarrativeMemoryEntry) return "jingwei";
  if (node.kind === "jingwei" || node.kind === "jingwei-section" || node.kind === "jingwei-entry") return "jingwei";
  return "explorer";
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

export type SidebarView =
  | "write"
  | "explorer"
  | "jingwei"
  | "tools"
  | "search"
  | "narrative-memory";

export interface IdeWorkbenchProps {
  bookId?: string;
  repositoryPath?: string;
  nodes: readonly WorkbenchResourceNode[];
  selectedNode: WorkbenchResourceNode | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onDeselectNode?: () => void;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
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
}

// ── ViewContainer 定义（VS Code 风格：每个 Sidebar 视图的元数据） ──

const SIDEBAR_VIEWS: { id: SidebarView; icon: typeof Files; label: string; title: string }[] = [
  { id: "write", icon: PenLine, label: "写作", title: "写作" },
  { id: "explorer", icon: Files, label: "资源管理器", title: "资源管理器" },
  { id: "search", icon: Search, label: "搜索", title: "全局搜索" },
  // 经纬 = 作者维护的设定；叙事记忆 = 正文产生的事实流。
  // 两者性质不同，各自独立入口 —— 曾经合成一个工作区，作者在「设定」里
  // 看到「记忆」会多出一层不知所以的概念，已按作者反馈还原。
  { id: "jingwei", icon: Scroll, label: "经纬", title: "经纬" },
  { id: "tools", icon: Wrench, label: "工具", title: "工具" },
  { id: "narrative-memory", icon: Brain, label: "叙事记忆", title: "叙事记忆" },
];

// ── 过滤逻辑 ──

const CHAPTER_GROUP_IDS = new Set(["group:chapters", "group:archived"]);
const JINGWEI_KINDS = new Set(["jingwei", "jingwei-section", "jingwei-entry"]);
const TOOL_KINDS = new Set(["tool", "tool-group"]);

/** 递归收集匹配 predicate 的节点（保留匹配的子树结构） */
function collectNodes(nodes: readonly WorkbenchResourceNode[], predicate: (n: WorkbenchResourceNode) => boolean): WorkbenchResourceNode[] {
  const result: WorkbenchResourceNode[] = [];
  for (const node of nodes) {
    const filteredChildren = node.children ? collectNodes(node.children, predicate) : [];
    if (predicate(node) || filteredChildren.length > 0) {
      result.push(filteredChildren.length > 0 ? { ...node, children: filteredChildren } : node);
    }
  }
  return result;
}

function filterByView(children: readonly WorkbenchResourceNode[], view: SidebarView): WorkbenchResourceNode[] {
  switch (view) {
    case "explorer":
      // 资源管理器显示全部内容（和 VS Code Explorer 一样）
      return [...children];
    case "jingwei":
      return collectNodes(children, n => JINGWEI_KINDS.has(n.kind));
    case "tools":
      return collectNodes(children, n => TOOL_KINDS.has(n.kind));
    case "write":
    case "search":
      return [];
    case "narrative-memory":
      // 叙事记忆是独立面板，正文事实流由面板自己拉取，不走资源树过滤。
      return [];
  }
}

// ── Main Component ──────────────────────────────────────

export function IdeWorkbench({
  bookId,
  repositoryPath,
  nodes,
  selectedNode,
  onOpen,
  onSave,
  onCanvasContextChange,
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
}: IdeWorkbenchProps) {
  // --- Layout state ---
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [chatVisible, setChatVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const layoutStorageId = bookId ?? "global";
  const initialLayoutSizes = useMemo(() => loadIdeLayoutSizes(layoutStorageId), [layoutStorageId]);
  const layoutSizesRef = useRef(initialLayoutSizes);
  useEffect(() => {
    layoutSizesRef.current = initialLayoutSizes;
  }, [initialLayoutSizes]);
  const handleOuterLayoutDragEnd = useCallback((sizes: number[]) => {
    const next = mergeIdeLayoutSizes(sizes, layoutSizesRef.current);
    layoutSizesRef.current = next;
    saveIdeLayoutSizes(layoutStorageId, next);
  }, [layoutStorageId]);
  // 写作视图「一键修」跳设置时要落到具体分区（如 Writing Skills），不是只打开长表单。
  const [settingsSection, setSettingsSection] = useState<BookSettingsSection | undefined>(undefined);
  const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
  const [fileClipboard, setFileClipboard] = useState<{ node: WorkbenchResourceNode; mode: "copy" | "cut" } | null>(null);

  // 文件/条目操作的产品内弹层，取代浏览器原生 confirm/prompt/alert。
  // confirm/prompt/alert 由 useCallback 稳定，可安全进入依赖数组。
  const { confirm: confirmDialog, prompt: promptDialog, alert: alertDialog, element: dialogElement } = useWorkbenchDialogs();

  // --- Command Palette state ---
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"commands" | "files">("commands");

  // --- 命令式面板管理(纯 DOM 操作,学 VS Code CompositePart) ---
  const { activeView, showPanel, hostRef, getContainer, ready: panelsReady } = usePanelManager("explorer");

  // --- Tabs ---
  // 叙事记忆有独立侧栏入口，但不是编辑器 Tab 归属值 —— 它的 Tab 仍归经纬工作区，
  // 与 normalizeTabView 的落盘迁移契约一致（见 use-ide-tabs-migration.test.ts）。
  const tabView = normalizeTabView(activeView);
  const ideTabs = useIdeTabs(bookId, tabView);
  const ideTabsRef = useRef(ideTabs);
  ideTabsRef.current = ideTabs;

  // --- Portal container for toolbar (WorkbenchCanvas → EditorTabs) ---
  const toolbarSlotRef = useRef<HTMLDivElement>(null);

  // --- Lore / 叙事记忆分类树（始终加载,面板始终 mount） ---
  const [jingweiSections, setJingweiSections] = useState<WorkbenchResourceNode[]>([]);
  const [narrativeMemorySections, setNarrativeMemorySections] = useState<WorkbenchResourceNode[]>([]);
  const loadLoreSections = useCallback(async () => {
    if (!bookId) return;
    try {
      const fetchJson = runtimeFetch ?? (async (input: string, init?: RequestInit) => {
        const response = await fetch(input, init);
        if (!response.ok) throw new Error(`请求失败：${response.status}`);
        return response.json();
      });
      const [entRes, factsRes] = await Promise.all([
        fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`),
        fetchJson(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/facts`).catch(() => ({ facts: [] })),
      ]);
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
      const memoryFacts: Array<{ id: string; subject: string; predicate: string; object: string; category: string; evidenceText?: string; sourceId?: string }> = factsRes?.facts ?? [];

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
    } catch {
      setJingweiSections([]);
      setNarrativeMemorySections([]);
    }
  }, [bookId, runtimeFetch]);

  useEffect(() => {
    void loadLoreSections();
  }, [loadLoreSections]);

  // Runtime books use the same bound, server-authorized IDE filesystem gateway
  // as standalone books. The semantic workspace resources remain available to
  // auxiliary panels, but never replace the visible directory tree.
  const fileTree = useBookFileTree(bookId, Boolean(bookId));
  const refreshFileTree = fileTree.refresh;
  const explorerNodes = fileTree.nodes;

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

  // 工具面板节点（资源管理器"工具"视图 + Tab 解析都需要）
  const toolNodes = useMemo(() => {
    const root = createToolSectionNodes();
    return root.children ?? [];
  }, []);

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
    return map;
  }, [nodes, fileTree.nodes, jingweiSections, narrativeMemorySections, toolNodes]);

  // 文件树节点点击后加载的内容缓存
  const [loadedFiles, setLoadedFiles] = useState<Map<string, WorkbenchResourceNode>>(new Map());

  const activeNode = useMemo(() => {
    if (!ideTabs.activeTabId) return null;
    return loadedFiles.get(ideTabs.activeTabId) ?? resourceMap.get(ideTabs.activeTabId) ?? null;
  }, [ideTabs.activeTabId, resourceMap, loadedFiles]);

  // 分屏节点解析
  const splitNode = useMemo(() => {
    if (!splitNodeId) return null;
    return loadedFiles.get(splitNodeId) ?? resourceMap.get(splitNodeId) ?? null;
  }, [splitNodeId, resourceMap, loadedFiles]);

  // 多实例条件渲染：收集所有需要保持 mount 的 Tab 节点
  const multiTabNodes = useMemo(() => {
    return ideTabs.tabs
      .map(tab => {
        const node = loadedFiles.get(tab.id) ?? resourceMap.get(tab.id) ?? null;
        if (!node) return null;
        return { tabId: tab.id, node };
      })
      .filter((x): x is { tabId: string; node: WorkbenchResourceNode } => x !== null);
  }, [ideTabs.tabs, resourceMap, loadedFiles]);

  // 恢复的文件 Tab 懒加载内容：active 节点是文件但尚未加载过内容时拉取一次
  useEffect(() => {
    const node = activeNode;
    if (!node || !bookId) return;
    const filePath = node.metadata?.filePath;
    if (!node.metadata?.isFile || typeof filePath !== "string") return;
    if (loadedFiles.has(node.id)) return; // 已加载
    let cancelled = false;
    fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then((data: { content?: string }) => {
        if (cancelled) return;
        const loaded: WorkbenchResourceNode = { ...node, content: data.content ?? "" };
        setLoadedFiles(prev => new Map(prev).set(node.id, loaded));
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [activeNode, bookId, loadedFiles]);

  // --- Tab 关闭:dirty 时弹确认 + 清理缓存 ---
  const handleCloseTab = useCallback(async (tabId: string) => {
    const tab = ideTabsRef.current.tabs.find(t => t.id === tabId);
    if (tab?.dirty) {
      const confirmed = await confirmDialog({
        title: `"${tab.title}" 有未保存的修改`,
        description: "关闭后未保存的修改将丢失，确认关闭？",
        confirmLabel: "关闭",
        destructive: true,
      });
      if (!confirmed) return;
    }
    ideTabs.closeTab(tabId);
    clearEditorState(tabId);
    setLoadedFiles(prev => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, [ideTabs.closeTab, confirmDialog]);

  const handleOpen = useCallback((node: WorkbenchResourceNode) => {
    // 文件树节点：先加载内容
    if (node.metadata?.isFile && bookId && typeof node.metadata.filePath === "string") {
      const filePath = node.metadata.filePath;
      if (isImageFilePath(filePath)) {
        ideTabsRef.current.openTab(node.id, node.title, "file", "explorer");
        onOpen(node);
        return;
      }
      fetch(`/api/books/${encodeURIComponent(bookId)}/files/read?path=${encodeURIComponent(filePath)}`)
        .then(r => r.json())
        .then((data: { content?: string }) => {
          let content = data.content ?? "";
          // 性能保护:超过 500KB 的文件截断显示,避免 TipTap 卡死
          const MAX_CHARS = 500_000;
          if (content.length > MAX_CHARS) {
            content = content.slice(0, MAX_CHARS) + `\n\n---\n⚠️ 文件过大(${(content.length / 1000).toFixed(0)}K 字符),仅显示前 ${MAX_CHARS / 1000}K。请使用外部编辑器打开完整文件。`;
          }
          const loaded: WorkbenchResourceNode = { ...node, content };
          setLoadedFiles(prev => new Map(prev).set(node.id, loaded));
          ideTabsRef.current.openTab(node.id, node.title, "file", "explorer");
          onOpen(loaded);
        })
        .catch(() => {
          ideTabsRef.current.openTab(node.id, node.title, "file", "explorer");
          onOpen(node);
        });
      return;
    }
    // 搜索/结算历史生成的叙事记忆详情节点不在静态资源树中；缓存完整节点，
    // 否则 Tab 虽会激活，但 activeNode 无法解析，画布仍停留在旧面板而显示空白。
    if (node.metadata?.isNarrativeMemoryEntry === true || node.kind === "jingwei-entry") {
      setLoadedFiles((previous) => new Map(previous).set(node.id, node));
    }
    if (node.capabilities.open) ideTabsRef.current.openTab(node.id, node.title, toTabKind(node), toTabView(node));
    onOpen(node);
  }, [onOpen, bookId, showPanel]);

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

  // 伏笔看板"目标章节"跳转：按章节号在资源/文件树中找到章节节点并打开
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
    const { activeTabId: tabId, setDirty } = ideTabsRef.current;
    if (tabId) setDirty(tabId, ctx.dirty);
    onCanvasContextChange?.(ctx);
  }, [onCanvasContextChange]);

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
  const handleBreadcrumbNavigate = useCallback((segment: string, index: number) => {
    if (index === 0) {
      // 点击书名 → 关闭所有 tab 回到驾驶舱
      ideTabsRef.current.closeAll();
      return;
    }
    if (!activeNode) return;

    // 文件节点：尝试拼接路径段找到对应资源
    if (activeNode.metadata?.isFile) {
      const filePath = activeNode.metadata?.filePath;
      if (typeof filePath === "string") {
        const parts = filePath.split(/[\\/]/).filter(Boolean);
        const subPath = parts.slice(0, index).join("/");
        if (subPath) {
          const match = fileTree.nodes.find(n => {
            const fp = n.metadata?.filePath;
            return typeof fp === "string" && (fp === subPath || fp.endsWith("/" + subPath) || fp.endsWith("\\" + subPath));
          });
          if (match) { handleOpen(match); return; }
        }
      }
    }

    // 经纬条目：点击分类段 → 打开分类节点
    if (activeNode.kind === "jingwei-entry" || activeNode.kind === "jingwei") {
      const catMeta = CATEGORY_META.find(m => m.name === segment);
      if (catMeta) {
        const sectionNode = jingweiSections.find(s => s.metadata?.category === catMeta.id);
        if (sectionNode) { handleOpen(sectionNode); return; }
      }
    }
  }, [activeNode, fileTree.nodes, jingweiSections, handleOpen]);

  // ActivityBar click: VS Code 行为 — 同一个图标折叠，不同图标切换
  // ActivityBar click: 命令式切换面板
  const handleViewClick = useCallback((view: SidebarView) => {
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
      return;
    }
    showPanel(view as ViewId);
    setSidebarVisible(true);
  }, [activeView, sidebarVisible, showPanel]);

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
  }) => {
    void onSendToNarrator?.(buildWriteRequestMessage(payload));
  }, [onSendToNarrator]);

  /**
   * 章节保存包装：保存落盘后派发写作进度事件，写作视图据此自动刷新就绪、
   * 卷驾驶舱与本章提议，去掉「保存后必须手动点刷新」。用一次性 DOM 事件而非
   * 轮询定时器：只在真正保存成功时触发一次。
   */
  const handleSaveWithProgress = useCallback(async (node: WorkbenchResourceNode, content: string) => {
    await onSave(node, content);
    window.dispatchEvent(new CustomEvent(WRITING_PROGRESS_EVENT, { detail: { reason: "chapter-save" } }));
  }, [onSave]);

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
  }, []);

  /**
   * 写作视图「一键修」→ 切到侧栏经纬视图并定位分类。
   *
   * 侧栏经纬树分「设定」「推进」两个顶层分区（见 loadLoreSections），
   * 动态分类（outline 卷纲等）在「推进」分区下，同样可定位。
   */
  const handleOpenLorePanel = useCallback((category?: string) => {
    setShowSettings(false);
    showPanel("jingwei");
    setSidebarVisible(true);
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
      if (target) onOpen(target);
    }
  }, [showPanel, jingweiSections, onOpen]);

  // ── 快捷键系统 ──
  const keybindingActions = useMemo(() => ({
    save: () => {
      window.dispatchEvent(new CustomEvent("ide:save"));
    },
    closeTab: () => {
      const tabId = ideTabsRef.current.activeTabId;
      if (tabId) {
        ideTabsRef.current.closeTab(tabId);
        setLoadedFiles(prev => { if (!prev.has(tabId)) return prev; const n = new Map(prev); n.delete(tabId); return n; });
      }
    },
    toggleSidebar: () => setSidebarVisible(v => !v),
    toggleChat: () => setChatVisible(v => !v),
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
      showPanel(view as ViewId);
      setSidebarVisible(true);
    },
    openCommandPalette: () => {
      setPaletteMode("commands");
      setPaletteOpen(true);
    },
    openQuickOpen: () => {
      setPaletteMode("files");
      setPaletteOpen(true);
    },
  }), []);
  useIdeKeybindings(keybindingActions);

  // ── 命令面板 ──
  const ideCommandOptions = useMemo(() => ({
    switchView: keybindingActions.switchView,
    toggleSidebar: keybindingActions.toggleSidebar,
    toggleChat: keybindingActions.toggleChat,
    setShowSettings,
    closeTab: keybindingActions.closeTab,
    closeAllTabs: () => ideTabsRef.current.closeAll(),
    // 导入是写操作：交给叙述者执行，保留 Runtime 的权限确认。
    openImportWizard: () => onSendToNarrator?.(
      "我要导入一本已有的旧书继续写。请先问我要导入的文本或文件，然后用 pipeline.import_chapters（autoSettle+extractBrief）导入；拆书产物先留在 needs-review，等我确认再入 canon。",
    ),
    sendToNarrator: (message: string) => { void onSendToNarrator?.(message); },
  }), [onSendToNarrator]);
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
            category: "经纬",
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
        const title = await promptDialog({ title: "新建经纬条目", placeholder: "条目标题", confirmLabel: "创建" });
        if (!title) return;
        const category = node.metadata?.category ?? node.id.replace("jingwei-section:", "");
        try {
          await ensureOk(await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, category, contentMd: "" }),
          }), "创建经纬条目失败");
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
      setSplitNodeId(node.id);
    } else if (type === "generate-variant" || type === "scene-spec") {
      // 章节专属操作：打开章节文件，用户通过编辑器工具栏操作
      handleOpen(node);
    }
  }, [bookId, fileClipboard, refreshFileTree, setSplitNodeId, handleOpen, confirmDialog, promptDialog, alertDialog]);

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

  return (
    <>
      <div className="flex h-full w-full bg-background" style={{ minHeight: 0 }}>
      {/* ── ActivityBar（VS Code 规范：48px 宽，48px 项高，左侧 2px 强调条，背景加重区分） ── */}
      <div className="flex h-full w-12 shrink-0 flex-col justify-between items-center border-r border-border bg-secondary">
        <div className="flex flex-col items-center gap-1 pt-2">
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
        <div className="flex flex-col items-center gap-1 pb-2">
          <ActivityBarItem
            icon={MessageSquare}
            label="AI 对话"
            active={chatVisible && !showSettings}
            onClick={() => setChatVisible(v => !v)}
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
      <div className="relative flex-1" style={{ minWidth: 0, minHeight: 0, height: "100%" }}>
        <Allotment
          key={`outer-layout:${layoutStorageId}`}
          proportionalLayout={false}
          defaultSizes={ideLayoutSizesToArray(initialLayoutSizes)}
          onDragEnd={handleOuterLayoutDragEnd}
        >
          {/* Sidebar — 纯 DOM 面板管理,React 通过 portal 渲染内容 */}
          <Allotment.Pane minSize={150} preferredSize={220} visible={sidebarVisible}>
            <div className="flex h-full flex-col border-r border-border bg-card">
              {/* Sidebar 标题 */}
              <div className="flex h-[35px] shrink-0 items-center border-b border-border px-2">
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide pl-3">
                    {SIDEBAR_VIEWS.find(v => v.id === activeView)?.title ?? "资源管理器"}
                </span>
              </div>
              {/* PanelManager 宿主:面板容器由 JS 创建,React 通过 portal 往里渲染 */}
              <div ref={hostRef} className="flex-1 relative" />
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
                  visible={activeView === "write" && sidebarVisible && !showSettings}
                />,
                getContainer("write")!
              )}
              {panelsReady && getContainer("explorer") && createPortal(
                explorerNodes.length > 0
                  ? <WorkbenchResourceTree nodes={explorerNodes} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} cutNodeIds={fileClipboard?.mode === "cut" ? [fileClipboard.node.id] : []} sortStorageKey={`novelfork:resource-tree-sort:${bookId ?? "global"}:explorer`} />
                  : fileTree.loading
                    ? <div className="flex h-full items-center justify-center"><span role="status" aria-live="polite" className="text-xs text-muted-foreground">正在扫描文件…</span></div>
                    : fileTree.error
                      ? <div className="flex h-full items-center justify-center px-4 text-center"><span role="alert" className="break-words text-xs text-destructive">{fileTree.error}</span></div>
                      : <div className="flex h-full items-center justify-center"><span className="text-xs text-muted-foreground">暂无文件</span></div>,
                getContainer("explorer")!
              )}
              {panelsReady && getContainer("jingwei") && createPortal(
                bookId
                  ? <div className="flex h-full flex-col">
                      <JingweiSidebarToolbar bookId={bookId} onChanged={() => void loadLoreSections()} />
                      <WorkbenchResourceTree
                        nodes={jingweiSections}
                        selectedNodeId={activeNode?.id ?? null}
                        onOpen={handleOpen}
                        onAction={handleResourceAction}
                        sortStorageKey={`novelfork:resource-tree-sort:${bookId ?? "global"}:jingwei`}
                      />
                    </div>
                  : <div className="flex h-full items-center justify-center p-4 text-center">
                      <span className="text-xs text-muted-foreground">先打开一本书，再回到经纬。</span>
                    </div>,
                getContainer("jingwei")!
              )}
              {/*
                叙事记忆挂完整面板，不是只读事实树。
                只读树只能看事实，作者拿不到章后结算真正需要的动作：待审事件的
                批准/拒绝、结算历史、叙事线审批台账、召回诊断、图谱入口。
                这些能力都在 NarrativeMemoryPanel 里，此处是它唯一的挂载点。
                事实树保留为面板内的「状态树」分区（memoryNodes）。
              */}
              {panelsReady && getContainer("narrative-memory") && createPortal(
                bookId
                  ? <NarrativeMemoryPanel
                      bookId={bookId}
                      memoryNodes={narrativeMemorySections}
                      selectedNodeId={activeNode?.id ?? null}
                      onOpen={handleOpen}
                      onAction={handleResourceAction}
                    />
                  : <div className="flex h-full items-center justify-center p-4 text-center">
                      <span className="text-xs text-muted-foreground">先打开一本书，再回到叙事记忆。</span>
                    </div>,
                getContainer("narrative-memory")!
              )}
              {panelsReady && getContainer("tools") && createPortal(
                <WorkbenchResourceTree nodes={toolNodes} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} />,
                getContainer("tools")!
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
                      onCloseOthers={ideTabs.closeOthers}
                      onCloseAll={ideTabs.closeAll}
                      onCloseSaved={ideTabs.closeSaved}
                      onCloseRight={ideTabs.closeRight}
                      onTogglePin={ideTabs.togglePin}
                      onReorder={ideTabs.reorderTabs}
                      actionsSlotRef={toolbarSlotRef}
                      onSplitRight={(tabId) => setSplitNodeId(tabId)}
                    />
                  )}
                  <EditorBreadcrumbs bookTitle={bookRoot?.title} node={activeNode} view={activeView} showSettings={showSettings} onNavigate={handleBreadcrumbNavigate} />
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
                              onSave={handleSaveWithProgress}
                              onCanvasContextChange={tabId === ideTabs.activeTabId ? handleCanvasContextChange : undefined}
                              onGuideComplete={handleGuideCompleteWithOnboarding}
                              chapterActions={chapterActions}
                              jingweiActions={jingweiActions}
                              toolbarSlotRef={toolbarSlotRef}
                              isActive={tabId === ideTabs.activeTabId}
                              onJumpToChapter={handleJumpToChapter}
                              onOpenJingweiEntry={handleOpenJingweiEntry}
                            />
                          </div>
                        ))}
                      </>
                    ) : activeView === "explorer" ? (
                      <WorkbenchCanvas
                        node={null}
                        nodes={nodes}
                        bookId={bookId}
                        repositoryPath={repositoryPath}
                        onSave={handleSaveWithProgress}
                        onCanvasContextChange={handleCanvasContextChange}
                        onGuideComplete={handleGuideCompleteWithOnboarding}
                        chapterActions={chapterActions}
                        jingweiActions={jingweiActions}
                        toolbarSlotRef={toolbarSlotRef}
                        onJumpToChapter={handleJumpToChapter}
                        onOpenJingweiEntry={handleOpenJingweiEntry}
                      />
                    ) : (
                      <ViewEmptyState view={activeView} />
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
                      <span className="text-[12px] text-foreground truncate">{splitNode.title}</span>
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
                        onSave={handleSaveWithProgress}
                        onCanvasContextChange={() => {}}
                        chapterActions={chapterActions}
                        jingweiActions={jingweiActions}
                        onJumpToChapter={handleJumpToChapter}
                        onOpenJingweiEntry={handleOpenJingweiEntry}
                      />
                    </div>
                  </div>
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>

          {/* Chat Panel（右侧辅助栏，类似 VS Code AuxiliaryBar） */}
          <Allotment.Pane minSize={200} preferredSize={320} visible={chatVisible}>
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
    {/* 文件/条目操作弹层（confirm/prompt/alert 的产品内实现） */}
      {dialogElement}
    </>
  );
}

// ── ActivityBarItem ──────────────────────────────────────

function ActivityBarItem({ icon: Icon, label, active, onClick }: {
  icon: typeof Files;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative flex h-12 w-12 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary" />}
      <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.6} />
    </button>
  );
}

// ── ChatHeader ──────────────────────────────────────────

function ChatHeader({
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onSwitchToAgent,
}: {
  sessions?: readonly { id: string; title: string; updatedAt?: string }[];
  activeSessionId?: string | null;
  onSwitchSession?: (id: string) => void;
  onCreateSession?: () => void;
  onSwitchToAgent?: () => void;
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
                <span className="shrink-0 ml-2 text-[10px] text-muted-foreground">
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
  { text: "新建书籍后，先录入核心设定到经纬系统，AI 写作会更准确" },
  { text: "试试说「帮我写下一章」，AI 会根据大纲和设定自动生成" },
  { text: "写作管线会生成正式章节结果，可在章节编辑器里继续修订" },
  { text: "可以用预设控制写作风格——武侠、言情、悬疑各有模板" },
  { text: "写作卡壳？说「给我三个推进方向」让 AI 帮你打开思路" },
  { text: "直接粘贴大纲，AI 会帮你拆分成章节结构" },
  { text: "经纬系统是静态设定库；时间线、关系变化和伏笔推进在叙事记忆里管理" },
  { text: "静态 Lore 写入 canon/rules 需有来源；动态事实先进入待确认叙事事件" },
  { text: "用「检查一致性」让 AI 做 37 维连续性审查，找出逻辑漏洞" },
  { text: "节奏分析、POV 视角、伏笔追踪——写作工具栏里都有" },
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
  "jingwei-entry": "经纬",
  jingwei: "经纬",
  tool: "工具",
  "tool-result": "工具",
  book: "书籍",
};

function breadcrumbSegments(bookTitle: string | undefined, node: WorkbenchResourceNode): string[] {
  const segments: string[] = [bookTitle || "NovelFork"];

  // 文件树节点：用真实文件路径分段
  const filePath = node.metadata?.filePath;
  if (node.metadata?.isFile && typeof filePath === "string") {
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    return [bookTitle || "NovelFork", ...parts];
  }

  // 经纬条目：书 › 经纬 › 分类 › 条目
  const category = node.metadata?.category;
  if (node.kind === "jingwei-entry" || node.kind === "jingwei") {
    segments.push("经纬");
    if (typeof category === "string" && category) {
      segments.push(CATEGORY_META.find(m => m.id === normalizeCategory(category).category)?.name ?? category);
    }
    segments.push(node.title);
    return segments;
  }

  // 章节等：书 › 类型 › 标题
  if (node.metadata?.isNarrativeMemoryEntry) {
    segments.push("叙事记忆");
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
  explorer: "资源管理器",
  jingwei: "经纬",
  tools: "工具",
  search: "搜索",
  "narrative-memory": "叙事记忆",
};

function EditorBreadcrumbs({ bookTitle, node, view, showSettings, onNavigate }: {
  bookTitle?: string;
  node: WorkbenchResourceNode | null;
  view: SidebarView;
  showSettings?: boolean;
  /** 点击面包屑段时回调（segment 文本 + index） */
  onNavigate?: (segment: string, index: number) => void;
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
        const clickable = !!onNavigate && !isLast;
        return (
          <span key={`${seg}-${i}`} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
            <span
              className={`text-[11px] truncate max-w-[180px] ${isLast ? "text-foreground" : "text-muted-foreground"} ${clickable ? "cursor-pointer hover:text-foreground hover:underline underline-offset-2 transition-colors" : ""}`}
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

// ── ViewEmptyState（经纬/工具视图无激活 Tab 时的空态） ──

function ViewEmptyState({ view }: { view: SidebarView }) {
  const meta = view === "jingwei"
    ? { icon: "📜", title: "经纬", desc: "从左侧选择一个分类或条目查看与编辑设定" }
    : view === "search"
    ? { icon: "🔍", title: "搜索", desc: "在搜索面板中输入关键词查找资源" }
    : { icon: "🔧", title: "工具", desc: "从左侧选择一个工具面板（质量监控、角色弧线、伏笔看板等）" };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-background p-8 text-center">
      <span className="text-3xl">{meta.icon}</span>
      <p className="text-sm font-medium text-foreground">{meta.title}</p>
      <p className="max-w-[280px] text-xs text-muted-foreground">{meta.desc}</p>
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
        <p className="mt-1 px-1 text-[10px] leading-relaxed text-muted-foreground">
          范围：章节正文、工作区资源、经纬和叙事记忆
        </p>
      </div>
      {/* 搜索结果列表 */}
      <div ref={resultsRef} className="flex-1 overflow-y-auto px-1 py-1">
        {query.trim() && results.length === 0 && (
          <p className="px-2 py-4 text-center text-xs leading-relaxed text-muted-foreground">
            当前书籍的章节正文、工作区资源、经纬和叙事记忆中没有匹配结果
          </p>
        )}
        {[...grouped.entries()].map(([group, items]) => (
          <div key={group} className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
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
                  <span className="text-[11px] text-muted-foreground truncate leading-snug">
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
  if (node.metadata?.isNarrativeMemoryEntry === true) return "叙事记忆";
  switch (node.kind) {
    case "chapter": return "章节";
    case "jingwei-entry": return "经纬条目";
    case "jingwei-section":
    case "jingwei": return "经纬";
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
          <span className="text-2xl">⚠️</span>
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
