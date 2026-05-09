import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, FileText, BookOpen, Scroll, Globe, Sparkles, Layers, PenLine, BookMarked, Route } from "lucide-react";
import type { WorkbenchResourceNode, WorkbenchResourceKind } from "./useWorkbenchResources";

export interface WorkbenchResourceTreeProps {
  nodes: readonly WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
}

function NodeIcon({ kind }: { kind: WorkbenchResourceKind }) {
  switch (kind) {
    case "book":
      return <BookOpen className="size-4 text-primary" />;
    case "chapter":
      return <FileText className="size-4 text-blue-500" />;
    case "truth":
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

function CapabilityBadges({ node }: { node: WorkbenchResourceNode }) {
  if (!node.capabilities.open) return null;

  return (
    <span className="ml-auto flex items-center gap-1">
      {node.capabilities.edit ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">可编辑</Badge> : null}
      {node.capabilities.readonly ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">只读</Badge> : null}
      {node.capabilities.unsupported ? <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">不支持</Badge> : null}
      {node.capabilities.delete ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">可删除</Badge> : null}
      {node.capabilities.apply ? <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">可应用</Badge> : null}
    </span>
  );
}

interface TreeNodeProps {
  node: WorkbenchResourceNode;
  depth: number;
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
}

function TreeNode({ node, depth, selectedNodeId, onOpen }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = node.id === selectedNodeId;

  if (!node.capabilities.open) {
    // Non-openable nodes (groups, book root) render as section headers
    return (
      <div>
        <div
          className="flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer hover:bg-muted"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
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
        </div>
        {expanded && hasChildren && (
          <div>
            {node.children!.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Openable nodes render as interactive buttons
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`w-full justify-start gap-1.5 rounded-md font-normal ${isSelected ? "bg-primary/10 text-primary hover:bg-primary/15" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onOpen(node)}
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
            <TreeNode key={child.id} node={child} depth={depth + 1} selectedNodeId={selectedNodeId} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkbenchResourceTree({ nodes, selectedNodeId = null, onOpen }: WorkbenchResourceTreeProps) {
  return (
    <nav aria-label="写作资源树" className="space-y-0.5">
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} selectedNodeId={selectedNodeId} onOpen={onOpen} />
      ))}
    </nav>
  );
}
