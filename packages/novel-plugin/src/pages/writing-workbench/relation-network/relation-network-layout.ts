/**
 * 焦点人物网络的确定性布局（纯函数）：焦点居中，一跳在内圈，二跳在外圈、靠近把它连进来的一跳。
 *
 * 不用力导向：同一份数据每次都画在同一个位置（此前的力导向画布因为每次打开都乱跳而下线）。
 * 圈的半径随节点数增长，保证相邻节点不重叠。
 */

import type { Edge, Node } from "@xyflow/react";

import type { RelationPolarityLabel } from "../../../engine/narrative-entity/relation-graph";

export const NETWORK_NODE_WIDTH = 132;
export const NETWORK_NODE_HEIGHT = 40;
const RING_GAP = 210;
const MIN_INNER_RADIUS = 220;
/** 同圈相邻节点中心之间至少留这么宽（节点宽 + 空隙）。 */
const ARC_SPACING = NETWORK_NODE_WIDTH + 36;

/** 与服务端 NetworkNode / NetworkEdge 对齐的最小形状（前端只读这些字段）。 */
export interface NetworkNodeInput {
  readonly id: string;
  readonly entryId: string | null;
  readonly name: string;
  readonly type: string;
  readonly hop: 0 | 1 | 2;
  readonly via: string | null;
  readonly degree: number;
}

export interface NetworkEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly predicates: readonly string[];
  readonly relationCount: number;
  readonly latestPredicate: string;
  readonly latestPolarity: { readonly score: number | null; readonly label: RelationPolarityLabel };
  readonly sharedEvents: number;
  readonly trend: string;
}

export interface NetworkInput {
  readonly focusId: string;
  readonly nodes: readonly NetworkNodeInput[];
  readonly edges: readonly NetworkEdgeInput[];
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 节点中心坐标。 */
export function layoutEgoNetwork(network: NetworkInput): Map<string, Point> {
  const positions = new Map<string, Point>();
  const focus = network.nodes.find((node) => node.id === network.focusId) ?? network.nodes[0];
  if (!focus) return positions;
  positions.set(focus.id, { x: 0, y: 0 });

  const first = network.nodes.filter((node) => node.hop === 1);
  const second = network.nodes.filter((node) => node.hop === 2);
  if (first.length === 0) return positions;

  const innerRadius = Math.max(MIN_INNER_RADIUS, (first.length * ARC_SPACING) / (2 * Math.PI));
  const sector = (2 * Math.PI) / first.length;
  const angleOf = new Map<string, number>();
  first.forEach((node, index) => {
    // 从正上方开始顺时针排：权重最高的一跳在 12 点方向。
    const angle = -Math.PI / 2 + index * sector;
    angleOf.set(node.id, angle);
    positions.set(node.id, { x: Math.cos(angle) * innerRadius, y: Math.sin(angle) * innerRadius });
  });

  const children = new Map<string, NetworkNodeInput[]>();
  for (const node of second) {
    const hub = node.via && angleOf.has(node.via) ? node.via : first[0]!.id;
    children.set(hub, [...(children.get(hub) ?? []), node]);
  }
  // 外圈半径：每个扇区里的二跳都要排得下（扇区用九成，给相邻扇区留缝）。
  const usable = sector * 0.9;
  const busiest = Math.max(0, ...[...children.values()].map((list) => list.length));
  const outerRadius = Math.max(innerRadius + RING_GAP, busiest > 1 ? (busiest * ARC_SPACING) / usable : 0);
  for (const hub of first) {
    const list = children.get(hub.id) ?? [];
    const center = angleOf.get(hub.id)!;
    list.forEach((node, index) => {
      const offset = list.length === 1 ? 0 : usable * ((index + 0.5) / list.length - 0.5);
      const angle = center + offset;
      positions.set(node.id, { x: Math.cos(angle) * outerRadius, y: Math.sin(angle) * outerRadius });
    });
  }
  return positions;
}

export interface RelationNodeData {
  [key: string]: unknown;
  readonly node: NetworkNodeInput;
  readonly selected: boolean;
  readonly dimmed: boolean;
}

export interface RelationEdgeData {
  [key: string]: unknown;
  readonly edge: NetworkEdgeInput;
  readonly selected: boolean;
  readonly dimmed: boolean;
  /** 是否常显谓词标签（与焦点相连的边、或被选中的边）。 */
  readonly showLabel: boolean;
}

export type RelationFlowNode = Node<RelationNodeData, "entity">;
export type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

export type NetworkSelection =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "edge"; readonly id: string }
  | null;

export function toRelationFlow(network: NetworkInput, selection: NetworkSelection): { nodes: RelationFlowNode[]; edges: RelationFlowEdge[] } {
  const positions = layoutEgoNetwork(network);
  const selectedNode = selection?.kind === "node" ? selection.id : null;
  const selectedEdge = selection?.kind === "edge" ? selection.id : null;
  const neighborhood = new Set<string>();
  if (selectedNode) {
    neighborhood.add(selectedNode);
    for (const edge of network.edges) {
      if (edge.source === selectedNode) neighborhood.add(edge.target);
      if (edge.target === selectedNode) neighborhood.add(edge.source);
    }
  }
  const edgeEnds = selectedEdge ? network.edges.find((edge) => edge.id === selectedEdge) : undefined;

  const nodes = network.nodes.flatMap((node): RelationFlowNode[] => {
    const center = positions.get(node.id);
    if (!center) return [];
    const dimmed = selectedNode ? !neighborhood.has(node.id) : edgeEnds ? node.id !== edgeEnds.source && node.id !== edgeEnds.target : false;
    return [{
      id: node.id,
      type: "entity",
      position: { x: center.x - NETWORK_NODE_WIDTH / 2, y: center.y - NETWORK_NODE_HEIGHT / 2 },
      draggable: false,
      connectable: false,
      data: { node, selected: node.id === selectedNode, dimmed },
    }];
  });
  const edges = network.edges.map((edge): RelationFlowEdge => {
    const touchesFocus = edge.source === network.focusId || edge.target === network.focusId;
    const dimmed = selectedNode ? edge.source !== selectedNode && edge.target !== selectedNode : selectedEdge ? edge.id !== selectedEdge : false;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "relation",
      data: { edge, selected: edge.id === selectedEdge, dimmed, showLabel: (touchesFocus && !dimmed) || edge.id === selectedEdge },
    };
  });
  return { nodes, edges };
}

/** 画布坐标范围（含节点尺寸），供初始视口把整张网放进来。 */
export function networkBounds(positions: ReadonlyMap<string, Point>): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = [...positions.values()].map((point) => point.x);
  const ys = [...positions.values()].map((point) => point.y);
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...xs) - NETWORK_NODE_WIDTH / 2,
    maxX: Math.max(...xs) + NETWORK_NODE_WIDTH / 2,
    minY: Math.min(...ys) - NETWORK_NODE_HEIGHT / 2,
    maxY: Math.max(...ys) + NETWORK_NODE_HEIGHT / 2,
  };
}
