import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, FileText, BookOpen, Scroll, Globe, Sparkles, Layers, PenLine, BookMarked, Route, FolderOpen, Plus, Pencil, Trash2 } from "lucide-react";
import type { WorkbenchResourceNode, WorkbenchResourceKind } from "./useWorkbenchResources";
import { JingweiEmptyState } from "./JingweiEmptyState";

export interface ResourceTreeAction {
  type: "create" | "rename" | "delete";
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
    case "book":
      return <BookOpen className="size-4 text-primary" />;
    case "group":
      return <FolderOpen className="size-4 text-muted-foreground" />;
    case "chapter":
      return <FileText className="size-4 text-blue-500" />;
    case "jingwei":
      return <Scroll className="size-4 text-amber-500" />;
    case "story":
      return <Globe className="size-4 text-green-500" />;
    case "candidate":
      return <PenLine className="size-4 text-violet-500" />;
    case "draft":
      return <Layers className="size-4 text-orange-500" />;
    case "jingwei-section":
    case "jingwei-entry":
      return <BookMarked className="size-4 text-teal-500" />;
    case "narrative-line":
      return <Route className="size-4 text-rose-500" />;
    default:
      return <Sparkles className="size-4 text-muted-foreground" />;
  }
}

/** Sections that support creating new child entries */
const CREATABLE_KINDS: Set<WorkbenchResourceKind> = new Set(["jingwei-section", "group"]);

function CapabilityBadges({ node }: { node: WorkbenchResourceNode }) {
  if (!node.capabilities.open) return null;

  return (
    <span className="ml-auto flex items-center gap-1 opacity-0 group-hover/node:opacity-100 transition-opacity">
      {node.capabilities.edit ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">编辑</Badge> : null}
      {node.capabilities.readonly ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">只读</Badge> : null}
      {node.capabilities.delete ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">删除</Badge> : null}
    </span>
  );
}

/* ─── Context Menu ─── */

interface ContextMenuState {
  x: number;
  y: number;
  node: WorkbenchResourceNode;
}

function ContextMenu({ state, onAction, onClose }: { state: ContextMenuState; onAction: (action: ResourceTreeAction) => void; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);

  const items: { label: string; icon: React.ReactNode; action: ResourceTreeAction["type"]; show: boolean }[] = [
    { label: "重命名", icon: <Pencil className="size-3.5" />, action: "rename", show: state.node.capabilities.edit },
    { label: "删除", icon: <Trash2 className="size-3.5" />, action: "delete", show: state.node.capabilities.delete },
  ];

  const visibleItems = items.filter((i) => i.show);
  if (visibleItems.length === 0) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        style={{ left: state.x, top: state.y }}
      >
        {visibleItems.map((item) => (
          <button
            key={item.action}
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => { onAction({ type: item.action, node: state.node }); onClose(); }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ─── Tree Node ─── */

interface TreeNodeProps {
  node: WorkbenchResourceNode;
  depth: number;
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  onContextMenu?: (e: React.MouseEvent, node: WorkbenchResourceNode) => void;
}

function TreeNode({ node, depth, selectedNodeId, onOpen, onAction, onContextMenu }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = node.id === selectedNodeId;
  const canCreate = CREATABLE_KINDS.has(node.kind) && onAction;

  if (!node.capabilities.open) {
    // Non-openable nodes (groups, book root) render as section headers
    return (
      <div>
        <div
          className="group/section flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer hover:bg-muted"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, node); } }}
        >
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="shrink-0 text-muted-foreground"
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          )}
          {!hasChildren && <span className="w-3.5 shrink-0" />}
          <NodeIcon kind={node.kind} />
          <span className="truncate text-sm font-medium text-muted-foreground">{node.title}</span>
          {/* "+" button for creatable sections */}
          {canCreate && (
            <button
              type="button"
              title={`新建${node.title}条目`}
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover/section:opacity-100 hover:bg-primary/10 hover:text-primary transition-all"
              onClick={(e) => { e.stopPropagation(); onAction({ type: "create", node }); }}
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        {expanded && hasChildren && (
          <div>
            {node.children!.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} onAction={onAction} onContextMenu={onContextMenu} />
            ))}
          </div>
        )}
        {expanded && !hasChildren && node.kind === "jingwei-section" && (
          <div className="pl-4 pr-2 py-2" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            <JingweiEmptyState
              sectionKind={node.kind}
              sectionTitle={node.title}
              onCreate={onAction ? () => onAction({ type: "create", node }) : undefined}
            />
          </div>
        )}
      </div>
    );
  }

  // Openable nodes render as interactive buttons
  return (
    <div className="group/node">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`w-full justify-start gap-1.5 rounded-md font-normal ${isSelected ? "bg-primary/10 text-primary hover:bg-primary/15" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onOpen(node)}
        onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, node); } }}
      >
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 text-muted-foreground"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        )}
        {!hasChildren && <span className="w-3.5 shrink-0" />}
        <NodeIcon kind={node.kind} />
        <span className="truncate text-sm">{node.title}</span>
        <CapabilityBadges node={node} />
      </Button>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} onAction={onAction} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkbenchResourceTree({ nodes, selectedNodeId = null, onOpen, onAction }: WorkbenchResourceTreeProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkbenchResourceNode) => {
    // Only show context menu for nodes that have editable/deletable capabilities
    if (!node.capabilities.edit && !node.capabilities.delete) return;
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleAction = useCallback((action: ResourceTreeAction) => {
    onAction?.(action);
  }, [onAction]);

  return (
    <nav aria-label="写作资源树" className="space-y-0.5 relative">
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} selectedNodeId={selectedNodeId} onOpen={onOpen} onAction={handleAction} onContextMenu={handleContextMenu} />
      ))}
      {contextMenu && onAction && (
        <ContextMenu state={contextMenu} onAction={handleAction} onClose={() => setContextMenu(null)} />
      )}
    </nav>
  );
}
