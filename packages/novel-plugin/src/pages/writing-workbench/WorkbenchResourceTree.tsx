import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, FileText, BookOpen, Scroll, Globe, Sparkles, Layers, PenLine, BookMarked, Route, FolderOpen, Plus, Wrench } from "lucide-react";
import type { WorkbenchResourceNode, WorkbenchResourceKind } from "./useWorkbenchResources";
import { JingweiEmptyState } from "./JingweiEmptyState";
import { getResourceContextMenuItems } from "./ide/context-menu-registry";

export interface ResourceTreeAction {
  type: "create" | "create-file" | "create-folder" | "rename" | "delete" | "open-side" | "copy-path" | "copy" | "cut" | "paste" | "generate-variant" | "scene-spec" | "move";
  node: WorkbenchResourceNode;
  targetNode?: WorkbenchResourceNode;
  /** 内联编辑提供的名称（重命名/新建文件/新建文件夹） */
  newName?: string;
  name?: string;
}

export interface WorkbenchResourceTreeProps {
  nodes: readonly WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  cutNodeIds?: readonly string[];
  sortStorageKey?: string;
}

function NodeIcon({ kind }: { kind: WorkbenchResourceKind }) {
  switch (kind) {
    case "book": return <BookOpen className="size-4 text-primary" />;
    case "group": return <FolderOpen className="size-4 text-muted-foreground" />;
    case "chapter": return <FileText className="size-4 text-blue-500" />;
    case "jingwei": return <Scroll className="size-4 text-amber-500" />;
    case "story": return <Globe className="size-4 text-green-500" />;
    case "jingwei-section": case "jingwei-entry": return <BookMarked className="size-4 text-teal-500" />;
    case "narrative-line": return <Route className="size-4 text-rose-500" />;
    case "tool": return <Wrench className="size-4 text-indigo-500" />;
    case "tool-group": return <FolderOpen className="size-4 text-indigo-400" />;
    default: return <Sparkles className="size-4 text-muted-foreground" />;
  }
}

const CREATABLE_KINDS: Set<WorkbenchResourceKind> = new Set(["jingwei-section", "group"]);

function CapabilityBadges({ node }: { node: WorkbenchResourceNode }) {
  if (!node.capabilities.open) return null;
  return (
    <span className="ml-auto flex items-center gap-1 opacity-0 group-hover/node:opacity-100 transition-opacity">
      {node.capabilities.edit ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">编辑</Badge> : null}
      {node.capabilities.readonly ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">只读</Badge> : null}
    </span>
  );
}

function nodeFilePath(node: WorkbenchResourceNode): string | null {
  return typeof node.metadata?.filePath === "string" ? node.metadata.filePath : node.path ?? null;
}

function isDirectoryNode(node: WorkbenchResourceNode): boolean {
  return node.metadata?.isDirectory === true;
}

type ResourceTreeSortMode = "name" | "type" | "modified";

function extensionOfTitle(title: string): string {
  const dot = title.lastIndexOf(".");
  return dot >= 0 ? title.slice(dot + 1).toLowerCase() : "";
}

function sortNodes(nodes: readonly WorkbenchResourceNode[], mode: ResourceTreeSortMode): WorkbenchResourceNode[] {
  return [...nodes]
    .sort((a, b) => {
      const aDir = isDirectoryNode(a);
      const bDir = isDirectoryNode(b);
      if (aDir !== bDir) return aDir ? -1 : 1;
      if (mode === "type") {
        const byExt = extensionOfTitle(a.title).localeCompare(extensionOfTitle(b.title));
        if (byExt !== 0) return byExt;
      } else if (mode === "modified") {
        const aTime = typeof a.metadata?.mtime === "string" ? Date.parse(a.metadata.mtime) : 0;
        const bTime = typeof b.metadata?.mtime === "string" ? Date.parse(b.metadata.mtime) : 0;
        if (aTime !== bTime) return bTime - aTime;
      }
      return a.title.localeCompare(b.title);
    })
    .map((node) => node.children ? { ...node, children: sortNodes(node.children, mode) } : node);
}

function filterNodesByQuery(nodes: readonly WorkbenchResourceNode[], query: string): WorkbenchResourceNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  const visit = (node: WorkbenchResourceNode): WorkbenchResourceNode | null => {
    const children = node.children?.map(visit).filter(Boolean) as WorkbenchResourceNode[] | undefined;
    const match = node.title.toLowerCase().includes(q) || (nodeFilePath(node)?.toLowerCase().includes(q) ?? false);
    if (match || (children && children.length > 0)) return children ? { ...node, children } : node;
    return null;
  };
  return nodes.map(visit).filter(Boolean) as WorkbenchResourceNode[];
}

function isDraggableNode(node: WorkbenchResourceNode): boolean {
  return node.metadata?.isRoot !== true && typeof node.metadata?.filePath === "string" && node.capabilities.delete === true;
}

function isInvalidDrop(source: WorkbenchResourceNode, target: WorkbenchResourceNode): boolean {
  const sourcePath = nodeFilePath(source);
  const targetPath = nodeFilePath(target);
  if (!sourcePath || !targetPath) return true;
  const folderPath = isDirectoryNode(target) ? targetPath : targetPath.replace(/[/\\][^/\\]+$/, "");
  return sourcePath === folderPath || folderPath.startsWith(`${sourcePath}/`) || folderPath.startsWith(`${sourcePath}\\`);
}

/* ─── 内联编辑状态 ─── */

interface InlineEditState {
  renamingNodeId: string | null;
  creatingInNodeId: string | null;
  createMode: "file" | "folder" | null;
  value: string;
}

/** 内联输入框（重命名/新建共用） */
function InlineInput({
  defaultValue,
  placeholder,
  depth,
  icon,
  onSubmit,
  onCancel,
}: {
  defaultValue: string;
  placeholder: string;
  depth: number;
  icon?: React.ReactNode;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const committedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      // 选中文件名部分（不含扩展名）
      const dot = defaultValue.lastIndexOf(".");
      if (dot > 0) el.setSelectionRange(0, dot);
      else el.select();
    }
  }, []);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== defaultValue) onSubmit(trimmed);
    else onCancel();
  }, [value, defaultValue, onSubmit, onCancel]);

  return (
    <div className="group/node" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
      <div className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-0.5">
        {icon ?? <span className="w-3.5 shrink-0" />}
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          className="flex-1 min-w-0 h-6 rounded border border-primary bg-background px-1.5 text-sm outline-none"
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

/* ─── 原生右键菜单(不用 Radix,纯 DOM 定位) ─── */

interface MenuState { x: number; y: number; node: WorkbenchResourceNode }

function FloatingMenu({ state, onAction, onClose }: { state: MenuState; onAction: (a: ResourceTreeAction) => void; onClose: () => void }) {
  const items = getResourceContextMenuItems(state.node);
  if (items.length === 0) return null;
  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95" style={{ left: state.x, top: state.y }}>
        {items.map((item, index) => {
          const previous = items[index - 1];
          const separated = previous && previous.group !== item.group;
          return (
            <button key={item.id} type="button"
              className={`flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors ${separated ? "mt-1 border-t border-border/60 pt-2" : ""}`}
              onClick={() => { onAction({ type: item.action, node: state.node }); onClose(); }}>
              <span>{item.label}</span>
              {item.keybinding ? <span className="text-[10px] text-muted-foreground">{item.keybinding}</span> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ─── Tree Node(左键=打开,右键=菜单,互不干扰) ─── */

interface TreeNodeProps {
  node: WorkbenchResourceNode;
  depth: number;
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onContextMenu?: (e: React.MouseEvent, node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  draggedNode?: WorkbenchResourceNode | null;
  onDragNode?: (node: WorkbenchResourceNode | null) => void;
  cutNodeIds?: readonly string[];
  forceExpanded?: boolean;
  inlineEdit?: InlineEditState | null;
}

function TreeNode({ node, depth, selectedNodeId, onOpen, onContextMenu, onAction, draggedNode, onDragNode, cutNodeIds = [], forceExpanded = false, inlineEdit }: TreeNodeProps) {
  const isFileDir = node.metadata?.isDirectory === true;
  const [expanded, setExpanded] = useState(!isFileDir);
  const effectiveExpanded = forceExpanded || expanded;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = node.id === selectedNodeId;
  const canCreate = CREATABLE_KINDS.has(node.kind) && onAction;
  const isCut = cutNodeIds.includes(node.id);
  const [dropActive, setDropActive] = useState(false);
  const itemRef = useRef<HTMLDivElement | HTMLButtonElement | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 当进入内联重命名时，自动展开（如果需要）
  useEffect(() => {
    if (inlineEdit?.renamingNodeId === node.id && isFileDir && !effectiveExpanded) {
      setExpanded(true);
    }
  }, [inlineEdit?.renamingNodeId, node.id]);

  useEffect(() => {
    if (isSelected) itemRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const handleContext = (e: React.MouseEvent) => {
    if (onContextMenu) { e.preventDefault(); onContextMenu(e, node); }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!isDraggableNode(node)) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-novelfork-node-id", node.id);
    onDragNode?.(node);
  };
  const handleDragEnd = () => {
    onDragNode?.(null);
    setDropActive(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!draggedNode || draggedNode.id === node.id || isInvalidDrop(draggedNode, node)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
    if (isDirectoryNode(node) && !expanded && !expandTimerRef.current) {
      expandTimerRef.current = setTimeout(() => {
        setExpanded(true);
        expandTimerRef.current = null;
      }, 500);
    }
  };
  const handleDragLeave = () => {
    setDropActive(false);
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!draggedNode || draggedNode.id === node.id || isInvalidDrop(draggedNode, node)) return;
    e.preventDefault();
    setDropActive(false);
    onAction?.({ type: "move", node: draggedNode, targetNode: node });
    onDragNode?.(null);
  };

  // ── 内联重命名：替换标题为 input ──
  const isRenaming = inlineEdit?.renamingNodeId === node.id;
  if (isRenaming) {
    return (
      <div className="group/node">
        <InlineInput
          defaultValue={inlineEdit!.value}
          placeholder="输入新名称"
          depth={depth}
          icon={<NodeIcon kind={node.kind} />}
          onSubmit={(newName) => onAction?.({ type: "rename", node, newName })}
          onCancel={() => onAction?.({ type: "rename", node, newName: "" })}
        />
      </div>
    );
  }

  if (!node.capabilities.open) {
    // ── 目录节点 ──
    const isCreatingHere = inlineEdit?.creatingInNodeId === node.id;
    const createInput = isCreatingHere ? (
      <InlineInput
        key="__creating"
        defaultValue=""
        placeholder={inlineEdit!.createMode === "folder" ? "文件夹名称" : "文件名（含扩展名）"}
        depth={depth + 1}
        icon={inlineEdit!.createMode === "folder"
          ? <FolderOpen className="size-3.5 text-muted-foreground" />
          : <FileText className="size-3.5 text-muted-foreground" />
        }
        onSubmit={(name) => {
          const actionType = inlineEdit!.createMode === "folder" ? "create-folder" : "create-file";
          onAction?.({ type: actionType as ResourceTreeAction["type"], node, name });
        }}
        onCancel={() => onAction?.({ type: inlineEdit!.createMode === "folder" ? "create-folder" : "create-file", node, name: "" })}
      />
    ) : null;

    return (
      <div>
        <div
          ref={itemRef as RefObject<HTMLDivElement>}
          className={`group/section flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer hover:bg-muted ${dropActive ? "bg-primary/10 ring-1 ring-primary/40" : ""} ${isCut ? "opacity-50" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          draggable={isDraggableNode(node)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => setExpanded(!expanded)}
          onContextMenu={handleContext}
        >
          {hasChildren ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="shrink-0 text-muted-foreground">
              {effectiveExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : <span className="w-3.5 shrink-0" />}
          <NodeIcon kind={node.kind} />
          <span className="truncate text-sm font-medium text-muted-foreground">{node.title}</span>
          {canCreate && (
            <button type="button" title={`新建${node.title}条目`}
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover/section:opacity-100 hover:bg-primary/10 hover:text-primary transition-all"
              onClick={(e) => { e.stopPropagation(); onAction!({ type: "create", node }); }}>
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        {effectiveExpanded && (hasChildren || isCreatingHere) && (
          <div>
            {createInput}
            {node.children!.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} onContextMenu={onContextMenu} onAction={onAction} draggedNode={draggedNode} onDragNode={onDragNode} cutNodeIds={cutNodeIds} forceExpanded={forceExpanded} inlineEdit={inlineEdit} />
            ))}
          </div>
        )}
        {effectiveExpanded && !hasChildren && !isCreatingHere && node.kind === "jingwei-section" && (
          <div className="pl-4 pr-2 py-2" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            <JingweiEmptyState sectionKind={node.kind} sectionTitle={node.title} onCreate={onAction ? () => onAction({ type: "create", node }) : undefined} />
          </div>
        )}
      </div>
    );
  }

  // Openable nodes — 纯 onClick,无 Radix 包裹
  return (
    <div className="group/node">
      <Button type="button" variant="ghost" size="sm"
        ref={itemRef as RefObject<HTMLButtonElement>}
        className={`w-full justify-start gap-1.5 rounded-md font-normal ${isSelected ? "bg-primary/10 text-primary hover:bg-primary/15" : ""} ${dropActive ? "bg-primary/10 ring-1 ring-primary/40" : ""} ${isCut ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable={isDraggableNode(node)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => onOpen(node)}
        onContextMenu={handleContext}
      >
        {hasChildren ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="shrink-0 text-muted-foreground">
            {effectiveExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : <span className="w-3.5 shrink-0" />}
        <NodeIcon kind={node.kind} />
        <span className="truncate text-sm">{node.title}</span>
        <CapabilityBadges node={node} />
      </Button>
      {expanded && hasChildren && (
        <div>{node.children!.map((child) => (
          <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} onContextMenu={onContextMenu} onAction={onAction} draggedNode={draggedNode} onDragNode={onDragNode} cutNodeIds={cutNodeIds} forceExpanded={forceExpanded} inlineEdit={inlineEdit} />
        ))}</div>
      )}
    </div>
  );
}

export function WorkbenchResourceTree({ nodes, selectedNodeId = null, onOpen, onAction, cutNodeIds = [], sortStorageKey = "novelfork:resource-tree-sort" }: WorkbenchResourceTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<ResourceTreeSortMode>(() => {
    const saved = typeof globalThis.localStorage?.getItem === "function" ? globalThis.localStorage.getItem(sortStorageKey) : null;
    return saved === "type" || saved === "modified" ? saved : "name";
  });
  const [draggedNode, setDraggedNode] = useState<WorkbenchResourceNode | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const visibleNodes = useMemo(() => filterNodesByQuery(sortNodes(nodes, sortMode), searchQuery), [nodes, searchQuery, sortMode]);
  const forceExpanded = searchQuery.trim().length > 0;
  useEffect(() => {
    const saved = typeof globalThis.localStorage?.getItem === "function" ? globalThis.localStorage.getItem(sortStorageKey) : null;
    setSortMode(saved === "type" || saved === "modified" ? saved : "name");
  }, [sortStorageKey]);
  const changeSortMode = useCallback((mode: ResourceTreeSortMode) => {
    setSortMode(mode);
    if (typeof globalThis.localStorage?.setItem === "function") globalThis.localStorage.setItem(sortStorageKey, mode);
  }, [sortStorageKey]);
  const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkbenchResourceNode) => {
    setMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // ── 内联编辑拦截：rename / create-file / create-folder 进入内联模式 ──
  const handleAction = useCallback((action: ResourceTreeAction) => {
    if (action.type === "rename") {
      if (action.newName !== undefined) {
        // 用户已提交或取消（空字符串 = 取消）
        setInlineEdit(null);
        if (action.newName) onAction?.(action);
      } else {
        // 进入内联重命名模式
        setInlineEdit({ renamingNodeId: action.node.id, creatingInNodeId: null, createMode: null, value: action.node.title });
      }
      return;
    }
    if (action.type === "create-file" || action.type === "create-folder") {
      if (action.name !== undefined) {
        // 用户已提交或取消
        setInlineEdit(null);
        if (action.name) onAction?.(action);
      } else {
        // 进入内联新建模式
        const createMode = action.type === "create-folder" ? "folder" : "file";
        setInlineEdit({ renamingNodeId: null, creatingInNodeId: action.node.id, createMode, value: "" });
      }
      return;
    }
    // 其他 action 直接转发
    onAction?.(action);
  }, [onAction]);

  return (
    <nav aria-label="写作资源树" className="space-y-1 relative">
      <div className="flex gap-1 px-2 pb-1">
        <input
          aria-label="搜索文件树"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setSearchQuery(""); }}
          placeholder="搜索文件..."
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary"
        />
        <select
          aria-label="文件树排序"
          value={sortMode}
          onChange={(event) => changeSortMode(event.currentTarget.value as ResourceTreeSortMode)}
          className="h-7 rounded border border-border bg-background px-1 text-[11px] outline-none"
        >
          <option value="name">名称</option>
          <option value="type">类型</option>
          <option value="modified">时间</option>
        </select>
      </div>
      {visibleNodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} selectedNodeId={selectedNodeId} onOpen={onOpen} onContextMenu={onAction ? handleContextMenu : undefined} onAction={handleAction} draggedNode={draggedNode} onDragNode={setDraggedNode} cutNodeIds={cutNodeIds} forceExpanded={forceExpanded} inlineEdit={inlineEdit} />
      ))}
      {visibleNodes.length === 0 && searchQuery.trim() ? <div className="px-3 py-4 text-center text-xs text-muted-foreground">无匹配文件</div> : null}
      {menu && onAction && <FloatingMenu state={menu} onAction={handleAction} onClose={() => setMenu(null)} />}
    </nav>
  );
}
