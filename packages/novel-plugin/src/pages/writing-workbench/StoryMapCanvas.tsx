/**
 * StoryMapCanvas — 全功能长篇网文故事主支线 DAG 画布
 *
 * 吸收 OpenWrite（Story Map）与 PlotPilot（Storyline DAG）最佳实践：
 * 1. 【X轴时间推进】基于真实 NarrativeLineSnapshot 中的章节/事件/冲突/伏笔节点排布；
 * 2. 【Y轴故事线分层】主线（chapter/event）、支线（character-arc/setting）、冲突与高潮（conflict/payoff）、伏笔（foreshadow）；
 * 3. 【真实数据驱动】彻底移除假数据，消费 GET /api/books/:bookId/narrative-line；
 * 4. 【双向跳章与一键提拔】章节节点跳回手稿正文，规划节点由上层 handler 执行提拔立项。
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertCircle,
  BookOpen,
  FilePlus2,
  GitFork,
  Loader2,
  RotateCcw,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import type {
  NarrativeEdge,
  NarrativeLineSnapshot,
  NarrativeNode,
  NarrativeNodeType,
} from "../../handlers/narrative-line-types";

export type StoryMapLane = "main" | "character_arc" | "conflict" | "foreshadow";

export interface StoryMapNodeData extends Record<string, unknown> {
  id: string;
  title: string;
  summary?: string;
  lane: StoryMapLane;
  laneLabel: string;
  nodeType: NarrativeNodeType;
  chapterNumber?: number;
  status?: string;
  characters?: readonly string[];
  hooks?: readonly string[];
  onPromote?: (node: StoryMapNodeData) => void;
  onOpenChapter?: (chapterNumber: number) => void;
}

export const LANE_METAS: Record<StoryMapLane, { border: string; bg: string; text: string; label: string; yOffset: number }> = {
  main: {
    border: "border-primary/60",
    bg: "bg-primary/[0.06]",
    text: "text-primary",
    label: "主线推进",
    yOffset: 100,
  },
  character_arc: {
    border: "border-amber-500/60",
    bg: "bg-amber-500/[0.06]",
    text: "text-amber-600 dark:text-amber-400",
    label: "角色·支线",
    yOffset: 270,
  },
  conflict: {
    border: "border-rose-500/60",
    bg: "bg-rose-500/[0.08]",
    text: "text-rose-600 dark:text-rose-400",
    label: "冲突·高潮",
    yOffset: 440,
  },
  foreshadow: {
    border: "border-sky-500/60",
    bg: "bg-sky-500/[0.06]",
    text: "text-sky-600 dark:text-sky-400",
    label: "伏笔·回收",
    yOffset: 610,
  },
};

export function resolveStoryMapLane(nodeType: NarrativeNodeType): StoryMapLane {
  switch (nodeType) {
    case "chapter":
    case "event":
      return "main";
    case "character-arc":
    case "setting":
      return "character_arc";
    case "conflict":
    case "payoff":
      return "conflict";
    case "foreshadow":
      return "foreshadow";
    default:
      return "main";
  }
}

/**
 * 快照里是否存在「规划类」节点（角色支线/冲突/伏笔等）。
 *
 * IA 收敛后的空态纪律：只有章节节点时 DAG 没有信息量（纯跳转卡），
 * 此时故事地图显示明确空态引导，而不是渲染一张假功能的画布。
 */
export function hasPlanningNodes(snapshot: NarrativeLineSnapshot | null | undefined): boolean {
  if (!snapshot || !Array.isArray(snapshot.nodes)) return false;
  return snapshot.nodes.some((node) => {
    const lane = resolveStoryMapLane(node.type);
    return lane !== "main" || (node.type !== "chapter" && node.type !== "event");
  });
}

/**
 * 纯函数：将 NarrativeLineSnapshot 转换成 React Flow 的 nodes 与 edges。
 */
export function snapshotToFlowElements(
  snapshot: NarrativeLineSnapshot | null | undefined,
  callbacks?: {
    onOpenChapter?: (chapterNumber: number) => void;
    onPromote?: (node: StoryMapNodeData) => void;
  },
): { nodes: Node<StoryMapNodeData>[]; edges: Edge[] } {
  if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const rawNodes = snapshot.nodes;
  const rawEdges = Array.isArray(snapshot.edges) ? snapshot.edges : [];

  // 1. 建立节点 ID 集合用于边合法性校验
  const validNodeIds = new Set(rawNodes.map((n) => n.id));

  // 2. 排序与 X 坐标排布：优先使用 chapterNumber，未带 chapterNumber 的排在后面
  const sortedNodes = [...rawNodes].sort((a, b) => {
    const aChap = a.chapterNumber ?? 99999;
    const bChap = b.chapterNumber ?? 99999;
    if (aChap !== bChap) return aChap - bChap;
    return a.title.localeCompare(b.title, "zh");
  });

  // 3. 构建 React Flow Nodes
  const flowNodes: Node<StoryMapNodeData>[] = sortedNodes.map((node, index) => {
    const lane = resolveStoryMapLane(node.type);
    const laneMeta = LANE_METAS[lane];
    const x = index * 340 + 60;
    const y = laneMeta.yOffset;

    // 关联伏笔/冲突等上下文元数据提取
    const hooks = node.type === "foreshadow" ? [node.title] : undefined;

    return {
      id: node.id,
      type: "storyNode",
      position: { x, y },
      data: {
        id: node.id,
        title: node.title,
        summary: node.summary,
        lane,
        laneLabel: laneMeta.label,
        nodeType: node.type,
        chapterNumber: node.chapterNumber,
        status: node.status,
        hooks,
        onOpenChapter: callbacks?.onOpenChapter,
        onPromote: callbacks?.onPromote,
      },
    };
  });

  // 4. 构建 React Flow Edges（保留快照真实边类型与置信度）
  const flowEdges: Edge[] = rawEdges
    .filter((e: NarrativeEdge) => validNodeIds.has(e.fromNodeId) && validNodeIds.has(e.toNodeId))
    .map((e: NarrativeEdge) => {
      const isCauses = e.type === "causes" || e.type === "escalates" || e.type === "pays-off";
      return {
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        animated: isCauses,
        label: e.label || (e.type !== "supports" ? e.type : undefined),
        style: {
          stroke: isCauses ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
          strokeWidth: e.confidence === "explicit" ? 2 : 1.5,
          strokeDasharray: e.confidence === "inferred" ? "4 4" : undefined,
        },
      };
    });

  return { nodes: flowNodes, edges: flowEdges };
}

function StoryCardNode({ data }: NodeProps<Node<StoryMapNodeData>>) {
  const laneMeta = LANE_METAS[data.lane] ?? LANE_METAS.main;
  const isChapter = data.nodeType === "chapter" && typeof data.chapterNumber === "number";

  return (
    <div
      className={`relative w-72 rounded-xl border-2 p-3 shadow-md backdrop-blur-sm transition-all hover:shadow-lg ${laneMeta.border} ${laneMeta.bg} bg-card/95`}
      data-testid={`story-map-node-${data.id}`}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !bg-primary" />

      {/* 头部：故事线轨道 + 章节/节点类型 */}
      <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 font-semibold ${laneMeta.text}`}>
            {laneMeta.label}
          </Badge>
          {data.chapterNumber ? (
            <span className="text-[10px] font-bold text-muted-foreground">第 {data.chapterNumber} 章</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">{data.nodeType}</span>
          )}
        </div>

        <Badge
          variant="secondary"
          className={`text-[9px] px-1.5 h-4 ${
            isChapter
              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {isChapter ? "已落盘" : (data.status || "规划中")}
        </Badge>
      </div>

      {/* 主体：节点标题与剧情摘要 */}
      <div className="py-2 space-y-1">
        <h4 className="text-xs font-bold text-foreground leading-snug line-clamp-1">{data.title}</h4>
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
          {data.summary || "暂无详细情节描述"}
        </p>
      </div>

      {/* 挂载数据：涉及人物与伏笔 */}
      <div className="flex flex-wrap items-center gap-1 pt-1 text-[9px] text-muted-foreground border-t border-border/40">
        {data.characters && data.characters.length > 0 ? (
          <div className="flex items-center gap-1 rounded bg-muted/60 px-1 py-0.5">
            <UserRound className="size-2.5 text-primary" />
            <span className="truncate max-w-28">{data.characters.join("、")}</span>
          </div>
        ) : null}

        {data.hooks && data.hooks.length > 0 ? (
          <div className="flex items-center gap-1 rounded bg-muted/60 px-1 py-0.5 text-amber-600 dark:text-amber-400">
            <Zap className="size-2.5" />
            <span className="truncate max-w-24">{data.hooks[0]}</span>
          </div>
        ) : null}
      </div>

      {/* 底部操作区：一键提拔手稿 / 跳转章节 */}
      <div className="mt-2.5 flex items-center justify-between gap-1 pt-2 border-t border-border/50">
        {isChapter && data.onOpenChapter ? (
          <Button
            size="xs"
            variant="ghost"
            className="h-6 text-[10px] gap-1 px-1.5 text-primary hover:text-primary/90"
            onClick={() => data.onOpenChapter?.(data.chapterNumber!)}
          >
            <BookOpen className="size-3" />
            查看章节
          </Button>
        ) : data.onPromote ? (
          <Button
            size="xs"
            variant="default"
            className="h-6 text-[10px] gap-1 px-2 font-medium bg-primary text-primary-foreground shadow-2xs"
            onClick={() => data.onPromote?.(data)}
          >
            <FilePlus2 className="size-3" />
            提拔落稿
          </Button>
        ) : <span />}
      </div>

      <Handle type="source" position={Position.Right} className="!size-2.5 !bg-primary" />
    </div>
  );
}

const nodeTypes = {
  storyNode: StoryCardNode,
};

export interface StoryMapCanvasProps {
  bookId: string;
  runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  onOpenChapter?: (chapterNumber: number) => void;
  onPromote?: (node: StoryMapNodeData) => void;
}

export function StoryMapCanvas({ bookId, runtimeFetch, onOpenChapter, onPromote }: StoryMapCanvasProps) {
  const [snapshot, setSnapshot] = useState<NarrativeLineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStoryMap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/books/${encodeURIComponent(bookId)}/narrative-line`;
      let resData: { snapshot?: NarrativeLineSnapshot };

      if (runtimeFetch) {
        resData = (await runtimeFetch(url)) as { snapshot?: NarrativeLineSnapshot };
      } else {
        resData = await fetchJson<{ snapshot?: NarrativeLineSnapshot }>(url);
      }

      setSnapshot(resData.snapshot ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载故事主支线失败");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [bookId, runtimeFetch]);

  useEffect(() => {
    void loadStoryMap();
  }, [loadStoryMap]);

  const callbacks = useMemo(() => ({ onOpenChapter, onPromote }), [onOpenChapter, onPromote]);
  const { nodes, edges } = useMemo(() => snapshotToFlowElements(snapshot, callbacks), [snapshot, callbacks]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background" data-testid="story-map-loading">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>正在加载故事主支线…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center bg-background" data-testid="story-map-error">
        <AlertCircle className="size-6 text-destructive" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">故事主支线加载失败</p>
          <p className="text-[11px] text-muted-foreground max-w-sm">{error}</p>
        </div>
        <Button size="xs" variant="outline" className="h-7 text-xs gap-1" onClick={() => void loadStoryMap()}>
          <RotateCcw className="size-3" />
          重试
        </Button>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center bg-background" data-testid="story-map-empty">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
          <GitFork className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">暂无故事主支线数据</p>
          <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
            当前书籍尚未生成章节或叙事线节点。开始写作或在大纲中添加规划后将自动生成主支线图。
          </p>
        </div>
        <Button size="xs" variant="outline" className="h-7 text-xs gap-1" onClick={() => void loadStoryMap()}>
          <RotateCcw className="size-3" />
          刷新
        </Button>
      </div>
    );
  }

  // 只有章节节点、没有任何规划节点：DAG 退化为纯跳转卡，没有信息量 —— 显示诚实空态引导。
  if (!hasPlanningNodes(snapshot)) {
    const chapterCount = nodes.length;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center bg-background" data-testid="story-map-empty-planning">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
          <GitFork className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">叙事线暂无规划节点</p>
          <p className="text-[11px] text-muted-foreground max-w-sm leading-relaxed">
            当前快照仅包含 {chapterCount} 个章节节点。在对话中让叙述者规划叙事线的
            事件 / 冲突 / 伏笔节点后，这里会展示完整的主支线 DAG 与一键提拔落稿。
          </p>
        </div>
        <Button size="xs" variant="outline" className="h-7 text-xs gap-1" onClick={() => void loadStoryMap()}>
          <RotateCcw className="size-3" />
          刷新
        </Button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-background" data-testid="story-map-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
          /* 只读叙事画布：节点可拖拽/缩放/点击，但停用连线手柄等未使用的写操作 */
          nodesConnectable={false}
          edgesFocusable={false}
          zoomOnDoubleClick={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          <Controls />
          <MiniMap
            nodeColor={(n: Node<StoryMapNodeData>) => (n.data?.lane === "main" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))")}
            className="!border-border !bg-card"
          />

          {/* 顶部控制面板 */}
          <Panel position="top-left" className="m-3 flex items-center gap-2 rounded-lg border border-border bg-card/90 p-1.5 shadow-sm backdrop-blur-md">
            <div className="flex items-center gap-1.5 px-2">
              <Sparkles className="size-4 text-primary" />
              <span className="text-xs font-bold text-foreground">故事全景推进画布 (Story Map)</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <Button size="xs" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => void loadStoryMap()}>
              <RotateCcw className="size-3" />
              刷新
            </Button>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
