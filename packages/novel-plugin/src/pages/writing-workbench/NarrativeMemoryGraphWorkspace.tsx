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
  type GraphEdgeModel,
  type GraphNodeModel,
  type NarrativeEvent,
  type NarrativeFact,
  type NarrativeGraphModel,
  type NarrativeMemoryView,
  viewLabel,
} from "./narrative-memory-graph-model";

export interface NarrativeMemoryGraphWorkspaceProps {
  bookId: string;
  initialView?: NarrativeMemoryView;
  onSelectNode?: (nodeId: string) => void;
  onOpenEntityDetail?: (entity: string) => void;
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

const VIEW_OPTIONS: ReadonlyArray<{ id: NarrativeMemoryView; label: string; icon: typeof Network; description: string }> = [
  { id: "relationship", label: "关系图", icon: Network, description: "实体与动态关系" },
  { id: "timeline", label: "时间线", icon: Clock, description: "按章节展开事件" },
  { id: "character_arc", label: "角色弧线", icon: GitBranch, description: "角色状态推进" },
  { id: "conflict", label: "矛盾地图", icon: Swords, description: "冲突两侧与风险" },
  { id: "event_chain", label: "事件链", icon: Route, description: "事件前后关系" },
  { id: "wave", label: "浪潮视图", icon: Radio, description: "从中心向外传播" },
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
  model: GraphNodeModel;
  muted: boolean;
  onOpenEntityDetail?: (entity: string) => void;
}

interface FlowEdgeData {
  [key: string]: unknown;
  model: GraphEdgeModel;
  showLabel: boolean;
  highlighted: boolean;
}

type FlowNode = Node<FlowNodeData, "narrativeGraphNode">;
type FlowEdge = Edge<FlowEdgeData, "narrativeGraphEdge">;

function NarrativeGraphNode({ data, selected }: NodeProps<FlowNode>) {
  const node = data.model;
  const canOpen = node.kind === "entity" && Boolean(node.entityName && data.onOpenEntityDetail);
  const risk = isHighRisk(node.riskLevel);
  return (
    <Card
      className={`group relative rounded-lg border px-3 py-2.5 shadow-sm motion-safe:transition-all motion-safe:duration-200 ${NODE_ACCENTS[node.kind]} ${
        selected ? "z-20 scale-[1.03] border-primary bg-primary/10 shadow-lg shadow-primary/10" : "motion-safe:hover:z-10 motion-safe:hover:-translate-y-0.5 hover:shadow-md"
      } ${data.muted ? "opacity-35 saturate-50" : "opacity-100"} ${risk ? "border-destructive/60 bg-destructive/[0.08]" : ""}`}
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
            if (node.entityName) data.onOpenEntityDetail?.(node.entityName);
          }}
        >
          查看实体详情 <ChevronRight className="size-3" />
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

const nodeTypes = { narrativeGraphNode: NarrativeGraphNode };
const edgeTypes = { narrativeGraphEdge: NarrativeGraphEdge };

function toFlowNodes(model: NarrativeGraphModel, selectedNodeId: string | null, onOpenEntityDetail?: (entity: string) => void): FlowNode[] {
  const visible = new Set<string>();
  if (selectedNodeId) {
    visible.add(selectedNodeId);
    for (const edge of model.edges) {
      if (edge.source === selectedNodeId) visible.add(edge.target);
      if (edge.target === selectedNodeId) visible.add(edge.source);
    }
  }
  return model.nodes.map((node) => ({
    id: node.id,
    type: "narrativeGraphNode",
    position: node.position,
    draggable: false,
    selectable: true,
    data: { model: node, muted: Boolean(selectedNodeId && !visible.has(node.id)), onOpenEntityDetail },
  }));
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

function GraphCanvas({ model, selectedNodeId, onSelectNode, onOpenEntityDetail }: { model: NarrativeGraphModel; selectedNodeId: string | null; onSelectNode: (nodeId: string) => void; onOpenEntityDetail?: (entity: string) => void }) {
  const { fitView } = useReactFlow<FlowNode, FlowEdge>();
  const nodes = useMemo(() => toFlowNodes(model, selectedNodeId, onOpenEntityDetail), [model, onOpenEntityDetail, selectedNodeId]);
  const edges = useMemo(() => toFlowEdges(model, selectedNodeId), [model, selectedNodeId]);
  const resetViewport = useCallback(() => {
    void fitView({ padding: 0.18, duration: 250 });
  }, [fitView]);

  useEffect(() => {
    const frame = requestAnimationFrame(resetViewport);
    return () => cancelAnimationFrame(frame);
  }, [model, resetViewport]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode("")}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.16}
      maxZoom={2.4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      zoomOnScroll
      zoomOnPinch
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
          return data ? MINIMAP_COLORS[data.model.kind] : "hsl(var(--primary))";
        }}
        className="!bottom-4 !right-4 !rounded-lg !border-border !bg-card/90 !shadow-md"
      />
      <Panel position="top-left" className="!m-4">
        <div className="rounded-lg border border-border/70 bg-card/85 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
          <div className="flex items-center gap-2"><Focus className="size-3 text-primary" />点击节点查看详情，拖动画布浏览关系</div>
        </div>
      </Panel>
      <Panel position="top-right" className="!m-4">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-card/90 text-[10px] shadow-sm backdrop-blur" onClick={resetViewport} aria-label="重置视口">
          <RotateCcw className="size-3.5" />重置视口
        </Button>
      </Panel>
    </ReactFlow>
  );
}

function Inspector({ node, onClose, onOpenEntityDetail }: { node: GraphNodeModel | undefined; onClose: () => void; onOpenEntityDetail?: (entity: string) => void }) {
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
        {node.entityName && onOpenEntityDetail ? (
          <Button className="w-full gap-2" onClick={() => onOpenEntityDetail(node.entityName!)}>
            <Info className="size-3.5" /> 查看实体完整详情
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

export function NarrativeMemoryGraphWorkspace({ bookId, initialView = "relationship", onSelectNode, onOpenEntityDetail }: NarrativeMemoryGraphWorkspaceProps) {
  const [view, setView] = useState<NarrativeMemoryView>(initialView);
  const [focusEntity, setFocusEntity] = useState("");
  const [focusInput, setFocusInput] = useState("");
  const [chapterFrom, setChapterFrom] = useState("");
  const [chapterTo, setChapterTo] = useState("");
  const [chapterFromInput, setChapterFromInput] = useState("");
  const [chapterToInput, setChapterToInput] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [containerWidth, setContainerWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

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
    const params = new URLSearchParams({ view });
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
  }, [bookId, chapterFrom, chapterTo, focusEntity, view]);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    if (loadState.status !== "ready") return null;
    return buildNarrativeGraphModel({
      facts: loadState.payload.facts ?? [],
      events: loadState.payload.events ?? [],
      view,
      ...(focusEntity.trim() ? { focusEntity: focusEntity.trim() } : {}),
    });
  }, [focusEntity, loadState, view]);

  const selectedNode = model?.nodes.find((node) => node.id === selectedNodeId);
  const hasFilters = Boolean(focusEntity.trim() || chapterFrom.trim() || chapterTo.trim());
  const activeOption = VIEW_OPTIONS.find((option) => option.id === view)!;
  const inspectorInSidebar = containerWidth >= INSPECTOR_SIDEBAR_MIN_CONTAINER_WIDTH;

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId || null);
    if (nodeId) onSelectNode?.(nodeId);
  }, [onSelectNode]);

  const resetFilters = useCallback(() => {
    setFocusInput("");
    setFocusEntity("");
    setChapterFrom("");
    setChapterTo("");
    setChapterFromInput("");
    setChapterToInput("");
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
      <div ref={workspaceRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-xs" data-slot="narrative-memory-graph-workspace" data-testid="narrative-memory-graph-workspace">
        <header data-slot="narrative-memory-graph-header" className="shrink-0 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Brain className="size-5" /></div>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold">叙事记忆图谱</h1><Badge variant="secondary" className="text-[10px]">动态数据</Badge></div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{activeOption.description} · 只读 Narrative Memory，不改经纬 Lore</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {model ? <div className="hidden items-center gap-1.5 text-[10px] text-muted-foreground lg:flex"><StatPill label="节点" value={model.stats.nodeCount} /><StatPill label="边" value={model.stats.edgeCount} /><StatPill label="章节" value={model.stats.chapterCount} /></div> : null}
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" onClick={() => void load()} aria-label="刷新图谱"><RefreshCw className="size-3.5" /></Button></TooltipTrigger><TooltipContent>刷新图谱</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant={inspectorOpen ? "secondary" : "ghost"} size="icon" className="size-8" onClick={() => setInspectorOpen((open) => !open)} aria-label="切换详情面板"><PanelRight className="size-3.5" /></Button></TooltipTrigger><TooltipContent>切换详情面板</TooltipContent></Tooltip>
            </div>
          </div>
          <div data-slot="narrative-memory-graph-view-switcher" className="flex items-center gap-1 overflow-x-auto border-t border-border/70 px-4 py-2">
            {VIEW_OPTIONS.map((option) => {
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
            ) : !model || model.nodes.length === 0 ? <EmptyState hasFilters={hasFilters} onReset={resetFilters} /> : (
              <ReactFlowProvider>
                <GraphCanvas model={model} selectedNodeId={selectedNodeId} onSelectNode={selectNode} onOpenEntityDetail={onOpenEntityDetail} />
              </ReactFlowProvider>
            )}
            {inspectorOpen && selectedNode && !inspectorInSidebar ? (
              <div data-slot="narrative-memory-graph-inspector-overlay" data-testid="narrative-graph-inspector-overlay" className="absolute inset-x-3 bottom-3 z-30 h-[min(420px,46vh)] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                <Inspector node={selectedNode} onClose={() => setSelectedNodeId(null)} onOpenEntityDetail={onOpenEntityDetail} />
              </div>
            ) : null}
          </main>
          {inspectorOpen && inspectorInSidebar ? <aside data-slot="narrative-memory-graph-inspector-sidebar" data-testid="narrative-graph-inspector-sidebar" className="w-[300px] shrink-0 border-l border-border bg-card"><Inspector node={selectedNode} onClose={() => setSelectedNodeId(null)} onOpenEntityDetail={onOpenEntityDetail} /></aside> : null}
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
