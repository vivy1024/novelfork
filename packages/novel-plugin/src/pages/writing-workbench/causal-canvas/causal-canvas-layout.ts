/**
 * 因果画布的排版（纯函数）：横轴按章、纵轴按剧情线分泳道。
 *
 * 不用力导向：之前几个下线的图谱画布都栽在「每次打开位置都不一样、越画越乱」上。
 * 这里位置完全由数据决定——场景的 x 由它所在的章决定，y 由它住的泳道决定；
 * 同一泳道同一章有多个场景时按章内次序左右并排。作者拖动场景只用来换泳道（改主剧情线），
 * 放手后回到按数据算出的位置，因此不存任何节点坐标。
 */

import type { Edge, Node } from "@xyflow/react";

import type { CausalGraph, CausalLane, CausalSceneNode } from "../../../engine/narrative-taxonomy/causal-graph";

/** 左侧冻结的泳道名栏在画布坐标里占的宽度：第一章的场景从它右边开始，初始视图不会被遮住。 */
export const LANE_LABEL_SPACE = 184;
/** 顶部冻结的章号栏高度。 */
export const CHAPTER_LABEL_SPACE = 36;
export const LANE_HEIGHT = 124;
export const SCENE_WIDTH = 176;
export const SCENE_HEIGHT = 84;
const SLOT_WIDTH = SCENE_WIDTH + 24;
const CHAPTER_GAP = 40;

/** 剧情线的颜色：泳道标记、场景上的挂载圆点与线路同色，一眼对上。 */
export const LANE_COLORS = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"] as const;
export const UNMOUNTED_COLOR = "#94a3b8";

export interface CausalColumn {
  readonly chapterNumber: number;
  readonly x: number;
  readonly width: number;
}

export interface CausalLayout {
  readonly columns: readonly CausalColumn[];
  /** 每条泳道的上边缘 y（画布坐标）。 */
  readonly laneTops: ReadonlyMap<string, number>;
  readonly scenePositions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly width: number;
  readonly height: number;
}

export function laneColor(graph: Pick<CausalGraph, "lanes">, laneId: string): string {
  const index = graph.lanes.findIndex((lane) => lane.id === laneId);
  const lane = graph.lanes[index];
  if (!lane || !lane.storyline) return UNMOUNTED_COLOR;
  return LANE_COLORS[index % LANE_COLORS.length]!;
}

export function layoutCausalGraph(graph: CausalGraph): CausalLayout {
  // 每章的列宽 = 该章在任一泳道里最多并排的场景数。
  const perCell = new Map<string, CausalSceneNode[]>();
  for (const node of graph.scenes) {
    const key = `${node.laneId}\u0000${node.scene.chapterNumber}`;
    perCell.set(key, [...(perCell.get(key) ?? []), node]);
  }
  const columns: CausalColumn[] = [];
  let cursor = LANE_LABEL_SPACE;
  for (const chapterNumber of graph.chapters) {
    const slots = Math.max(1, ...graph.lanes.map((lane) => perCell.get(`${lane.id}\u0000${chapterNumber}`)?.length ?? 0));
    const width = slots * SLOT_WIDTH - (SLOT_WIDTH - SCENE_WIDTH);
    columns.push({ chapterNumber, x: cursor, width });
    cursor += width + CHAPTER_GAP;
  }
  const laneTops = new Map(graph.lanes.map((lane, index) => [lane.id, CHAPTER_LABEL_SPACE + index * LANE_HEIGHT]));
  const columnOf = new Map(columns.map((column) => [column.chapterNumber, column]));
  const scenePositions = new Map<string, { x: number; y: number }>();
  for (const nodes of perCell.values()) {
    // graph.scenes 已按章号与章内次序排好，同格内的先后即并排顺序。
    nodes.forEach((node, slot) => {
      const column = columnOf.get(node.scene.chapterNumber)!;
      scenePositions.set(node.scene.id, {
        x: column.x + slot * SLOT_WIDTH,
        y: laneTops.get(node.laneId)! + (LANE_HEIGHT - SCENE_HEIGHT) / 2,
      });
    });
  }
  return {
    columns,
    laneTops,
    scenePositions,
    width: Math.max(cursor, LANE_LABEL_SPACE + SCENE_WIDTH),
    height: CHAPTER_LABEL_SPACE + graph.lanes.length * LANE_HEIGHT,
  };
}

/** 场景被拖到的纵向位置落在哪条泳道（按卡片中心算，超出上下边界取最近的）。 */
export function laneAtY(graph: Pick<CausalGraph, "lanes">, y: number): CausalLane {
  const index = Math.floor((y + SCENE_HEIGHT / 2 - CHAPTER_LABEL_SPACE) / LANE_HEIGHT);
  return graph.lanes[Math.min(graph.lanes.length - 1, Math.max(0, index))]!;
}

// ─── React Flow 节点与连线 ─────────────────────────────────────────────────────

export interface CausalSceneNodeData {
  [key: string]: unknown;
  readonly node: CausalSceneNode;
  readonly homeColor: string;
  /** 挂载圆点：颜色、剧情线名、主 / 辅。 */
  readonly mountDots: ReadonlyArray<{ readonly color: string; readonly name: string; readonly primary: boolean }>;
  readonly matched: boolean;
  readonly dimmed: boolean;
}

export interface CausalLaneNodeData {
  [key: string]: unknown;
  readonly lane: CausalLane;
  readonly color: string;
  readonly striped: boolean;
  /** 拖动场景经过时高亮为落点。 */
  readonly dropTarget: boolean;
}

export type CausalCanvasNode = Node<CausalSceneNodeData, "scene"> | Node<CausalLaneNodeData, "lane">;

export interface CausalEdgeData {
  [key: string]: unknown;
  readonly color: string;
  readonly label?: string;
  readonly dimmed: boolean;
}

export type CausalCanvasEdge = Edge<CausalEdgeData>;

export interface CausalFlowOptions {
  readonly selectedSceneId?: string | null;
  /** 选中泳道时只突出这条线上的场景与线路。 */
  readonly focusLaneId?: string | null;
  readonly query?: string;
  readonly dropLaneId?: string | null;
  readonly showHooks: boolean;
}

function sceneMatches(node: CausalSceneNode, query: string): boolean {
  if (!query) return false;
  const haystack = `${node.scene.title ?? ""} ${node.scene.summary ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function toCausalFlow(graph: CausalGraph, layout: CausalLayout, options: CausalFlowOptions): { nodes: CausalCanvasNode[]; edges: CausalCanvasEdge[] } {
  const query = options.query?.trim() ?? "";
  const nameOf = new Map(graph.lanes.map((lane) => [lane.id, lane.label]));
  const onFocusLane = (node: CausalSceneNode) => !options.focusLaneId || node.laneId === options.focusLaneId
    || node.mounts.some((mount) => mount.storylineId === options.focusLaneId);

  const laneNodes: CausalCanvasNode[] = graph.lanes.map((lane, index) => ({
    id: `lane:${lane.id}`,
    type: "lane",
    position: { x: 0, y: layout.laneTops.get(lane.id)! },
    data: { lane, color: laneColor(graph, lane.id), striped: index % 2 === 1, dropTarget: options.dropLaneId === lane.id },
    style: { width: layout.width, height: LANE_HEIGHT },
    selectable: false,
    draggable: false,
    connectable: false,
    focusable: false,
    zIndex: -1,
  }));

  const sceneNodes: CausalCanvasNode[] = graph.scenes.map((node) => ({
    id: node.scene.id,
    type: "scene",
    position: layout.scenePositions.get(node.scene.id)!,
    selected: options.selectedSceneId === node.scene.id,
    connectable: false,
    data: {
      node,
      homeColor: laneColor(graph, node.laneId),
      mountDots: node.mounts.map((mount) => ({
        color: laneColor(graph, mount.storylineId),
        name: nameOf.get(mount.storylineId) ?? mount.storylineId,
        primary: mount.role === "primary",
      })),
      matched: sceneMatches(node, query),
      dimmed: !onFocusLane(node),
    },
  }));

  const edges: CausalCanvasEdge[] = graph.lineLinks.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    type: "line",
    selectable: false,
    focusable: false,
    data: { color: laneColor(graph, link.storylineId), dimmed: Boolean(options.focusLaneId) && link.storylineId !== options.focusLaneId },
  }));
  if (options.showHooks) {
    for (const link of graph.hookLinks) {
      edges.push({
        id: link.id,
        source: link.source,
        target: link.target,
        type: "hook",
        selectable: false,
        focusable: false,
        data: { color: "#f59e0b", label: link.label, dimmed: Boolean(options.focusLaneId) },
      });
    }
  }
  return { nodes: [...laneNodes, ...sceneNodes], edges };
}

/** 冻结栏在屏幕上占的位置（像素）：左侧泳道名栏宽、顶部章号栏高。 */
export const RAIL_SCREEN_WIDTH = 136;
export const RULER_SCREEN_HEIGHT = 28;
const VIEW_MARGIN = 24;

const MIN_INITIAL_ZOOM = 0.55;
/** 初始视图争取看到的最近章数。 */
const RECENT_COLUMNS = 4;

/**
 * 初始视口：不把全书硬塞进画布（长篇会缩到看不清），而是
 * 缩放同时照顾泳道总高与「最近几章放得下」（不低于 0.55 倍，宁可平移也不缩到看不清），
 * 横向靠右对齐——先看到最近写的几章；内容本来就放得下时从第一章左对齐。「查看全书」再做完整适配。
 */
export function initialViewport(layout: Pick<CausalLayout, "width" | "height" | "columns">, pane: { readonly width: number; readonly height: number }) {
  const usableWidth = pane.width - RAIL_SCREEN_WIDTH - 8 - VIEW_MARGIN;
  const recentStart = layout.columns.at(-RECENT_COLUMNS)?.x ?? layout.columns[0]?.x ?? LANE_LABEL_SPACE;
  const byHeight = (pane.height - VIEW_MARGIN) / layout.height;
  const byRecentWidth = usableWidth / Math.max(1, layout.width - recentStart);
  const zoom = Math.min(1, Math.max(MIN_INITIAL_ZOOM, Math.min(byHeight, byRecentWidth)));
  const leftAligned = RAIL_SCREEN_WIDTH + 8 - LANE_LABEL_SPACE * zoom;
  const rightAligned = pane.width - VIEW_MARGIN - layout.width * zoom;
  return { x: Math.min(leftAligned, rightAligned), y: 0, zoom };
}
