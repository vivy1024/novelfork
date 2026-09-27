/**
 * 故事树各张正图共用的 tidy-tree 画布（React Flow 引擎）。
 *
 * 坐标来自 layoutTidyTree（横向：根在左），折叠后只布局可见子树——排版仍由数据决定。
 * 画布交互与工作流画布、因果画布一致：滚轮缩放、拖空白平移、小地图、适应视图、
 * 只渲染视口内的节点；可以临时拖动节点看清局部，不保存（「复位布局」回到自动排版）。
 * 视口按「作品 + 视图」记住，下次打开回到原处；节点坐标不存。
 */

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, LayoutGrid, LocateFixed, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  collectDefaultExpanded,
  indexCanonicalTree,
  toLayoutInput,
  type CanonicalForest,
  type CanonicalTreeNode,
} from "../../engine/narrative-taxonomy/canonical-trees";
import { layoutTidyTree } from "../../engine/narrative-taxonomy/tidy-tree-layout";
import { readSavedViewport, saveViewport, type SavedViewport } from "./canvas-viewport";
import { useColorScheme } from "@/hooks/use-color-scheme";

export interface TidyTreeCanvasProps {
  readonly forest: CanonicalForest;
  readonly expanded: ReadonlySet<string>;
  readonly selectedId?: string | null;
  readonly matchedIds?: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (node: CanonicalTreeNode) => void;
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 视口记忆的键（如 `书id:视图`）；不给则每次打开都用默认视图。 */
  readonly viewportKey?: string;
  readonly className?: string;
}

export const TIDY_NODE_WIDTH = 168;
export const TIDY_NODE_HEIGHT = 32;
const PAD_X = 28;
const PAD_Y = 24;
const DEPTH_SPACING = 220;
const BREADTH_SPACING = 40;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.8;
/** 初始视图不缩到这以下：宁可平移也要字看得清。 */
const MIN_INITIAL_ZOOM = 0.6;
const ZOOM_STEP = 1.2;

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
  // 剧情线与卷同重；场景与章同色系但更淡。
  storyline: "color-mix(in oklch, var(--primary) 80%, transparent)",
  scene: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
};

/** 小地图画的是 SVG 属性，CSS 变量在那里不生效，用固定色。 */
const MINIMAP_STRONG = new Set<CanonicalTreeNode["kind"]>(["root", "group", "dimension", "volume", "storyline"]);

interface TreeNodeData {
  [key: string]: unknown;
  readonly node: CanonicalTreeNode;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly matched: boolean;
}

type TreeFlowNode = Node<TreeNodeData, "tree">;

interface TreeHandlers {
  toggle: (id: string) => void;
  activate: (node: CanonicalTreeNode) => void;
}

function nodeAction(node: CanonicalTreeNode, props: TidyTreeCanvasProps): void {
  props.onSelect(node);
  if ((node.kind === "entry" || node.kind === "entity" || node.kind === "character") && node.entryId && props.onOpenEntry) {
    props.onOpenEntry(node.entryId, node.label);
    return;
  }
  if ((node.kind === "chapter" || node.kind === "event") && node.chapterNumber && props.onOpenChapter) {
    props.onOpenChapter(node.chapterNumber);
  }
}

/**
 * 展开节点后，它的子节点是否需要平移进视口；需要时返回新的视口中心（画布坐标），缩放不变。
 * 只在子节点有一部分落在视口外时才动，避免作者每点一次展开画布就跳一下。
 */
export function revealTarget(
  boxes: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  viewport: SavedViewport,
  pane: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x)) + TIDY_NODE_WIDTH;
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y)) + TIDY_NODE_HEIGHT;
  const toScreenX = (x: number) => x * viewport.zoom + viewport.x;
  const toScreenY = (y: number) => y * viewport.zoom + viewport.y;
  const visible = toScreenX(left) >= 0 && toScreenX(right) <= pane.width && toScreenY(top) >= 0 && toScreenY(bottom) <= pane.height;
  if (visible) return null;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * 初始视口：缩放取「整棵树放得下」与 0.6–1 之间；放得下就居中，
 * 放不下则让根节点贴左、在竖直方向居中——先看到树从哪里长出来。
 */
export function initialTreeViewport(
  content: { readonly width: number; readonly height: number; readonly rootCenterY: number },
  pane: { readonly width: number; readonly height: number },
): SavedViewport {
  const fit = Math.min(pane.width / content.width, pane.height / content.height);
  const zoom = Math.min(1, Math.max(MIN_INITIAL_ZOOM, fit));
  const x = content.width * zoom <= pane.width ? (pane.width - content.width * zoom) / 2 : 0;
  const y = content.height * zoom <= pane.height
    ? (pane.height - content.height * zoom) / 2
    : pane.height / 2 - content.rootCenterY * zoom;
  return { x, y, zoom };
}

/** 节点组件拿不到画布的 props：展开 / 点选的处理函数经 context 下发，节点数据里不放函数。 */
const TreeHandlersContext = createContext<TreeHandlers | null>(null);

function TreeNodeView({ id, data, positionAbsoluteX, positionAbsoluteY }: NodeProps<TreeFlowNode>) {
  const { node, expanded, selected, matched } = data;
  const handlers = useContext(TreeHandlersContext);
  const hasChildren = node.children.length > 0;
  return (
    <div
      className={`relative flex items-center overflow-hidden rounded-md border bg-card shadow-sm ${selected ? "border-primary ring-1 ring-primary" : matched ? "border-amber-500/70 ring-1 ring-amber-400/60" : "border-border"}`}
      style={{ width: TIDY_NODE_WIDTH, height: TIDY_NODE_HEIGHT }}
      data-testid={`tidy-tree-row-${id}`}
      data-x={positionAbsoluteX.toFixed(1)}
      data-y={positionAbsoluteY.toFixed(1)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: KIND_FILL[node.kind] }} />
      {hasChildren ? (
        <button
          type="button"
          className="nodrag flex h-full w-6 shrink-0 items-center justify-center pl-1 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? `折叠 ${node.label}` : `展开 ${node.label}`}
          aria-expanded={expanded}
          data-testid={`tidy-tree-toggle-${id}`}
          onClick={(event) => {
            event.stopPropagation();
            handlers?.toggle(id);
          }}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      ) : null}
      <button
        type="button"
        className={`flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden pr-2 text-left ${hasChildren ? "" : "pl-2.5"}`}
        data-testid={`tidy-tree-node-${id}`}
        title={node.detail ?? node.label}
        onClick={(event) => {
          event.stopPropagation();
          handlers?.activate(node);
        }}
      >
        <span className="min-w-0 truncate text-2xs font-medium">{node.label}</span>
        {node.kind !== "entry" && node.kind !== "chapter" && node.kind !== "entity" && node.count > 0 ? (
          <span className="shrink-0 text-2xs text-muted-foreground">{` · ${node.count}`}</span>
        ) : null}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

const nodeTypes = { tree: memo(TreeNodeView) };

function Toolbar({ hasOffsets, onResetLayout }: { hasOffsets: boolean; onResetLayout: () => void }) {
  const { zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <Panel position="top-right" className="!m-2">
      <div className="flex items-center gap-1 rounded-md border bg-background/90 p-0.5 shadow-sm">
        <Button type="button" size="xs" variant="ghost" className="h-6 w-6 p-0" aria-label="缩小" data-testid="tidy-tree-zoom-out" onClick={() => void zoomTo(Math.max(MIN_ZOOM, zoom / ZOOM_STEP))}>
          <Minus className="size-3" />
        </Button>
        <span className="min-w-10 text-center text-2xs tabular-nums text-muted-foreground" data-testid="tidy-tree-zoom-label">
          {Math.round(zoom * 100)}%
        </span>
        <Button type="button" size="xs" variant="ghost" className="h-6 w-6 p-0" aria-label="放大" data-testid="tidy-tree-zoom-in" onClick={() => void zoomTo(Math.min(MAX_ZOOM, zoom * ZOOM_STEP))}>
          <Plus className="size-3" />
        </Button>
        <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5 text-2xs" aria-label="适应视图" title="整棵树放进视口" data-testid="tidy-tree-reset" onClick={() => void fitView({ padding: 0.1, maxZoom: 1, duration: 200 })}>
          <LocateFixed className="size-3" />
        </Button>
        {hasOffsets ? (
          <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5 text-2xs" aria-label="复位布局" title="拖动过的节点回到自动排版的位置" data-testid="tidy-tree-reset-layout" onClick={onResetLayout}>
            <LayoutGrid className="size-3" />
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/** 视口状态写到容器的 data-* 上：测试与排查时能直接读到当前缩放与平移。 */
function ViewportProbe({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const { x, y, zoom } = useViewport();
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    el.dataset.zoom = zoom.toFixed(2);
    el.dataset.panX = String(Math.round(x));
    el.dataset.panY = String(Math.round(y));
  }, [target, x, y, zoom]);
  return null;
}

function TidyTreeFlow(props: TidyTreeCanvasProps) {
  const { forest, expanded, selectedId, matchedIds, viewportKey, className } = props;
  const colorMode = useColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow<TreeFlowNode, Edge>();
  // 刚被展开的节点：排版更新后把它的子节点平移进视口。
  const revealRef = useRef<string | null>(null);
  const [saved] = useState(() => readSavedViewport(viewportKey));
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const index = useMemo(() => indexCanonicalTree(forest.root), [forest]);

  const propsRef = useRef(props);
  propsRef.current = props;
  const handlers = useMemo<TreeHandlers>(() => ({
    toggle: (id) => {
      if (!propsRef.current.expanded.has(id)) revealRef.current = id;
      propsRef.current.onToggle(id);
    },
    activate: (node) => nodeAction(node, propsRef.current),
  }), []);

  const layout = useMemo(() => {
    const effective = expanded.size > 0 ? expanded : collectDefaultExpanded(forest.root);
    return layoutTidyTree(toLayoutInput(forest.root, effective), { depthSpacing: DEPTH_SPACING, breadthSpacing: BREADTH_SPACING });
  }, [forest, expanded]);
  const [minBreadth, maxBreadth] = layout.breadthExtent;

  const basePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const point of layout.points.values()) {
      positions.set(point.id, { x: point.depthCoord + PAD_X, y: point.breadthCoord - minBreadth + PAD_Y });
    }
    return positions;
  }, [layout, minBreadth]);

  const derivedNodes = useMemo<TreeFlowNode[]>(() => [...basePositions.entries()].flatMap(([id, base]) => {
    const node = index.get(id);
    if (!node) return [];
    const offset = offsets[id];
    return [{
      id,
      type: "tree" as const,
      position: offset ? { x: base.x + offset.x, y: base.y + offset.y } : base,
      connectable: false,
      selectable: false,
      data: {
        node,
        expanded: expanded.has(id),
        selected: selectedId === id,
        matched: Boolean(matchedIds?.has(id)),
      },
    }];
  }), [basePositions, index, offsets, expanded, selectedId, matchedIds]);

  const edges = useMemo<Edge[]>(() => layout.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    selectable: false,
    focusable: false,
    style: { stroke: "var(--muted-foreground)", strokeOpacity: 0.4, strokeWidth: 1.2 },
  })), [layout]);

  const [nodes, setNodes] = useState(derivedNodes);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);

  useEffect(() => {
    const id = revealRef.current;
    if (!id) return;
    revealRef.current = null;
    const children = index.get(id)?.children ?? [];
    const boxes = children.flatMap((child) => {
      const base = basePositions.get(child.id);
      if (!base) return [];
      const offset = offsets[child.id];
      return [offset ? { x: base.x + offset.x, y: base.y + offset.y } : base];
    });
    const pane = containerRef.current?.getBoundingClientRect();
    if (!pane || pane.width === 0) return;
    const viewport = flow.getViewport();
    const target = revealTarget(boxes, viewport, { width: pane.width, height: pane.height });
    if (target) void flow.setCenter(target.x, target.y, { zoom: viewport.zoom, duration: 250 });
  }, [basePositions, index, offsets, flow]);
  const onNodesChange = useCallback((changes: NodeChange<TreeFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== "remove"), current));
  }, []);

  const rootBase = basePositions.get(forest.root.id);
  const contentWidth = Math.max(320, layout.maxDepth * DEPTH_SPACING + TIDY_NODE_WIDTH + PAD_X * 2);
  const contentHeight = Math.max(160, maxBreadth - minBreadth + TIDY_NODE_HEIGHT + PAD_Y * 2);

  return (
    <div
      ref={containerRef}
      // React Flow 的内容是绝对定位的，撑不开高度：画布必须自己填满父容器。
      className={`relative h-full min-h-[16rem] w-full overflow-hidden ${className ?? ""}`}
      data-testid="tidy-tree-canvas"
      data-kind={forest.kind}
      aria-label={forest.root.label}
    >
      <TreeHandlersContext.Provider value={handlers}>
      <ReactFlow<TreeFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => {
          const base = basePositions.get(node.id);
          if (!base) return;
          setOffsets((current) => ({ ...current, [node.id]: { x: node.position.x - base.x, y: node.position.y - base.y } }));
        }}
        onInit={(instance) => {
          if (saved) return;
          const pane = containerRef.current?.getBoundingClientRect();
          if (!pane || pane.width === 0 || pane.height === 0) return;
          void instance.setViewport(initialTreeViewport(
            { width: contentWidth, height: contentHeight, rootCenterY: (rootBase?.y ?? 0) + TIDY_NODE_HEIGHT / 2 },
            { width: pane.width, height: pane.height },
          ));
        }}
        onMoveEnd={(_, viewport) => saveViewport(viewportKey, viewport)}
        {...(saved ? { defaultViewport: saved } : {})}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        colorMode={colorMode}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          style={{ width: 140, height: 90 }}
          nodeColor={(node) => (MINIMAP_STRONG.has((node.data as TreeNodeData).node.kind) ? "#6366f1" : "#94a3b8")}
        />
        <Toolbar hasOffsets={Object.keys(offsets).length > 0} onResetLayout={() => setOffsets({})} />
        <ViewportProbe target={containerRef} />
      </ReactFlow>
      </TreeHandlersContext.Provider>
    </div>
  );
}

export function TidyTreeCanvas(props: TidyTreeCanvasProps) {
  if (props.forest.root.children.length === 0) {
    return (
      <div
        className={`flex h-full min-h-[12rem] flex-col items-center justify-center gap-1 p-6 text-center ${props.className ?? ""}`}
        data-testid="tidy-tree-empty"
        data-kind={props.forest.kind}
      >
        <p className="text-xs font-medium">这张图还是空的</p>
        <p className="max-w-sm text-2xs leading-relaxed text-muted-foreground">
          {props.forest.emptyReason ?? "没有可显示的节点。"}
        </p>
      </div>
    );
  }
  // 换一张树（或换一本书）就换一个画布实例：视口、临时拖动都从头开始。
  return (
    <ReactFlowProvider key={props.viewportKey ?? `${props.forest.kind}:${props.forest.root.id}`}>
      <TidyTreeFlow {...props} />
    </ReactFlowProvider>
  );
}

export default TidyTreeCanvas;
