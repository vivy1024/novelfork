/**
 * BranchTree -- SVG/CSS tree visualization of snapshot branches.
 * Pure CSS + SVG lines, no external dependencies.
 */

import { useState, useMemo, useCallback } from "react";
import { BookmarkIcon, Sparkles, CheckIcon, GitBranch } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode {
  readonly id: number;
  readonly parentId: number | null;
  readonly createdAt: number;
  readonly triggerType: string;
  readonly description: string | null;
}

interface BranchTreeProps {
  readonly nodes: ReadonlyArray<TreeNode>;
  readonly activeNodeId?: number;
  readonly onNodeSelect: (snapshotId: number) => void;
  readonly onBranch: (snapshotId: number) => void;
}

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

interface LayoutNode {
  readonly node: TreeNode;
  readonly depth: number;
  readonly index: number;
  readonly children: ReadonlyArray<LayoutNode>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_STYLES: Record<string, { label: string; icon: React.ReactNode; border: string; bg: string; text: string }> = {
  manual:    { label: "手动", icon: <BookmarkIcon size={12} />, border: "border-blue-400/40",    bg: "bg-blue-500/10",    text: "text-blue-600" },
  before_ai: { label: "AI前", icon: <Sparkles size={12} />,    border: "border-amber-400/40",   bg: "bg-amber-500/10",   text: "text-amber-600" },
  after_ai:  { label: "AI后", icon: <CheckIcon size={12} />,   border: "border-emerald-400/40", bg: "bg-emerald-500/10", text: "text-emerald-600" },
  branch:    { label: "分支", icon: <GitBranch size={12} />,   border: "border-purple-400/40",  bg: "bg-purple-500/10",  text: "text-purple-600" },
};

const NODE_HEIGHT = 72;
const NODE_WIDTH = 240;
const DEPTH_OFFSET = 40;
const VERTICAL_GAP = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  const d = new Date(timestamp);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Build tree structure from flat node list. Returns root-level layout nodes. */
function buildTree(nodes: ReadonlyArray<TreeNode>): ReadonlyArray<LayoutNode> {
  const childrenMap = new Map<number | null, TreeNode[]>();

  for (const node of nodes) {
    const pid = node.parentId;
    const existing = childrenMap.get(pid);
    if (existing) {
      existing.push(node);
    } else {
      childrenMap.set(pid, [node]);
    }
  }

  let globalIndex = 0;

  function buildSubtree(parentId: number | null, depth: number): ReadonlyArray<LayoutNode> {
    const children = childrenMap.get(parentId) ?? [];
    // Sort by creation time ascending
    const sorted = [...children].sort((a, b) => a.createdAt - b.createdAt);

    const result: LayoutNode[] = [];
    for (const node of sorted) {
      const idx = globalIndex++;
      const subtreeChildren = depth < 4 ? buildSubtree(node.id!, depth + 1) : [];
      result.push({ node, depth, index: idx, children: subtreeChildren });
    }
    return result;
  }

  return buildSubtree(null, 0);
}

/** Flatten layout tree into rendering order with parent references. */
function flattenTree(roots: ReadonlyArray<LayoutNode>): ReadonlyArray<LayoutNode> {
  const result: LayoutNode[] = [];

  function walk(nodes: ReadonlyArray<LayoutNode>): void {
    for (const ln of nodes) {
      result.push(ln);
      walk(ln.children);
    }
  }

  walk(roots);
  return result;
}

// ---------------------------------------------------------------------------
// SVG Connector Lines
// ---------------------------------------------------------------------------

interface ConnectorProps {
  readonly flatNodes: ReadonlyArray<LayoutNode>;
  readonly nodePositions: ReadonlyMap<number, { x: number; y: number }>;
}

function ConnectorLines({ flatNodes, nodePositions }: ConnectorProps) {
  const paths: string[] = [];

  for (const ln of flatNodes) {
    if (ln.node.parentId == null) continue;
    const parentPos = nodePositions.get(ln.node.parentId);
    const childPos = nodePositions.get(ln.node.id!);
    if (!parentPos || !childPos) continue;

    const x1 = parentPos.x + NODE_WIDTH / 2;
    const y1 = parentPos.y + NODE_HEIGHT;
    const x2 = childPos.x + NODE_WIDTH / 2;
    const y2 = childPos.y;

    // Simple bezier curve
    const midY = (y1 + y2) / 2;
    paths.push(`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
  }

  if (paths.length === 0) return null;

  const allPositions = [...nodePositions.values()];
  const maxX = Math.max(...allPositions.map((p) => p.x)) + NODE_WIDTH + 20;
  const maxY = Math.max(...allPositions.map((p) => p.y)) + NODE_HEIGHT + 20;

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={maxX}
      height={maxY}
      style={{ zIndex: 0 }}
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          className="text-border"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Single Node Card
// ---------------------------------------------------------------------------

interface NodeCardProps {
  readonly node: TreeNode;
  readonly isActive: boolean;
  readonly x: number;
  readonly y: number;
  readonly onSelect: () => void;
  readonly onBranch: () => void;
}

function NodeCard({ node, isActive, x, y, onSelect, onBranch }: NodeCardProps) {
  const [hovered, setHovered] = useState(false);
  const style = TRIGGER_STYLES[node.triggerType] ?? TRIGGER_STYLES.manual;

  return (
    <div
      className={`absolute group cursor-pointer transition-all duration-150 ${isActive ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
      style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT, zIndex: 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        className={`w-full h-full rounded-lg border px-3 py-2 text-left transition-colors ${style.border} ${isActive ? style.bg : "bg-card hover:bg-secondary/50"}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${style.bg} ${style.text}`}>
            {style.icon}
            {style.label}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {formatRelativeTime(node.createdAt)}
          </span>
        </div>
        <p className="text-xs text-foreground truncate leading-snug">
          {node.description || "未命名快照"}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          #{node.id}
        </p>
      </button>

      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onBranch(); }}
          className="absolute -right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[10px] font-medium bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition-colors whitespace-nowrap z-10"
        >
          创建分支
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BranchTree
// ---------------------------------------------------------------------------

export function BranchTree({ nodes, activeNodeId, onNodeSelect, onBranch }: BranchTreeProps) {
  const treeRoots = useMemo(() => buildTree(nodes), [nodes]);
  const flatNodes = useMemo(() => flattenTree(treeRoots), [treeRoots]);

  /** Compute x/y positions for each node. */
  const nodePositions = useMemo(() => {
    const positions = new Map<number, { x: number; y: number }>();

    // For nodes with no branches (linear history), stack vertically
    // For branches, offset by depth on x-axis
    let currentY = 8;

    for (const ln of flatNodes) {
      const x = 8 + ln.depth * DEPTH_OFFSET;
      positions.set(ln.node.id!, { x, y: currentY });
      currentY += NODE_HEIGHT + VERTICAL_GAP;
    }

    return positions;
  }, [flatNodes]);

  const handleNodeSelect = useCallback(
    (id: number) => onNodeSelect(id),
    [onNodeSelect],
  );

  const handleBranch = useCallback(
    (id: number) => onBranch(id),
    [onBranch],
  );

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <GitBranch size={24} className="mb-2 opacity-40" />
        <span className="text-xs">暂无快照数据</span>
      </div>
    );
  }

  // Calculate total canvas size
  const allPositions = [...nodePositions.values()];
  const canvasWidth = Math.max(...allPositions.map((p) => p.x)) + NODE_WIDTH + 40;
  const canvasHeight = Math.max(...allPositions.map((p) => p.y)) + NODE_HEIGHT + 20;

  return (
    <div className="relative overflow-auto" style={{ minHeight: canvasHeight, minWidth: canvasWidth }}>
      <ConnectorLines flatNodes={flatNodes} nodePositions={nodePositions} />
      {flatNodes.map((ln) => {
        const pos = nodePositions.get(ln.node.id!);
        if (!pos) return null;
        return (
          <NodeCard
            key={ln.node.id}
            node={ln.node}
            isActive={ln.node.id === activeNodeId}
            x={pos.x}
            y={pos.y}
            onSelect={() => handleNodeSelect(ln.node.id!)}
            onBranch={() => handleBranch(ln.node.id!)}
          />
        );
      })}
    </div>
  );
}
