import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  CircleHelp,
  Clock,
  Focus,
  GitBranch,
  Info,
  Loader2,
  Network,
  PanelRight,
  Radio,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  Swords,
  X,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import {
  buildNarrativeGraphModel,
  clampChapterStep,
  SEQUENCE_CHAPTER_STEP_DEFAULT,
  type GraphEdgeModel,
  type GraphNodeModel,
  type NarrativeEvent,
  type NarrativeFact,
  type NarrativeGraphModel,
  type NarrativeMemoryView,
  type SequenceLaneHeader,
  viewLabel,
} from "./narrative-memory-graph-model";

export type NarrativeMemoryGraphWorkspaceMode = "standard" | "development";
export type NarrativeMemoryGraphDataScope = "read";

export interface NarrativeMemoryGraphWorkspaceProps {
  bookId: string;
  initialView?: NarrativeMemoryView;
  /** standard 保持旧图谱页；development 仅呈现发展历程的五个固定主题。 */
  mode?: NarrativeMemoryGraphWorkspaceMode;
  /** 图谱只读数据源标识；复用既有 /graph 接口，不新增后端契约。 */
  dataScope?: NarrativeMemoryGraphDataScope;
  /** 最近一次 memory.read 关联的章节，用于标记当前写作锚点。 */
  currentChapter?: number;
  /** 外部锚点导航可将当前图谱限定到一个实体或章节。 */
  initialFocusEntity?: string;
  initialChapter?: number;
  onSelectNode?: (nodeId: string) => void;
  /** entryId 来自实体身份链；宿主可据此直跳角色卡，缺省回落实体详情抽屉。 */
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /** 来源章节回跳：宿主打开对应章节；节点没有 chapterNumber 时不显示按钮。 */
  onOpenChapter?: (chapterNumber: number) => void;
}

interface NarrativeGraphResponse {
  view?: NarrativeMemoryView;
  facts?: NarrativeFact[];
  events?: NarrativeEvent[];
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: NarrativeGraphResponse };

type ViewOption = { id: NarrativeMemoryView; label: string; icon: typeof Network; description: string };

const VIEW_OPTIONS: ReadonlyArray<ViewOption> = [
  { id: "relationship", label: "关系图", icon: Network, description: "实体与动态关系" },
  { id: "timeline", label: "时间线", icon: Clock, description: "按章节展开事件" },
  { id: "character_arc", label: "角色弧线", icon: GitBranch, description: "角色状态推进" },
  { id: "conflict", label: "矛盾地图", icon: Swords, description: "冲突两侧与风险" },
  { id: "event_chain", label: "事件链", icon: Route, description: "事件前后关系" },
  { id: "wave", label: "浪潮视图", icon: Radio, description: "从中心向外传播" },
];

/** 发展历程三层（F1 收敛）：角色轨迹由双螺旋编年史 B 链承担、结算流水并入事件流——各答一问不重叠。 */
const DEVELOPMENT_VIEW_OPTIONS: ReadonlyArray<ViewOption> = [
  { id: "timeline", label: "事件流层", icon: Clock, description: "按章节展开故事事件" },
  { id: "relationship", label: "关系演化层", icon: Network, description: "查看实体与动态关系" },
  { id: "conflict", label: "矛盾冲突层", icon: Swords, description: "冲突两侧与风险" },
];

const NODE_ACCENTS: Record<GraphNodeModel["kind"], string> = {
  entity: "border-primary/40 bg-primary/[0.07]",
  fact: "border-accent-foreground/30 bg-accent/45",
  event: "border-ring/40 bg-ring/[0.06]",
};

const NODE_BADGES: Record<GraphNodeModel["kind"], string> = {
  entity: "实体",
  fact: "状态",
  event: "事件",
};

const MINIMAP_COLORS: Record<GraphNodeModel["kind"], string> = {
  entity: "hsl(var(--primary))",
  fact: "hsl(var(--accent-foreground))",
  event: "hsl(var(--ring))",
};

/** 保证详情侧栏展开后，图谱主画布仍至少保留约 560px。 */
const INSPECTOR_SIDEBAR_MIN_CONTAINER_WIDTH = 860;

function graphErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.status) {
    return `图谱数据读取失败（HTTP ${cause.status}）。请刷新后重试。`;
  }
  return cause instanceof Error ? cause.message : "图谱数据读取失败，请刷新后重试。";
}

function isHighRisk(value: string | undefined): boolean {
  return value === "high" || value === "critical" || value === "高" || value === "严重";
}

function nodeSummary(node: GraphNodeModel): string {
  if (node.kind === "entity") return node.subtitle ?? "动态实体";
  if (node.kind === "event") return `第 ${node.chapterNumber ?? "—"} 章 · ${node.subtitle ?? "事件"}`;
  return `${node.subtitle ?? "状态"}${node.chapterNumber !== undefined ? ` · 第 ${node.chapterNumber} 章` : ""}`;
}

interface FlowNodeData {
  [key: string]: unknown;
  model?: GraphNodeModel;
  /** HEAD 竖线标记节点的载荷（仅 chapterHeadMarker 类型使用）。 */
  chapterMarker?: { chapterNumber: number; storyTime?: string; label?: string };
  /** 泳道行头节点载荷（仅 laneHeader 类型使用）。 */
  laneHeader?: SequenceLaneHeader;
  laneHidden?: boolean;
  muted: boolean;
  currentChapter?: number;
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  onToggleLane?: (lane: string) => void;
  onScrollToChapter?: (chapter: number) => void;
}

interface FlowEdgeData {
  [key: string]: unknown;
  model: GraphEdgeModel;
  showLabel: boolean;
  highlighted: boolean;
}

type FlowNode = Node<FlowNodeData>;
type FlowEdge = Edge<FlowEdgeData, "narrativeGraphEdge">;

function NarrativeGraphNode({ data, selected }: NodeProps<FlowNode>) {
  const node = data.model;
  if (!node) return null;
  const canOpen = node.kind === "entity" && Boolean(node.entityName && data.onOpenEntityDetail);
  const risk = isHighRisk(node.riskLevel);
  const isCurrentChapter = node.chapterNumber !== undefined && node.chapterNumber === data.currentChapter;
  return (
    <Card
      className={`group relative rounded-lg border px-3 py-2.5 shadow-sm motion-safe:transition-all motion-safe:duration-200 ${NODE_ACCENTS[node.kind]} ${
        selected ? "z-20 scale-[1.03] border-primary bg-primary/10 shadow-lg shadow-primary/10" : "motion-safe:hover:z-10 motion-safe:hover:-translate-y-0.5 hover:shadow-md"
      } ${data.muted ? "opacity-35 saturate-50" : "opacity-100"} ${risk ? "border-destructive/60 bg-destructive/[0.08]" : ""} ${isCurrentChapter ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : ""}`}
      style={{ width: node.width, minHeight: node.height }}
      data-slot="narrative-memory-graph-node"
      data-node-kind={node.kind}
      data-testid={`narrative-graph-node-${node.id}`}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-primary/60" />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-primary/60" />
      <div className="mb-1 flex items-center justify-between gap-2">
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
          {NODE_BADGES[node.kind]}
        </Badge>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {node.depth !== undefined ? <span>第 {node.depth} 层</span> : null}
          {node.chapterNumber !== undefined ? <span>第 {node.chapterNumber} 章</span> : null}
        </div>
      </div>
      <div className="line-clamp-2 text-[12px] font-semibold leading-5 text-foreground" title={node.title}>
        {node.displayTitle}
      </div>
      <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground" title={node.description ?? nodeSummary(node)}>
        {node.description ?? nodeSummary(node)}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
        <span className="truncate">{node.category ?? node.status ?? "动态数据"}</span>
        {node.confidence !== undefined ? <span className="shrink-0">置信 {node.confidence.toFixed(2)}</span> : null}
      </div>
      {canOpen ? (
        <button
          type="button"
          className="nodrag nopan mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary opacity-0 transition-opacity hover:underline group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            if (!node.entityName) return;
            // entryId 缺省时不显式传 undefined，保持回调旧契约（单参）。
            if (node.entryId) data.onOpenEntityDetail?.(node.entityName, node.entryId);
            else data.onOpenEntityDetail?.(node.entityName);
          }}
        >
          {node.entryId ? "打开关联条目卡" : "查看实体详情"} <ChevronRight className="size-3" />
        </button>
      ) : null}
    </Card>
  );
}

function edgeColor(edge: GraphEdgeModel): string {
  if (isHighRisk(edge.riskLevel)) return "hsl(var(--destructive))";
  if (edge.kind === "sequence") return "hsl(var(--ring))";
  if (edge.category === "relationship") return "hsl(var(--primary))";
  if (edge.category === "conflict") return "hsl(var(--destructive))";
  return "hsl(var(--muted-foreground))";
}

function NarrativeGraphEdge({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, selected }: EdgeProps<FlowEdge>) {
  const edge = data?.model;
  if (!edge) return null;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.22 });
  const color = edgeColor(edge);
  const highlighted = Boolean(selected || data.highlighted);
  return (
    <>
      <BaseEdge
        path={path}
        interactionWidth={24}
        style={{ stroke: color, strokeWidth: highlighted ? 2.5 : 1.5, opacity: highlighted ? 0.95 : 0.45, strokeDasharray: edge.kind === "sequence" ? "7 5" : undefined }}
      />
      {data.showLabel || highlighted ? (
        <EdgeLabelRenderer>
          <div
            data-slot="narrative-memory-graph-edge-label"
            className={`nodrag nopan pointer-events-none rounded-full border bg-background/90 px-1.5 py-0.5 text-[9px] shadow-sm ${highlighted ? "font-medium text-foreground" : "text-muted-foreground"}`}
            style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, color }}
          >
            {edge.displayLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const LANE_HEADER_WIDTH = 148;
const LANE_HEADER_HEIGHT = 36;

function LaneHeaderNode({ data }: NodeProps<FlowNode>) {
  const lane = data.laneHeader;
  if (!lane) return null;
  const hidden = Boolean(data.laneHidden);
  return (
    <button
      type="button"
      className={`nodrag nopan flex items-center gap-2 rounded-md border bg-card/90 px-2 py-1 shadow-sm backdrop-blur ${hidden ? "border-border/40 opacity-45" : "border-border/70"}`}
      data-testid={`narrative-graph-lane-header-${lane.name}`}
      aria-pressed={!hidden}
      title={hidden ? `显示「${lane.name}」泳道` : `隐藏「${lane.name}」泳道`}
      style={{ width: LANE_HEADER_WIDTH, minHeight: LANE_HEADER_HEIGHT }}
      onClick={(event) => {
        event.stopPropagation();
        data.onToggleLane?.(lane.name);
      }}
    >
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: lane.color }} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-foreground" title={lane.name}>{lane.name}</span>
      <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{lane.eventCount}</span>
    </button>
  );
}

const nodeTypes = { narrativeGraphNode: NarrativeGraphNode, chapterHeadMarker: ChapterHeadMarkerNode, laneHeader: LaneHeaderNode };
const edgeTypes = { narrativeGraphEdge: NarrativeGraphEdge };

/**
 * HEAD 竖线标记：贯穿当前章 x 坐标的半透明参考线 + 顶部「第 N 章 · 当前」标签。
 * 纯视觉元素：不可拖拽/选中/连线，不进小地图着色逻辑（fallback 已兜底）。
 */
function ChapterHeadMarkerNode({ data }: NodeProps<FlowNode>) {
  const marker = data.chapterMarker;
  if (!marker) return null;
  const extra = storyTimeLabel(marker);
  return (
    <button
      type="button"
      className="nodrag nopan relative h-full w-0.5 rounded-full bg-primary/30"
      data-testid="narrative-graph-head-marker"
      aria-label={`定位到第 ${marker.chapterNumber} 章`}
      onClick={(event) => {
        event.stopPropagation();
        data.onScrollToChapter?.(marker.chapterNumber);
      }}
    >
      <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
        ▼ 第 {marker.chapterNumber} 章{extra ? ` · ${extra}` : " · 当前"}
      </span>
    </button>
  );
}

/**
 * 当前章聚焦点：从图模型里找 currentChapter 的节点，返回其中心坐标与
 * HEAD 竖线的纵向覆盖范围（全图节点上下各留 120px 余量）。
 * sequence 布局下同章节点 x 一致，取任意一个即可；找不到返回 null（回退 fitView）。
 */
export interface ChapterFocus {
  readonly cx: number;
  readonly cy: number;
  readonly lineTop: number;
  readonly lineBottom: number;
}

export function findChapterFocus(model: NarrativeGraphModel, currentChapter: number | undefined): ChapterFocus | null {
  if (currentChapter === undefined) return null;
  const chapterNodes = model.nodes.filter((node) => node.chapterNumber === currentChapter && node.position);
  if (chapterNodes.length === 0) return null;
  return focusFromAnchor(model, chapterNodes[0]!);
}

export function findNodeFocus(model: NarrativeGraphModel, nodeId: string | null | undefined): ChapterFocus | null {
  if (!nodeId) return null;
  const anchor = model.nodes.find((node) => node.id === nodeId && node.position);
  if (!anchor) return null;
  return focusFromAnchor(model, anchor);
}

function focusFromAnchor(model: NarrativeGraphModel, anchor: GraphNodeModel): ChapterFocus | null {
  const width = anchor.width ?? 220;
  const height = anchor.height ?? 96;
  const withPosition = model.nodes.filter((node) => node.position);
  if (withPosition.length === 0) return null;
  const top = Math.min(...withPosition.map((node) => node.position.y));
  const bottom = Math.max(...withPosition.map((node) => node.position.y + (node.height ?? 96)));
  return {
    cx: anchor.position.x + width / 2,
    cy: anchor.position.y + height / 2,
    lineTop: top - 120,
    lineBottom: bottom + 120,
  };
}

export function storyTimeLabel(entry: { storyTime?: string; label?: string } | undefined): string | undefined {
  const value = entry?.storyTime?.trim() || entry?.label?.trim();
  return value || undefined;
}

function toFlowNodes(
  model: NarrativeGraphModel,
  selectedNodeId: string | null,
  currentChapter: number | undefined,
  onOpenEntityDetail: ((entity: string, entryId?: string) => void) | undefined,
  chapterFocus: ChapterFocus | null,
  options?: {
    hiddenLanes?: ReadonlySet<string>;
    onToggleLane?: (lane: string) => void;
    onScrollToChapter?: (chapter: number) => void;
    storyTimeByChapter?: ReadonlyMap<number, { storyTime?: string; label?: string }>;
  },
): FlowNode[] {
  const visible = new Set<string>();
  if (selectedNodeId) {
    visible.add(selectedNodeId);
    for (const edge of model.edges) {
      if (edge.source === selectedNodeId) visible.add(edge.target);
      if (edge.target === selectedNodeId) visible.add(edge.source);
    }
  }
  const flowNodes: FlowNode[] = model.nodes.map((node) => ({
    id: node.id,
    type: "narrativeGraphNode",
    position: node.position,
    draggable: true,
    selectable: true,
    data: { model: node, muted: Boolean(selectedNodeId && !visible.has(node.id)), currentChapter, onOpenEntityDetail },
  }));
  // HEAD 竖线垫底渲染：细参考线从最高节点上方 120px 贯穿到最低节点下方 120px。
  if (chapterFocus) {
    flowNodes.unshift({
      id: "chapter-head-marker",
      type: "chapterHeadMarker",
      position: { x: chapterFocus.cx, y: chapterFocus.lineTop },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      style: { width: 2, height: chapterFocus.lineBottom - chapterFocus.lineTop, zIndex: 0 },
      data: {
        muted: false,
        chapterMarker: {
          chapterNumber: currentChapter ?? 0,
          ...(options?.storyTimeByChapter?.get(currentChapter ?? 0) ?? {}),
        },
        onScrollToChapter: options?.onScrollToChapter,
      },
    });
  }
  // 泳道行头：只渲染当前可见泳道。隐藏的泳道由筛选条 chips 再打开。
  if (model.sequence) {
    const headerX = (model.sequence.originX ?? 220) - LANE_HEADER_WIDTH - 28;
    for (const lane of model.sequence.lanes) {
      flowNodes.push({
        id: `lane-header:${lane.name}`,
        type: "laneHeader",
        position: { x: headerX, y: lane.y - LANE_HEADER_HEIGHT / 2 },
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        style: { zIndex: 2 },
        data: {
          muted: false,
          laneHeader: lane,
          laneHidden: false,
          onToggleLane: options?.onToggleLane,
        },
      });
    }
  }
  return flowNodes;
}

function toFlowEdges(model: NarrativeGraphModel, selectedNodeId: string | null): FlowEdge[] {
  const connected = new Set<string>();
  if (selectedNodeId) {
    for (const edge of model.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) connected.add(edge.id);
    }
  }
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "narrativeGraphEdge",
    animated: edge.animated,
    selectable: true,
    data: {
      model: edge,
      showLabel: model.edges.length <= 24,
      highlighted: connected.has(edge.id),
    },
  }));
}

type AnchorDimension = "chapter" | "entity";

/**
 * anchor 是图谱右上角的线程导航视图：它不触发新的图谱类型或接口，
 * 只从当前已读取的图模型派生章节/角色锚点，把作者带回同一份动态数据。
 */
function GraphAnchorNavigator({
  model,
  currentChapter,
  onSelectChapter,
  onSelectEntity,
}: {
  model: NarrativeGraphModel;
  currentChapter?: number;
  onSelectChapter: (chapter: number) => void;
  onSelectEntity: (entity: string) => void;
}) {
  const [dimension, setDimension] = useState<AnchorDimension>("chapter");
  const chapters = useMemo(
    () => [...new Set(model.nodes.map((node) => node.chapterNumber).filter((chapter): chapter is number => chapter !== undefined))].sort((a, b) => a - b),
    [model.nodes],
  );
  const entities = useMemo(
    () => [...new Set(model.nodes.map((node) => node.entityName).filter((entity): entity is string => Boolean(entity)))].sort((a, b) => a.localeCompare(b)),
    [model.nodes],
  );

  return (
    <div
      data-slot="narrative-memory-graph-anchor"
      data-view="anchor"
      data-testid="narrative-memory-graph-anchor"
      className="mt-2 w-56 rounded-lg border border-border/80 bg-card/95 p-2 shadow-lg backdrop-blur"
    >
      <div className="mb-2 flex items-center gap-1 rounded-md bg-muted/60 p-0.5" aria-label="锚点导航维度">
        <Button
          type="button"
          variant={dimension === "chapter" ? "secondary" : "ghost"}
          size="sm"
          className="h-6 flex-1 px-2 text-[10px]"
          aria-pressed={dimension === "chapter"}
          onClick={() => setDimension("chapter")}
        >
          章节
        </Button>
        <Button
          type="button"
          variant={dimension === "entity" ? "secondary" : "ghost"}
          size="sm"
          className="h-6 flex-1 px-2 text-[10px]"
          aria-pressed={dimension === "entity"}
          onClick={() => setDimension("entity")}
        >
          角色
        </Button>
      </div>
      {dimension === "chapter" ? (
        chapters.length > 0 ? (
          <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto pr-0.5">
            {chapters.map((chapter) => (
              <Button
                key={chapter}
                type="button"
                variant={chapter === currentChapter ? "secondary" : "outline"}
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => onSelectChapter(chapter)}
              >
                第 {chapter} 章{chapter === currentChapter ? " · 当前" : ""}
              </Button>
            ))}
          </div>
        ) : <p className="py-1 text-[10px] text-muted-foreground">当前图谱没有章节锚点。</p>
      ) : entities.length > 0 ? (
        <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto pr-0.5">
          {entities.map((entity) => (
            <Button
              key={entity}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 justify-start truncate px-2 text-[10px]"
              title={`聚焦并查看 ${entity} 的详情`}
              onClick={() => onSelectEntity(entity)}
            >
              {entity}
            </Button>
          ))}
        </div>
      ) : <p className="py-1 text-[10px] text-muted-foreground">当前图谱没有角色锚点。</p>}
    </div>
  );
}

function GraphCanvas({
  model,
  selectedNodeId,
  currentChapter,
  onSelectNode,
  onAnchorChapter,
  onAnchorEntity,
  onOpenEntityDetail,
  onChapterStepWheel,
  onToggleLane,
  storyTimeByChapter,
  locateChapter,
  locateNodeId,
}: {
  model: NarrativeGraphModel;
  selectedNodeId: string | null;
  currentChapter?: number;
  onSelectNode: (nodeId: string) => void;
  onAnchorChapter: (chapter: number) => void;
  onAnchorEntity: (entity: string) => void;
  onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  onChapterStepWheel?: (deltaY: number) => void;
  onToggleLane?: (lane: string) => void;
  storyTimeByChapter?: ReadonlyMap<number, { storyTime?: string; label?: string }>;
  locateChapter?: number;
  locateNodeId?: string | null;
}) {
  const { fitView, setCenter } = useReactFlow<FlowNode, FlowEdge>();
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [anchorOpen, setAnchorOpen] = useState(false);
  const chapterFocus = useMemo(() => findChapterFocus(model, currentChapter), [model, currentChapter]);
  const nodes = useMemo(
    () => toFlowNodes(model, selectedNodeId, currentChapter, onOpenEntityDetail, chapterFocus, {
      onToggleLane,
      onScrollToChapter: onAnchorChapter,
      storyTimeByChapter,
    }),
    [chapterFocus, currentChapter, model, onAnchorChapter, onOpenEntityDetail, onToggleLane, selectedNodeId, storyTimeByChapter],
  );
  const edges = useMemo(() => toFlowEdges(model, selectedNodeId), [model, selectedNodeId]);

  const scrollToFocus = useCallback((focus: ChapterFocus | null) => {
    if (!focus) return false;
    void setCenter(focus.cx, focus.cy, { zoom: 0.85, duration: 400 });
    return true;
  }, [setCenter]);

  // 打开/切换视图时的初始定位：优先平滑居中到当前写作章（HEAD），找不到该章节点才回退全图 fitView。
  const resetViewport = useCallback(() => {
    if (scrollToFocus(chapterFocus)) return;
    void fitView({ padding: 0.18, duration: 250 });
  }, [chapterFocus, fitView, scrollToFocus]);

  useEffect(() => {
    const frame = requestAnimationFrame(resetViewport);
    return () => cancelAnimationFrame(frame);
  }, [model, resetViewport]);

  useEffect(() => {
    if (locateChapter === undefined) return;
    const frame = requestAnimationFrame(() => {
      if (!scrollToFocus(findChapterFocus(model, locateChapter))) {
        void fitView({ padding: 0.18, duration: 250 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, locateChapter, model, scrollToFocus]);

  useEffect(() => {
    if (!locateNodeId) return;
    const frame = requestAnimationFrame(() => {
      scrollToFocus(findNodeFocus(model, locateNodeId));
    });
    return () => cancelAnimationFrame(frame);
  }, [locateNodeId, model, scrollToFocus]);

  // 时间线滚轮改章距：必须挂原生非 passive listener，React 合成 onWheel 无法 preventDefault。
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || !onChapterStepWheel) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onChapterStepWheel(event.deltaY);
    };
    host.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => host.removeEventListener("wheel", onWheel, { capture: true });
  }, [onChapterStepWheel]);

  return (
    <div ref={canvasHostRef} className="h-full w-full">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => {
        if (node.id === "chapter-head-marker" || node.id.startsWith("lane-header:")) return;
        onSelectNode(node.id);
      }}
      onPaneClick={() => onSelectNode("")}
      minZoom={0.16}
      maxZoom={2.4}
      nodesDraggable={true}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      zoomOnScroll={!onChapterStepWheel}
      zoomOnPinch={!onChapterStepWheel}
      data-zoom-on-scroll={onChapterStepWheel ? "false" : "true"}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
      defaultEdgeOptions={{ type: "narrativeGraphEdge" }}
      data-slot="narrative-memory-graph-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="hsl(var(--border))" />
      <Controls showInteractive={false} className="!overflow-hidden !rounded-lg !border-border !bg-card !shadow-md" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const data = node.data as FlowNodeData | undefined;
          const kind = data?.model?.kind;
          return kind ? MINIMAP_COLORS[kind] : "hsl(var(--muted-foreground))";
        }}
        className="!bottom-4 !right-4 !rounded-lg !border-border !bg-card/90 !shadow-md"
      />
      <Panel position="top-left" className="!m-4">
        <div className="rounded-lg border border-border/70 bg-card/85 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
          <div className="flex items-center gap-2"><Focus className="size-3 text-primary" />{onChapterStepWheel ? "点击节点查看详情 · 滚轮缩放章距 · 拖拽平移" : "点击节点查看详情，支持拖拽节点与画布浏览关系"}</div>
        </div>
      </Panel>
      <Panel position="top-right" className="!m-4">
        <div className="flex flex-col items-end">
          <div className="flex gap-1.5">
            <Button
              variant={anchorOpen ? "secondary" : "outline"}
              size="sm"
              className="h-8 gap-1.5 bg-card/90 text-[10px] shadow-sm backdrop-blur"
              onClick={() => setAnchorOpen((open) => !open)}
              aria-label="打开锚点导航"
              aria-pressed={anchorOpen}
            >
              <Focus className="size-3.5" />锚点
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-card/90 text-[10px] shadow-sm backdrop-blur" onClick={resetViewport} aria-label="重置视口">
              <RotateCcw className="size-3.5" />重置视口
            </Button>
          </div>
          {anchorOpen ? (
            <GraphAnchorNavigator
              model={model}
              currentChapter={currentChapter}
              onSelectChapter={onAnchorChapter}
              onSelectEntity={onAnchorEntity}
            />
          ) : null}
        </div>
      </Panel>
    </ReactFlow>
    </div>
  );
}

function Inspector({ node, onClose, onOpenEntityDetail, onOpenChapter }: { node: GraphNodeModel | undefined; onClose: () => void; onOpenEntityDetail?: (entity: string, entryId?: string) => void; onOpenChapter?: (chapterNumber: number) => void }) {
  if (!node) {
    return (
      <div data-slot="narrative-memory-graph-inspector" className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <CircleHelp className="mb-3 size-8 opacity-40" />
        <p className="text-sm font-medium text-foreground">选择一个节点</p>
        <p className="mt-1 text-xs leading-5">图谱会高亮它的一跳关联，并在这里显示完整内容。</p>
      </div>
    );
  }
  return (
    <div data-slot="narrative-memory-graph-inspector" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{NODE_BADGES[node.kind]}</Badge>
            {node.category ? <span className="text-[10px] text-muted-foreground">{node.category}</span> : null}
          </div>
          <h3 className="break-words text-sm font-semibold leading-5">{node.title}</h3>
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClose} aria-label="关闭详情">
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {node.chapterNumber !== undefined ? <Metric label="章节" value={`第 ${node.chapterNumber} 章`} /> : null}
          {node.confidence !== undefined ? <Metric label="置信度" value={node.confidence.toFixed(2)} /> : null}
          {node.layer ? <Metric label="层级" value={node.layer} /> : null}
          {node.status ? <Metric label="状态" value={node.status} /> : null}
          {node.riskLevel ? <Metric label="风险" value={node.riskLevel} danger={isHighRisk(node.riskLevel)} /> : null}
          {node.lane ? <Metric label="轨道" value={node.lane} /> : null}
        </div>
        {node.description ? <DetailBlock label="对象 / 内容" content={node.description} /> : null}
        {node.evidenceText ? <DetailBlock label="证据" content={node.evidenceText} /> : null}
        {node.chapterNumber !== undefined && onOpenChapter ? (
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => onOpenChapter(node.chapterNumber!)}
          >
            <Clock className="size-3.5" /> 打开来源第 {node.chapterNumber} 章
          </Button>
        ) : null}
        {node.entityName && onOpenEntityDetail ? (
          <Button
            className="w-full gap-2"
            onClick={() => {
              if (!node.entityName) return;
              if (node.entryId) onOpenEntityDetail(node.entityName, node.entryId);
              else onOpenEntityDetail(node.entityName);
            }}
          >
            <Info className="size-3.5" /> {node.entryId ? "打开关联条目卡" : "查看实体完整详情"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-xs font-medium ${danger ? "text-destructive" : "text-foreground"}`} title={value}>{value}</div>
    </div>
  );
}

function DetailBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/15 p-3 text-xs leading-5 text-foreground">{content}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="size-10 animate-pulse rounded-xl bg-primary/10" />
      <div className="flex items-center gap-2 text-xs"><Loader2 className="size-3.5 animate-spin" />正在构建图谱布局…</div>
    </div>
  );
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-2xl border border-dashed border-border bg-muted/20 p-4"><Network className="size-8 text-muted-foreground/50" /></div>
      <p className="text-sm font-medium">{hasFilters ? "当前筛选没有图谱数据" : "还没有可展示的叙事记忆"}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{hasFilters ? "放宽实体或章节范围后重试。" : "写完一章并完成章后结算后，动态事实和事件会出现在这里。"}</p>
      {hasFilters ? <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>清空筛选</Button> : null}
    </div>
  );
}

export function NarrativeMemoryGraphWorkspace({
  bookId,
  initialView = "relationship",
  mode = "standard",
  dataScope = "read",
  currentChapter,
  initialFocusEntity,
  initialChapter,
  onSelectNode,
  onOpenEntityDetail,
  onOpenChapter,
}: NarrativeMemoryGraphWorkspaceProps) {
  const [view, setView] = useState<NarrativeMemoryView>(initialView);
  const [chapterStep, setChapterStep] = useState(SEQUENCE_CHAPTER_STEP_DEFAULT);
  const [focusEntity, setFocusEntity] = useState(initialFocusEntity ?? "");
  const [focusInput, setFocusInput] = useState(initialFocusEntity ?? "");
  const [chapterFrom, setChapterFrom] = useState("");
  const [chapterTo, setChapterTo] = useState("");
  const [chapterFromInput, setChapterFromInput] = useState("");
  const [chapterToInput, setChapterToInput] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [containerWidth, setContainerWidth] = useState(0);
  const [hiddenLaneNames, setHiddenLaneNames] = useState<string[]>([]);
  const hiddenLanes = useMemo(() => new Set(hiddenLaneNames), [hiddenLaneNames]);
  const [storyTimeByChapter, setStoryTimeByChapter] = useState<Map<number, { storyTime?: string; label?: string }>>(() => new Map());
  const [locateChapter, setLocateChapter] = useState<number | undefined>(initialChapter);
  const [scrollNodeId, setScrollNodeId] = useState<string | null>(null);
  const [locateMiss, setLocateMiss] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const knownLanesRef = useRef<string[]>([]);

  const availableViewOptions = mode === "development" ? DEVELOPMENT_VIEW_OPTIONS : VIEW_OPTIONS;

  useEffect(() => {
    setView(initialView);
    setHiddenLaneNames([]);
  }, [initialView]);

  useEffect(() => {
    let alive = true;
    void fetchJson<{ timeline?: { entries?: Array<{ chapter: number; storyTime?: string; label?: string }> } }>(
      `/api/books/${encodeURIComponent(bookId)}/state`,
    ).then((payload) => {
      if (!alive) return;
      const next = new Map<number, { storyTime?: string; label?: string }>();
      for (const entry of payload.timeline?.entries ?? []) {
        if (!Number.isInteger(entry.chapter)) continue;
        next.set(entry.chapter, { storyTime: entry.storyTime, label: entry.label });
      }
      setStoryTimeByChapter(next);
    }).catch(() => {
      if (alive) setStoryTimeByChapter(new Map());
    });
    return () => { alive = false; };
  }, [bookId]);

  useEffect(() => {
    if (initialFocusEntity !== undefined) {
      setFocusEntity(initialFocusEntity);
      setFocusInput(initialFocusEntity);
    }
  }, [initialFocusEntity]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const updateWidth = (width = element.getBoundingClientRect().width) => {
      setContainerWidth((current) => current === width ? current : width);
    };
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (typeof width === "number") updateWidth(width);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const handleResize = () => updateWidth();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoadState({ status: "loading" });
    setSelectedNodeId(null);
    // anchor 是前端线程导航视图，服务端仍按既有 timeline 数据契约取数。
    const params = new URLSearchParams({ view: view === "anchor" ? "timeline" : view, scope: dataScope });
    if (focusEntity.trim()) params.set("focusEntity", focusEntity.trim());
    if (chapterFrom.trim()) params.set("chapterFrom", chapterFrom.trim());
    if (chapterTo.trim()) params.set("chapterTo", chapterTo.trim());
    try {
      const payload = await fetchJson<NarrativeGraphResponse>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/graph?${params.toString()}`,
      );
      if (generation !== requestGeneration.current) return;
      setLoadState({ status: "ready", payload: { facts: payload.facts ?? [], events: payload.events ?? [], view: payload.view } });
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setLoadState({ status: "error", message: graphErrorMessage(cause) });
    }
  }, [bookId, chapterFrom, chapterTo, dataScope, focusEntity, view]);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    if (loadState.status !== "ready") return null;
    return buildNarrativeGraphModel({
      facts: loadState.payload.facts ?? [],
      events: loadState.payload.events ?? [],
      view,
      chapterStep,
      hiddenLanes,
      ...(focusEntity.trim() ? { focusEntity: focusEntity.trim() } : {}),
    });
  }, [chapterStep, focusEntity, hiddenLaneNames, hiddenLanes, loadState, view]);

  const availableLanes = useMemo(() => {
    if (loadState.status !== "ready") return [] as SequenceLaneHeader[];
    const unfiltered = buildNarrativeGraphModel({
      facts: loadState.payload.facts ?? [],
      events: loadState.payload.events ?? [],
      view,
      chapterStep,
      ...(focusEntity.trim() ? { focusEntity: focusEntity.trim() } : {}),
    });
    return unfiltered.sequence?.lanes ?? [];
  }, [chapterStep, focusEntity, loadState, view]);

  useEffect(() => {
    if (availableLanes.length === 0) return;
    knownLanesRef.current = availableLanes.map((lane) => lane.name);
  }, [availableLanes]);

  useEffect(() => {
    if (initialChapter === undefined || loadState.status !== "ready") return;
    const probe = buildNarrativeGraphModel({
      facts: loadState.payload.facts ?? [],
      events: loadState.payload.events ?? [],
      view,
      chapterStep,
      ...(focusEntity.trim() ? { focusEntity: focusEntity.trim() } : {}),
    });
    if (findChapterFocus(probe, initialChapter)) {
      setLocateChapter(initialChapter);
      setLocateMiss(null);
    } else {
      setLocateMiss(`图谱里没有第 ${initialChapter} 章`);
    }
  }, [chapterStep, focusEntity, initialChapter, loadState, view]);

  useEffect(() => {
    if (!initialFocusEntity || loadState.status !== "ready" || !model) return;
    const entityNode = model.nodes.find((node) => node.kind === "entity" && node.entityName === initialFocusEntity)
      ?? model.nodes.find((node) => node.entityName === initialFocusEntity);
    if (entityNode) {
      setSelectedNodeId(entityNode.id);
      setScrollNodeId(entityNode.id);
      setLocateMiss(null);
    } else {
      setLocateMiss(`图谱里没有「${initialFocusEntity}」`);
    }
  }, [initialFocusEntity, loadState, model]);

  const isSequenceView = view === "timeline" || view === "character_arc" || view === "event_chain" || view === "anchor";

  const handleChapterStepWheel = useCallback((deltaY: number) => {
    setChapterStep((current) => clampChapterStep(current + (deltaY > 0 ? -20 : 20)));
  }, []);

  const selectedNode = model?.nodes.find((node) => node.id === selectedNodeId);
  const hasLaneFilter = hiddenLaneNames.length > 0;
  const hasFilters = Boolean(focusEntity.trim() || chapterFrom.trim() || chapterTo.trim() || hasLaneFilter);
  const canvasEmptyBecauseLanesHidden = Boolean(model && model.nodes.length === 0 && hasLaneFilter && availableLanes.length > 0);
  const activeOption = availableViewOptions.find((option) => option.id === view)
    ?? VIEW_OPTIONS.find((option) => option.id === view)
    ?? { id: "anchor" as const, label: "锚点导航", icon: Focus, description: "按章节或角色聚焦同一份图谱数据" };
  const inspectorInSidebar = containerWidth >= INSPECTOR_SIDEBAR_MIN_CONTAINER_WIDTH;

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId || null);
    setScrollNodeId(nodeId || null);
    if (nodeId) onSelectNode?.(nodeId);
  }, [onSelectNode]);

  const selectAnchorChapter = useCallback((chapter: number) => {
    setLocateChapter(chapter);
    setLocateMiss(null);
    if (loadState.status === "ready") {
      const probe = buildNarrativeGraphModel({
        facts: loadState.payload.facts ?? [],
        events: loadState.payload.events ?? [],
        view,
        chapterStep,
        ...(focusEntity.trim() ? { focusEntity: focusEntity.trim() } : {}),
      });
      if (!findChapterFocus(probe, chapter)) {
        setLocateMiss(`图谱里没有第 ${chapter} 章`);
      }
    }
  }, [chapterStep, focusEntity, loadState, view]);

  const toggleLane = useCallback((lane: string) => {
    setHiddenLaneNames((current) => current.includes(lane) ? current.filter((name) => name !== lane) : [...current, lane]);
  }, []);

  const selectAnchorEntity = useCallback((entity: string) => {
    // 角色锚点是「跳到详情卡片」而不是重新请求一张过滤后的图，
    // 因此选中节点可立即保留在检查器中，并复用统一实体抽屉。
    const entityNode = model?.nodes.find((node) => node.kind === "entity" && node.entityName === entity);
    if (entityNode) selectNode(entityNode.id);
    if (entityNode?.entryId) onOpenEntityDetail?.(entity, entityNode.entryId);
    else onOpenEntityDetail?.(entity);
  }, [model, onOpenEntityDetail, selectNode]);

  const resetFilters = useCallback(() => {
    setFocusInput("");
    setFocusEntity("");
    setChapterFrom("");
    setChapterTo("");
    setChapterFromInput("");
    setChapterToInput("");
    setHiddenLaneNames([]);
    setLocateMiss(null);
    setLocateChapter(undefined);
  }, []);

  const applyFilters = useCallback(() => {
    setFocusEntity(focusInput.trim());
  }, [focusInput]);

  const applyChapterRange = useCallback(() => {
    const nextFrom = chapterFromInput.trim();
    const nextTo = chapterToInput.trim();
    if (nextFrom === chapterFrom && nextTo === chapterTo) {
      void load();
      return;
    }
    setChapterFrom(nextFrom);
    setChapterTo(nextTo);
  }, [chapterFrom, chapterFromInput, chapterTo, chapterToInput, load]);

  const changeView = useCallback((nextView: NarrativeMemoryView) => {
    setView(nextView);
    setSelectedNodeId(null);
  }, []);

  return (
    <TooltipProvider>
      <div
        ref={workspaceRef}
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-xs"
        data-slot="narrative-memory-graph-workspace"
        data-testid="narrative-memory-graph-workspace"
        data-source-scope={dataScope}
        data-workspace-mode={mode}
        data-hidden-lanes={hiddenLaneNames.join("|")}
      >
        <header data-slot="narrative-memory-graph-header" className="shrink-0 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Brain className="size-5" /></div>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold">{mode === "development" ? "发展历程" : "叙事记忆图谱"}</h1><Badge variant="secondary" className="text-[10px]">动态数据</Badge></div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{activeOption.description} · 只读 Narrative Memory，不改经纬 Lore</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {model ? <div className="hidden items-center gap-1.5 text-[10px] text-muted-foreground lg:flex"><StatPill label="节点" value={model.stats.nodeCount} /><StatPill label="边" value={model.stats.edgeCount} /><StatPill label="章节" value={model.stats.chapterCount} />{isSequenceView ? <StatPill label="章距" value={chapterStep} /> : null}</div> : null}
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" onClick={() => void load()} aria-label="刷新图谱"><RefreshCw className="size-3.5" /></Button></TooltipTrigger><TooltipContent>刷新图谱</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant={inspectorOpen ? "secondary" : "ghost"} size="icon" className="size-8" onClick={() => setInspectorOpen((open) => !open)} aria-label="切换详情面板"><PanelRight className="size-3.5" /></Button></TooltipTrigger><TooltipContent>切换详情面板</TooltipContent></Tooltip>
            </div>
          </div>
          <div data-slot="narrative-memory-graph-view-switcher" className="flex items-center gap-1 overflow-x-auto border-t border-border/70 px-4 py-2">
            {availableViewOptions.map((option) => {
              const Icon = option.icon;
              return <Button key={option.id} variant={view === option.id ? "secondary" : "ghost"} size="sm" className={`shrink-0 gap-1.5 text-[11px] ${view === option.id ? "text-primary" : "text-muted-foreground"}`} onClick={() => changeView(option.id)}><Icon className="size-3.5" />{option.label}</Button>;
            })}
          </div>
          <div data-slot="narrative-memory-graph-filters" className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <Input value={focusInput} onChange={(event) => setFocusInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} placeholder="聚焦实体，例如：薛行之" className="h-8 border-0 px-0 text-xs shadow-none focus-visible:ring-0" />
              {focusEntity ? <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setFocusInput(""); setFocusEntity(""); }} aria-label="清除聚焦实体"><X className="size-3.5" /></button> : null}
            </div>
            <Button size="sm" className="h-8 gap-1.5" onClick={applyFilters}><Focus className="size-3.5" />聚焦</Button>
            <Button variant={filtersOpen ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal className="size-3.5" />章节筛选</Button>
            {hasFilters ? <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={resetFilters}><RotateCcw className="size-3.5" />清空</Button> : null}
          </div>
          {isSequenceView && availableLanes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 border-t border-border/70 px-4 py-1.5" data-testid="narrative-graph-lane-chips">
              <span className="mr-1 text-[10px] text-muted-foreground">泳道</span>
              {availableLanes.map((lane) => {
                const hidden = hiddenLanes.has(lane.name);
                return (
                  <button
                    key={lane.name}
                    type="button"
                    aria-pressed={!hidden}
                    data-testid={`narrative-graph-lane-chip-${lane.name}`}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${hidden ? "border-border/50 text-muted-foreground line-through" : "border-border bg-muted/30 text-foreground"}`}
                    onClick={() => toggleLane(lane.name)}
                  >
                    {lane.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          {locateMiss ? (
            <div className="flex items-center justify-between gap-2 border-t border-amber-400/40 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-800 dark:text-amber-300" data-testid="narrative-graph-locate-miss">
              <span>{locateMiss}</span>
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setLocateMiss(null); setLocateChapter(undefined); }}>知道了</Button>
            </div>
          ) : null}
          {filtersOpen ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-border/70 bg-muted/15 px-4 py-2">
              <label className="grid gap-1 text-[10px] text-muted-foreground">起始章节<Input type="number" min={1} value={chapterFromInput} onChange={(event) => setChapterFromInput(event.currentTarget.value)} placeholder="不限" className="h-8 w-28 text-xs" /></label>
              <span className="pb-2 text-muted-foreground">—</span>
              <label className="grid gap-1 text-[10px] text-muted-foreground">结束章节<Input type="number" min={1} value={chapterToInput} onChange={(event) => setChapterToInput(event.currentTarget.value)} placeholder="不限" className="h-8 w-28 text-xs" /></label>
              <Button size="sm" className="h-8" onClick={applyChapterRange}>应用范围</Button>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1">
          <main data-slot="narrative-memory-graph-main" className="relative min-w-0 flex-1 bg-muted/[0.08]">
            {loadState.status === "loading" ? <LoadingState /> : loadState.status === "error" ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center"><AlertTriangle className="mb-3 size-8 text-destructive/70" /><p className="text-sm font-medium">图谱暂时无法加载</p><p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{loadState.message}</p><Button className="mt-4 gap-2" size="sm" onClick={() => void load()}><RefreshCw className="size-3.5" />重试</Button></div>
            ) : canvasEmptyBecauseLanesHidden ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center" data-testid="narrative-graph-lanes-hidden-empty">
                <p className="text-sm font-medium">当前泳道都已隐藏</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">点上方泳道 chips 再打开轨道，或清空筛选。</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={resetFilters}>清空筛选</Button>
              </div>
            ) : !model || model.nodes.length === 0 ? <EmptyState hasFilters={hasFilters} onReset={resetFilters} /> : (
              <ReactFlowProvider>
                <GraphCanvas
                  model={model}
                  selectedNodeId={selectedNodeId}
                  currentChapter={currentChapter}
                  onSelectNode={selectNode}
                  onAnchorChapter={selectAnchorChapter}
                  onAnchorEntity={selectAnchorEntity}
                  onOpenEntityDetail={onOpenEntityDetail}
                  onChapterStepWheel={isSequenceView ? handleChapterStepWheel : undefined}
                  onToggleLane={toggleLane}
                  storyTimeByChapter={storyTimeByChapter}
                  locateChapter={locateChapter}
                  locateNodeId={scrollNodeId}
                />
              </ReactFlowProvider>
            )}
            {inspectorOpen && selectedNode && !inspectorInSidebar ? (
              <div data-slot="narrative-memory-graph-inspector-overlay" data-testid="narrative-graph-inspector-overlay" className="absolute inset-x-3 bottom-3 z-30 h-[min(420px,46vh)] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                <Inspector node={selectedNode} onClose={() => setSelectedNodeId(null)} onOpenEntityDetail={onOpenEntityDetail} onOpenChapter={onOpenChapter} />
              </div>
            ) : null}
          </main>
          {inspectorOpen && inspectorInSidebar ? <aside data-slot="narrative-memory-graph-inspector-sidebar" data-testid="narrative-graph-inspector-sidebar" className="w-[300px] shrink-0 border-l border-border bg-card"><Inspector node={selectedNode} onClose={() => setSelectedNodeId(null)} onOpenEntityDetail={onOpenEntityDetail} onOpenChapter={onOpenChapter} /></aside> : null}
        </div>
        <footer data-slot="narrative-memory-graph-footer" className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-card px-4 py-1.5 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />实体</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-accent-foreground" />状态</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-ring" />事件</span></div>
          <span>{model ? `${viewLabel(view)} · ${model.stats.factCount} 条事实 · ${model.stats.eventCount} 个事件` : "等待图谱数据"}</span>
        </footer>
      </div>
    </TooltipProvider>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return <span className="rounded-md border border-border/70 bg-muted/20 px-2 py-1">{label} <strong className="text-foreground">{value}</strong></span>;
}

export function NarrativeMemoryGraphWorkspaceShell(props: NarrativeMemoryGraphWorkspaceProps) {
  return <NarrativeMemoryGraphWorkspace {...props} />;
}
