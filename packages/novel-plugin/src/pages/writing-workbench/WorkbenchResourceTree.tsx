import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, FileText, BookOpen, Scroll, Globe, Sparkles, Layers, PenLine, BookMarked, Route, FolderOpen, Plus, Wrench } from "lucide-react";
import type { WorkbenchResourceNode, WorkbenchResourceKind } from "./useWorkbenchResources";
import { JingweiEmptyState } from "./JingweiEmptyState";

export interface ResourceTreeAction {
  type: "create" | "create-file" | "create-folder" | "rename" | "delete" | "open-side";
  node: WorkbenchResourceNode;
}

export interface WorkbenchResourceTreeProps {
  nodes: readonly WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
}

function NodeIcon({ kind }: { kind: WorkbenchResourceKind }) {
  switch (kind) {
    case "book": return <BookOpen className="size-4 text-primary" />;
    case "group": return <FolderOpen className="size-4 text-muted-foreground" />;
    case "chapter": return <FileText className="size-4 text-blue-500" />;
    case "jingwei": return <Scroll className="size-4 text-amber-500" />;
    case "story": return <Globe className="size-4 text-green-500" />;
    case "candidate": return <PenLine className="size-4 text-violet-500" />;
    case "draft": return <Layers className="size-4 text-orange-500" />;
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

/* ─── 原生右键菜单(不用 Radix,纯 DOM 定位) ─── */

function getMenuItems(node: WorkbenchResourceNode): { label: string; action: ResourceTreeAction["type"] }[] {
  const isDir = node.metadata?.isDirectory === true;
  if (node.kind === "jingwei-section") return [{ label: "新建条目", action: "create" }];
  if (node.kind === "jingwei-entry") {
    const items: { label: string; action: ResourceTreeAction["type"] }[] = [{ label: "在侧边打开", action: "open-side" }];
    if (node.capabilities.edit) items.push({ label: "重命名", action: "rename" });
    if (node.capabilities.delete) items.push({ label: "删除", action: "delete" });
    return items;
  }
  if (isDir) {
    return [
      { label: "新建文件", action: "create-file" },
      { label: "新建文件夹", action: "create-folder" },
      { label: "在侧边打开", action: "open-side" },
      ...(node.capabilities.edit ? [{ label: "重命名" as const, action: "rename" as const }] : []),
      ...(node.capabilities.delete ? [{ label: "删除" as const, action: "delete" as const }] : []),
    ];
  }
  return [
    { label: "在侧边打开", action: "open-side" },
    ...(node.capabilities.edit ? [{ label: "重命名" as const, action: "rename" as const }] : []),
    ...(node.capabilities.delete ? [{ label: "删除" as const, action: "delete" as const }] : []),
  ];
}

interface MenuState { x: number; y: number; node: WorkbenchResourceNode }

function FloatingMenu({ state, onAction, onClose }: { state: MenuState; onAction: (a: ResourceTreeAction) => void; onClose: () => void }) {
  const items = getMenuItems(state.node);
  if (items.length === 0) return null;
  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95" style={{ left: state.x, top: state.y }}>
        {items.map((item) => (
          <button key={item.action} type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => { onAction({ type: item.action, node: state.node }); onClose(); }}>
            {item.label}
          </button>
        ))}
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
}

function TreeNode({ node, depth, selectedNodeId, onOpen, onContextMenu, onAction }: TreeNodeProps) {
  const isFileDir = node.metadata?.isDirectory === true;
  const [expanded, setExpanded] = useState(!isFileDir);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = node.id === selectedNodeId;
  const canCreate = CREATABLE_KINDS.has(node.kind) && onAction;

  const handleContext = (e: React.MouseEvent) => {
    if (onContextMenu) { e.preventDefault(); onContextMenu(e, node); }
  };

  if (!node.capabilities.open) {
    return (
      <div>
        <div
          className="group/section flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer hover:bg-muted"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
          onContextMenu={handleContext}
        >
          {hasChildren ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="shrink-0 text-muted-foreground">
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
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
        {expanded && hasChildren && (
          <div>{node.children!.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} onContextMenu={onContextMenu} onAction={onAction} />
          ))}</div>
        )}
        {expanded && !hasChildren && node.kind === "jingwei-section" && (
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
        className={`w-full justify-start gap-1.5 rounded-md font-normal ${isSelected ? "bg-primary/10 text-primary hover:bg-primary/15" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onOpen(node)}
        onContextMenu={handleContext}
      >
        {hasChildren ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : <span className="w-3.5 shrink-0" />}
        <NodeIcon kind={node.kind} />
        <span className="truncate text-sm">{node.title}</span>
        <CapabilityBadges node={node} />
      </Button>
      {expanded && hasChildren && (
        <div>{node.children!.map((child) => (
          <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} onContextMenu={onContextMenu} onAction={onAction} />
        ))}</div>
      )}
    </div>
  );
}

export function WorkbenchResourceTree({ nodes, selectedNodeId = null, onOpen, onAction }: WorkbenchResourceTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkbenchResourceNode) => {
    setMenu({ x: e.clientX, y: e.clientY, node });
  }, []);
  const handleAction = useCallback((action: ResourceTreeAction) => { onAction?.(action); }, [onAction]);

  return (
    <nav aria-label="写作资源树" className="space-y-0.5 relative">
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} selectedNodeId={selectedNodeId} onOpen={onOpen} onContextMenu={onAction ? handleContextMenu : undefined} onAction={onAction} />
      ))}
      {menu && onAction && <FloatingMenu state={menu} onAction={handleAction} onClose={() => setMenu(null)} />}
    </nav>
  );
}
