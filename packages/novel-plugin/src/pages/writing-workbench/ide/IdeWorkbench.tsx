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
  Clock, PlusCircle, Search, Sparkles, Lightbulb, ChevronRight,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { WorkbenchCanvas, type WorkbenchCanvasContext } from "../WorkbenchCanvas";
import { WorkbenchResourceTree } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
import { createToolSectionNodes } from "../useWorkbenchResources";
import { CATEGORY_META, normalizeCategory } from "../../../engine/jingwei/unified-categories";
import type { CandidateActionHandlers, DraftActionHandlers, ChapterActionHandlers } from "../WorkbenchCanvas";
import { EditorTabs } from "./EditorTabs";
import { useIdeTabs, type TabKind, type TabView } from "./use-ide-tabs";
import { useBookFileTree } from "./use-book-file-tree";
import { BookSettingsPanel } from "../panels/BookSettingsPanel";
import { useIdeKeybindings } from "./use-ide-keybindings";
import { usePanelManager, type ViewId } from "./use-panel-manager";
import { CommandPalette } from "./command-palette";
import { useIdeCommands } from "./use-ide-commands";

/** WorkbenchResourceNode.kind → Tab 图标用的 TabKind */
function toTabKind(node: WorkbenchResourceNode): TabKind {
  if (node.metadata?.isFile) return "file";
  switch (node.kind) {
    case "chapter": return "chapter";
    case "draft": return "draft";
    case "candidate": return "candidate";
    case "jingwei-entry": return "jingwei-entry";
    case "tool": return "tool";
    default: return "other";
  }
}

/** WorkbenchResourceNode → 归属的 ActivityBar 视图（决定 Tab 落在哪个工作区） */
function toTabView(node: WorkbenchResourceNode): TabView {
  if (node.kind === "tool" || node.kind === "tool-group") return "tools";
  if (node.kind === "jingwei" || node.kind === "jingwei-section" || node.kind === "jingwei-entry") return "jingwei";
  return "explorer";
}

// ── Types ──────────────────────────────────────────────

export type SidebarView = "explorer" | "jingwei" | "tools";

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
  onGuideComplete?: () => void;
  candidateActions?: CandidateActionHandlers;
  draftActions?: DraftActionHandlers;
  chapterActions?: ChapterActionHandlers;
  chatSlot?: ReactNode;
  onSwitchToAgent?: () => void;
  bookSessions?: readonly { id: string; title: string; updatedAt?: string }[];
  activeSessionId?: string | null;
  onSwitchSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
}

// ── ViewContainer 定义（VS Code 风格：每个 Sidebar 视图的元数据） ──

const SIDEBAR_VIEWS: { id: SidebarView; icon: typeof Files; label: string; title: string }[] = [
  { id: "explorer", icon: Files, label: "资源管理器", title: "资源管理器" },
  { id: "jingwei", icon: Scroll, label: "经纬", title: "经纬" },
  { id: "tools", icon: Wrench, label: "工具", title: "工具" },
];

// ── 过滤逻辑 ──

const CHAPTER_GROUP_IDS = new Set(["group:chapters", "group:candidates", "group:drafts", "group:archived"]);
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
  }
}

// ── Main Component ──────────────────────────────────────

export function IdeWorkbench({
  bookId,
  nodes,
  selectedNode,
  onOpen,
  onSave,
  onCanvasContextChange,
  onGuideComplete,
  candidateActions,
  draftActions,
  chapterActions,
  chatSlot,
  onSwitchToAgent,
  bookSessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
}: IdeWorkbenchProps) {
  // --- Layout state ---
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [chatVisible, setChatVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [splitNodeId, setSplitNodeId] = useState<string | null>(null);

  // --- Command Palette state ---
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"commands" | "files">("commands");

  // --- 命令式面板管理(纯 DOM 操作,学 VS Code CompositePart) ---
  const { activeView, showPanel, hostRef, getContainer, ready: panelsReady } = usePanelManager("explorer");

  // --- Tabs ---
  const ideTabs = useIdeTabs(bookId, activeView);
  const ideTabsRef = useRef(ideTabs);
  ideTabsRef.current = ideTabs;

  // --- Portal container for toolbar (WorkbenchCanvas → EditorTabs) ---
  const toolbarSlotRef = useRef<HTMLDivElement>(null);

  // --- 经纬分类树（始终加载,面板始终 mount） ---
  const [jingweiSections, setJingweiSections] = useState<WorkbenchResourceNode[]>([]);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      try {
        const entRes = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`).then(r => r.json());
        if (cancelled) return;
        const entries: Array<{ id: string; title: string; category?: string; contentMd?: string; sectionId?: string }> = entRes?.entries ?? [];

        // 按统一分类分组（脏 category 经 normalizeCategory 归一）
        const byCategory = new Map<string, typeof entries>();
        for (const e of entries) {
          const cat = normalizeCategory(e.category ?? "unclassified").category;
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat)!.push(e);
        }

        // 只显示有条目的分类 + 保持 CATEGORY_META 顺序
        const nodes: WorkbenchResourceNode[] = CATEGORY_META
          .filter(meta => (byCategory.get(meta.id)?.length ?? 0) > 0)
          .map(meta => {
            const catEntries = byCategory.get(meta.id) ?? [];
            return {
              id: `jingwei-cat:${meta.id}`,
              kind: "group" as const,
              title: `${meta.name} (${catEntries.length})`,
              capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
              metadata: { category: meta.id },
              children: catEntries.map(e => ({
                id: `jingwei-entry:${e.id}`,
                kind: "jingwei-entry" as const,
                title: e.title,
                content: e.contentMd ?? "",
                capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
                metadata: { entryId: e.id, sectionId: e.sectionId, isJingweiEntry: true },
              })),
            };
          });
        setJingweiSections(nodes);
      } catch {
        if (!cancelled) setJingweiSections([]);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  // --- 资源管理器：真实文件树（始终加载） ---
  const fileTree = useBookFileTree(bookId, true);
  const refreshFileTree = fileTree.refresh;

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
    // 工具节点也加入，使点击工具能解析 activeNode → 渲染真实工具面板
    toolNodes.forEach(walk);
    return map;
  }, [nodes, fileTree.nodes, jingweiSections, toolNodes]);

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
  const handleCloseTab = useCallback((tabId: string) => {
    const tab = ideTabsRef.current.tabs.find(t => t.id === tabId);
    if (tab?.dirty) {
      if (!confirm(`"${tab.title}" 有未保存的修改，确认关闭？`)) return;
    }
    ideTabs.closeTab(tabId);
    setLoadedFiles(prev => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, [ideTabs.closeTab]);

  const handleOpen = useCallback((node: WorkbenchResourceNode) => {
    // 文件树节点：先加载内容
    if (node.metadata?.isFile && bookId && typeof node.metadata.filePath === "string") {
      const filePath = node.metadata.filePath;
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
    if (node.capabilities.open) ideTabsRef.current.openTab(node.id, node.title, toTabKind(node), toTabView(node));
    onOpen(node);
  }, [onOpen, bookId]);

  const handleCanvasContextChange = useCallback((ctx: WorkbenchCanvasContext) => {
    const { activeTabId: tabId, setDirty } = ideTabsRef.current;
    if (tabId) setDirty(tabId, ctx.dirty);
    onCanvasContextChange?.(ctx);
  }, [onCanvasContextChange]);

  // 经纬条目保存/删除（调 API），供 WorkbenchCanvas 的 JingweiEntryEditor 使用
  const jingweiActions = useMemo(() => {
    if (!bookId) return undefined;
    return {
      onSave: async (entryId: string, payload: { title: string; contentMd: string }) => {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      },
      onDelete: async (entryId: string) => {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "DELETE",
        });
      },
    };
  }, [bookId]);

  // ActivityBar click: VS Code 行为 — 同一个图标折叠，不同图标切换
  // ActivityBar click: 命令式切换面板
  const handleViewClick = useCallback((view: SidebarView) => {
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      showPanel(view as ViewId);
      setSidebarVisible(true);
    }
  }, [activeView, sidebarVisible, showPanel]);

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
    switchView: (view: "explorer" | "jingwei" | "tools") => {
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
  }), []);
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
      if (!confirm(`确认删除 "${node.title}"？此操作不可撤销。`)) return;
      try {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/files/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath }),
        });
        refreshFileTree();
      } catch (err) {
        alert(`操作失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    } else if (type === "rename" && typeof filePath === "string") {
      const newName = prompt("新名称:", node.title);
      if (!newName || newName === node.title) return;
      const dir = filePath.replace(/[/\\][^/\\]+$/, "");
      const newPath = dir ? `${dir}/${newName}` : newName;
      try {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/files/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath: filePath, newPath }),
        });
        refreshFileTree();
      } catch (err) {
        alert(`操作失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    } else if (type === "create") {
      // 经纬条目创建
      if (node.kind === "jingwei-section" && bookId) {
        const title = prompt("新条目标题:");
        if (!title) return;
        const category = node.metadata?.category ?? node.id.replace("jingwei-section:", "");
        try {
          await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, category, contentMd: "" }),
          });
        } catch (err) {
          alert(`操作失败: ${err instanceof Error ? err.message : "未知错误"}`);
        }
      }
    } else if (type === "create-file" && typeof filePath === "string") {
      const name = prompt("文件名:");
      if (!name) return;
      const dir = node.metadata?.isDirectory ? filePath : filePath.replace(/[/\\][^/\\]+$/, "");
      try {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/files`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: `${dir}/${name}`, content: "" }),
        });
        refreshFileTree();
      } catch (err) {
        alert(`操作失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    } else if (type === "create-folder" && typeof filePath === "string") {
      const name = prompt("文件夹名:");
      if (!name) return;
      const dir = node.metadata?.isDirectory ? filePath : filePath.replace(/[/\\][^/\\]+$/, "");
      try {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/files/mkdir`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: `${dir}/${name}` }),
        });
        refreshFileTree();
      } catch (err) {
        alert(`操作失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    } else if (type === "open-side") {
      setSplitNodeId(node.id);
    }
  }, [bookId, refreshFileTree, setSplitNodeId]);

  return (
    <TooltipProvider>
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
            icon={Settings}
            label="写作设置"
            active={showSettings}
            onClick={() => setShowSettings(v => !v)}
          />
        </div>
      </div>

      {/* ── Main Area（Sidebar + Editor + Chat） ── */}
      <div className="relative flex-1" style={{ minWidth: 0, minHeight: 0, height: "100%" }}>
        <Allotment proportionalLayout={false}>
          {/* Sidebar — 纯 DOM 面板管理,React 通过 portal 渲染内容 */}
          <Allotment.Pane minSize={150} preferredSize={220} maxSize={360} visible={sidebarVisible}>
            <div className="flex h-full flex-col border-r border-border bg-card">
              {/* Sidebar 标题 */}
              <div className="flex h-[35px] shrink-0 items-center border-b border-border px-2">
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide pl-3">
                  {activeView === "explorer" ? "资源管理器" : activeView === "jingwei" ? "经纬" : "工具"}
                </span>
              </div>
              {/* PanelManager 宿主:面板容器由 JS 创建,React 通过 portal 往里渲染 */}
              <div ref={hostRef} className="flex-1 relative" />
              {/* Portal 渲染各面板内容到 PanelManager 创建的 DOM 容器 */}
              {panelsReady && getContainer("explorer") && createPortal(
                fileTree.nodes.length > 0
                  ? <WorkbenchResourceTree nodes={fileTree.nodes} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} />
                  : <div className="flex h-full items-center justify-center"><span className="text-xs text-muted-foreground">暂无文件</span></div>,
                getContainer("explorer")!
              )}
              {panelsReady && getContainer("jingwei") && createPortal(
                jingweiSections.length > 0
                  ? <WorkbenchResourceTree nodes={jingweiSections} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} />
                  : <div className="flex h-full items-center justify-center"><span className="text-xs text-muted-foreground">暂无经纬条目</span></div>,
                getContainer("jingwei")!
              )}
              {panelsReady && getContainer("tools") && createPortal(
                <WorkbenchResourceTree nodes={toolNodes} selectedNodeId={activeNode?.id ?? null} onOpen={handleOpen} onAction={handleResourceAction} />,
                getContainer("tools")!
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
                      activeView={activeView}
                      onActivate={ideTabs.activateTab}
                      onClose={handleCloseTab}
                      onCloseOthers={ideTabs.closeOthers}
                      onCloseAll={ideTabs.closeAll}
                      onCloseSaved={ideTabs.closeSaved}
                      onCloseRight={ideTabs.closeRight}
                      actionsSlotRef={toolbarSlotRef}
                      onSplitRight={(tabId) => setSplitNodeId(tabId)}
                    />
                  )}
                  <EditorBreadcrumbs bookTitle={bookRoot?.title} node={activeNode} view={activeView} showSettings={showSettings} />
                  <div className="flex-1 min-h-0">
                  <EditorErrorBoundary>
                    {showSettings && bookId ? (
                      <div className="h-full overflow-y-auto">
                        <BookSettingsPanel bookId={bookId} onBack={() => setShowSettings(false)} />
                      </div>
                    ) : activeNode ? (
                      <WorkbenchCanvas
                        key={activeNode.id}
                        node={activeNode}
                        nodes={nodes}
                        bookId={bookId}
                        onSave={onSave}
                        onCanvasContextChange={handleCanvasContextChange}
                        onGuideComplete={onGuideComplete}
                        candidateActions={candidateActions}
                        draftActions={draftActions}
                        chapterActions={chapterActions}
                        jingweiActions={jingweiActions}
                        toolbarSlotRef={toolbarSlotRef}
                      />
                    ) : activeView === "explorer" ? (
                      <WorkbenchCanvas
                        node={null}
                        nodes={nodes}
                        bookId={bookId}
                        onSave={onSave}
                        onCanvasContextChange={handleCanvasContextChange}
                        onGuideComplete={onGuideComplete}
                        candidateActions={candidateActions}
                        draftActions={draftActions}
                        chapterActions={chapterActions}
                        jingweiActions={jingweiActions}
                        toolbarSlotRef={toolbarSlotRef}
                      />
                    ) : (
                      <ViewEmptyState view={activeView} />
                    )}
                  </EditorErrorBoundary>
                  </div>
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
                        onSave={onSave}
                        onCanvasContextChange={() => {}}
                        candidateActions={candidateActions}
                        draftActions={draftActions}
                        chapterActions={chapterActions}
                        jingweiActions={jingweiActions}
                      />
                    </div>
                  </div>
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>

          {/* Chat Panel（右侧辅助栏，类似 VS Code AuxiliaryBar） */}
          <Allotment.Pane minSize={200} preferredSize={320} maxSize={460} visible={chatVisible}>
            <div className="flex h-full flex-col border-l border-border bg-card">
              <ChatHeader
                sessions={bookSessions}
                activeSessionId={activeSessionId}
                onSwitchSession={onSwitchSession}
                onCreateSession={onCreateSession}
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
    />
    </TooltipProvider>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={`relative flex h-12 w-12 items-center justify-center rounded-md transition-colors ${
            active
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary" />}
          <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.6} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

// ── ChatHeader ──────────────────────────────────────────

function ChatHeader({
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
}: {
  sessions?: readonly { id: string; title: string; updatedAt?: string }[];
  activeSessionId?: string | null;
  onSwitchSession?: (id: string) => void;
  onCreateSession?: () => void;
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
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => { setShowHistory(v => !v); setSearchQuery(""); }}
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50">
                <Clock className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">会话历史</TooltipContent>
          </Tooltip>
          {onCreateSession && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onCreateSession}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50">
                  <PlusCircle className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">新建对话</TooltipContent>
            </Tooltip>
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
  { text: "写作管线支持多候选稿对比，选最满意的那版保留" },
  { text: "可以用预设控制写作风格——武侠、言情、悬疑各有模板" },
  { text: "写作卡壳？说「给我三个推进方向」让 AI 帮你打开思路" },
  { text: "直接粘贴大纲，AI 会帮你拆分成章节结构" },
  { text: "经纬系统是 AI 的记忆核心——角色、世界观、时间线都在这管理" },
  { text: "设定分 canon/dynamic/reference 三层，优先级不同，AI 调用时自动裁剪" },
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
  candidate: "候选稿",
  draft: "草稿",
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

  // 章节/候选/草稿等：书 › 类型 › 标题
  const kindLabel = KIND_LABEL[node.kind];
  if (kindLabel) segments.push(kindLabel);
  segments.push(node.title);
  return segments;
}

const VIEW_LABEL: Record<SidebarView, string> = {
  explorer: "资源管理器",
  jingwei: "经纬",
  tools: "工具",
};

function EditorBreadcrumbs({ bookTitle, node, view, showSettings }: { bookTitle?: string; node: WorkbenchResourceNode | null; view: SidebarView; showSettings?: boolean }) {
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
        return (
          <span key={`${seg}-${i}`} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
            <span className={`text-[11px] truncate max-w-[180px] ${isLast ? "text-foreground" : "text-muted-foreground"}`}>
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
    : { icon: "🔧", title: "工具", desc: "从左侧选择一个工具面板（质量监控、角色弧线、伏笔看板等）" };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-background p-8 text-center">
      <span className="text-3xl">{meta.icon}</span>
      <p className="text-sm font-medium text-foreground">{meta.title}</p>
      <p className="max-w-[280px] text-xs text-muted-foreground">{meta.desc}</p>
    </div>
  );
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
