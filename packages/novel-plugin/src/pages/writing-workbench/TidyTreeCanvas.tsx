/**
 * 四张正图共用的 tidy-tree 画布。
 *
 * 坐标来自 layoutTidyTree（横向：根在左）。折叠后只布局可见子树，
 * 所以长书不会一次把所有叶子铺开。
 */

import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  collectDefaultExpanded,
  indexCanonicalTree,
  toLayoutInput,
  type CanonicalForest,
  type CanonicalTreeNode,
} from "../../engine/narrative-taxonomy/canonical-trees";
import { layoutTidyTree } from "../../engine/narrative-taxonomy/tidy-tree-layout";

export interface TidyTreeCanvasProps {
  readonly forest: CanonicalForest;
  readonly expanded: ReadonlySet<string>;
  readonly selectedId?: string | null;
  readonly matchedIds?: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (node: CanonicalTreeNode) => void;
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly className?: string;
}

const NODE_WIDTH = 168;
const NODE_HEIGHT = 32;
const PAD_X = 28;
const PAD_Y = 24;
const DEPTH_SPACING = 220;
const BREADTH_SPACING = 40;

const KIND_FILL: Record<CanonicalTreeNode["kind"], string> = {
  root: "var(--primary)",
  group: "var(--primary)",
  dimension: "var(--primary)",
  feature: "color-mix(in oklch, var(--primary) 70%, transparent)",
  category: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
  volume: "color-mix(in oklch, var(--primary) 80%, transparent)",
  chapter: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
  beat: "color-mix(in oklch, var(--muted-foreground) 40%, transparent)",
  entity: "color-mix(in oklch, var(--primary) 75%, transparent)",
  entry: "color-mix(in oklch, var(--muted-foreground) 50%, transparent)",
  event: "color-mix(in oklch, var(--muted-foreground) 60%, transparent)",
  character: "color-mix(in oklch, var(--primary) 65%, transparent)",
};

function nodeAction(node: CanonicalTreeNode, props: TidyTreeCanvasProps): void {
  props.onSelect(node);
  if (node.kind === "entry" && node.entryId && props.onOpenEntry) {
    props.onOpenEntry(node.entryId, node.label);
    return;
  }
  if ((node.kind === "entity" || node.kind === "character") && node.entryId && props.onOpenEntry) {
    props.onOpenEntry(node.entryId, node.label);
    return;
  }
  if ((node.kind === "chapter" || node.kind === "event") && node.chapterNumber && props.onOpenChapter) {
    props.onOpenChapter(node.chapterNumber);
  }
}

export function TidyTreeCanvas(props: TidyTreeCanvasProps) {
  const { forest, expanded, selectedId, matchedIds, onToggle, className } = props;
  const index = useMemo(() => indexCanonicalTree(forest.root), [forest]);

  const layout = useMemo(() => {
    const effective = expanded.size > 0 ? expanded : collectDefaultExpanded(forest.root);
    return layoutTidyTree(toLayoutInput(forest.root, effective), {
      depthSpacing: DEPTH_SPACING,
      breadthSpacing: BREADTH_SPACING,
    });
  }, [forest, expanded]);

  const [minBreadth, maxBreadth] = layout.breadthExtent;
  const width = Math.max(320, layout.maxDepth * DEPTH_SPACING + NODE_WIDTH + PAD_X * 2);
  const height = Math.max(160, (maxBreadth - minBreadth) + NODE_HEIGHT + PAD_Y * 2);

  const placed = useMemo(() => {
    return [...layout.points.values()].flatMap((point) => {
      const node = index.get(point.id);
      if (!node) return [];
      return [{
        node,
        x: point.depthCoord + PAD_X,
        y: point.breadthCoord - minBreadth + PAD_Y,
      }];
    });
  }, [index, layout, minBreadth]);

  const byId = useMemo(() => new Map(placed.map((item) => [item.node.id, item])), [placed]);

  if (forest.root.children.length === 0) {
    return (
      <div
        className={`flex h-full min-h-[12rem] flex-col items-center justify-center gap-1 p-6 text-center ${className ?? ""}`}
        data-testid="tidy-tree-empty"
        data-kind={forest.kind}
      >
        <p className="text-xs font-medium">这张图还是空的</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
          {forest.emptyReason ?? "没有可显示的节点。"}
        </p>
      </div>
    );
  }

  return (
    <div className={`min-h-0 flex-1 overflow-auto ${className ?? ""}`} data-testid="tidy-tree-canvas" data-kind={forest.kind}>
      <svg
        role="tree"
        aria-label={forest.root.label}
        width={width}
        height={height}
        className="block"
      >
        {layout.edges.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.28}
              strokeWidth={1.2}
            />
          );
        })}
        {placed.map(({ node, x, y }) => {
          const hasChildren = node.children.length > 0;
          const isExpanded = expanded.has(node.id);
          const selected = selectedId === node.id;
          const matched = Boolean(matchedIds?.has(node.id));
          return (
            <g key={node.id} transform={`translate(${x} ${y})`} data-testid={`tidy-tree-row-${node.id}`}>
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                className={selected ? "stroke-primary" : matched ? "stroke-amber-500/70" : "stroke-border"}
                fill="var(--card)"
                strokeWidth={selected || matched ? 1.6 : 1}
              />
              <rect width={3} height={NODE_HEIGHT} rx={1.5} fill={KIND_FILL[node.kind]} />
              {hasChildren ? (
                <foreignObject x={4} y={4} width={20} height={24}>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center text-muted-foreground hover:text-foreground"
                    style={{ width: "100%", height: "100%" }}
                    aria-label={isExpanded ? `折叠 ${node.label}` : `展开 ${node.label}`}
                    aria-expanded={isExpanded}
                    data-testid={`tidy-tree-toggle-${node.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(node.id);
                    }}
                  >
                    {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                </foreignObject>
              ) : null}
              <foreignObject x={hasChildren ? 24 : 10} y={1} width={NODE_WIDTH - (hasChildren ? 28 : 14)} height={NODE_HEIGHT - 2}>
                <button
                  type="button"
                  className="flex h-full w-full items-center gap-1 overflow-hidden text-left"
                  style={{ width: "100%", height: "100%" }}
                  data-testid={`tidy-tree-node-${node.id}`}
                  title={node.detail ?? node.label}
                  onClick={() => nodeAction(node, props)}
                >
                  <span className="min-w-0 truncate text-[11px] font-medium">{node.label}</span>
                  {node.kind !== "entry" && node.kind !== "chapter" && node.kind !== "entity" && node.count > 0 ? (
                    <span className="shrink-0 text-[9px] text-muted-foreground">{` · ${node.count}`}</span>
                  ) : null}
                </button>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default TidyTreeCanvas;
