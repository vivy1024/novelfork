/**
 * 工作流画布的纯逻辑：图结构 ⇄ React Flow 节点 / 连线，以及画布手势到编辑指令的换算。
 *
 * 画布上的每一次结构改动都换算成 applyWorkflowOps 的编辑指令——与叙述者用的是同一套指令与校验，
 * 作者和叙述者看到的结构问题永远一致。节点位置只是画布排版，不经过编辑指令。
 */

import type { Edge, Node } from "@xyflow/react";

import type { NovelWorkflowStepKind } from "../../../engine/workflows/novel-workflows.js";
import {
  END_NODE_ID,
  forwardDescendants,
  LAYOUT_LANE_GAP,
  LAYOUT_RANK_GAP,
  layoutWorkflowGraph,
  requiresAuthorDecision,
  START_NODE_ID,
  type WorkflowGraphEdge,
  type WorkflowGraphIssue,
  type WorkflowGraphNode,
  type WorkflowGraphOp,
  type WorkflowGraphRecipe,
  type WorkflowNodePosition,
  type WorkflowNodeType,
  WORKFLOW_NODE_WIDTH,
} from "../../../engine/workflows/workflow-graph.js";

export const STEP_KIND_LABEL: Record<NovelWorkflowStepKind, string> = {
  "context-load": "读取上下文",
  "guided-plan": "镜头蓝图",
  "approval-gate": "人工门禁",
  "writer-generate": "起草正文",
  "adversarial-audit": "对抗审查",
  audit: "审查",
  "post-settlement": "章后结算",
  "canvas-open": "结果整理",
  "custom-tool": "自定义工具",
};

export const STEP_KINDS = Object.keys(STEP_KIND_LABEL) as NovelWorkflowStepKind[];

/** 运行中工序的状态（与 run-state-machine 的 WorkflowStepStatus 一致）。 */
export type CanvasRunStatus = "pending" | "running" | "awaiting_approval" | "done" | "skipped" | "bypassed" | "failed";

export interface CanvasRunStep {
  readonly stepId: string;
  readonly status: CanvasRunStatus;
  readonly outcome?: string;
  readonly attempt: number;
}

export interface WorkflowCanvasNodeData {
  [key: string]: unknown;
  readonly node: WorkflowGraphNode;
  readonly issues: readonly WorkflowGraphIssue[];
  /** 工序能否被作者打回：能的话画出「打回」连接点。 */
  readonly canReject: boolean;
  readonly run?: CanvasRunStep;
  readonly editable: boolean;
}

export type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, WorkflowNodeType>;

export interface WorkflowCanvasEdgeData {
  [key: string]: unknown;
  readonly edge: WorkflowGraphEdge;
  readonly issues: readonly WorkflowGraphIssue[];
  /** 运行叠加：这条线已被走过 / 因分支未选中而作废。 */
  readonly runState?: "taken" | "dead";
}

export type WorkflowCanvasEdge = Edge<WorkflowCanvasEdgeData>;

/**
 * 连接点 id（流程自上而下）：顶部入口、底部「下一步」；
 * 工序右侧一对「打回」连接点——出口在需要确认的工序上，入口在每道工序上，打回线沿右侧绕回上游。
 */
export const HANDLE_IN = "in";
export const HANDLE_NEXT = "next";
export const HANDLE_REJECT = "reject";
export const HANDLE_REJECT_IN = "reject-in";

export type CanvasSelection = { readonly kind: "node" | "edge"; readonly id: string } | null;

/** 画布只需要图的结构与排版；运行快照没有方案的其他字段。 */
export type WorkflowGraphShape = Pick<WorkflowGraphRecipe, "nodes" | "edges" | "layout">;

/** 已保存位置 + 缺位置的节点自动补位。 */
export function positionsOf(recipe: WorkflowGraphShape): Record<string, WorkflowNodePosition> {
  return layoutWorkflowGraph(recipe);
}

export function toCanvasNodes(
  recipe: WorkflowGraphShape,
  issues: readonly WorkflowGraphIssue[],
  options: { readonly editable: boolean; readonly runSteps?: readonly CanvasRunStep[]; readonly selectedId?: string | null },
): WorkflowCanvasNode[] {
  const positions = positionsOf(recipe);
  return recipe.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: positions[node.id] ?? { x: 0, y: 0 },
    selected: options.selectedId === node.id,
    deletable: options.editable && node.id !== START_NODE_ID,
    draggable: options.editable,
    connectable: options.editable,
    data: {
      node,
      issues: issues.filter((issue) => issue.nodeId === node.id),
      canReject: node.type === "step" && requiresAuthorDecision(node),
      editable: options.editable,
      ...(options.runSteps ? { run: options.runSteps.find((step) => step.stepId === node.id) } : {}),
    },
  }));
}

function edgeRunState(edge: WorkflowGraphEdge, runSteps: readonly CanvasRunStep[] | undefined): "taken" | "dead" | undefined {
  if (!runSteps || edge.kind !== "next") return undefined;
  const target = runSteps.find((step) => step.stepId === edge.target);
  if (target?.status === "bypassed") return "dead";
  const source = runSteps.find((step) => step.stepId === edge.source);
  const sourceSettled = edge.source === START_NODE_ID || source?.status === "done" || source?.status === "skipped";
  if (!sourceSettled) return undefined;
  // 分支工序只有选中的那条（或默认线）算走过。
  if (edge.outcome !== undefined && source?.outcome !== undefined && edge.outcome !== source.outcome) return "dead";
  return "taken";
}

export function toCanvasEdges(
  recipe: WorkflowGraphShape,
  issues: readonly WorkflowGraphIssue[],
  options: { readonly runSteps?: readonly CanvasRunStep[]; readonly selectedId?: string | null; readonly editable: boolean },
): WorkflowCanvasEdge[] {
  const typeOf = new Map(recipe.nodes.map((node) => [node.id, node.type]));
  return recipe.edges.map((edge) => {
    const runState = edgeRunState(edge, options.runSteps);
    // 打回线只画在「工序 → 工序」之间；指向别的节点属于结构问题，退回普通入口照样画出来。
    const isReject = edge.kind === "reject";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: isReject && typeOf.get(edge.source) === "step" ? HANDLE_REJECT : HANDLE_NEXT,
      targetHandle: isReject && typeOf.get(edge.target) === "step" ? HANDLE_REJECT_IN : HANDLE_IN,
      type: "workflow",
      selected: options.selectedId === edge.id,
      deletable: options.editable,
      data: {
        edge,
        issues: issues.filter((issue) => issue.edgeId === edge.id),
        ...(runState ? { runState } : {}),
      },
    };
  });
}

// ─── 手势 → 编辑指令 ─────────────────────────────────────────────────────────

/** 从画布拖出的连线：底部连接点是「下一步」，右侧连接点是「打回」。 */
export function connectionToOp(connection: { source: string | null; target: string | null; sourceHandle?: string | null }): WorkflowGraphOp | null {
  if (!connection.source || !connection.target || connection.source === connection.target) return null;
  return {
    op: "connect",
    source: connection.source,
    target: connection.target,
    kind: connection.sourceHandle === HANDLE_REJECT ? "reject" : "next",
  };
}

export const NEW_NODE_LABEL: Record<Exclude<WorkflowNodeType, "start">, string> = {
  step: "新工序",
  join: "汇合",
  end: "完成",
};

/**
 * 添加节点。选中了一个节点时接在它后面：它原本只有一条无条件的下一步连线时，
 * 新节点插进这条线中间（A → B 变成 A → 新 → B）；否则只从它连一条线到新节点。
 */
export function addNodeOps(
  recipe: WorkflowGraphRecipe,
  type: Exclude<WorkflowNodeType, "start">,
  newId: string,
  after: string | null,
): WorkflowGraphOp[] {
  const node = type === "step"
    ? { type, id: newId, label: NEW_NODE_LABEL.step, kind: "custom-tool" as const, enabled: true }
    : { type, id: newId, label: NEW_NODE_LABEL[type] };
  const ops: WorkflowGraphOp[] = [{ op: "add_node", node }];
  const anchor = after ? recipe.nodes.find((candidate) => candidate.id === after) : undefined;
  if (!anchor || anchor.type === "end") return ops;
  const outs = recipe.edges.filter((edge) => edge.source === anchor.id && edge.kind === "next");
  const only = outs.length === 1 && outs[0]!.outcome === undefined ? outs[0]! : undefined;
  if (only && type !== "end") {
    ops.push(
      { op: "disconnect", id: only.id },
      { op: "connect", source: anchor.id, target: newId },
      { op: "connect", source: newId, target: only.target },
    );
  } else {
    ops.push({ op: "connect", source: anchor.id, target: newId });
  }
  return ops;
}

/** 给新节点一个不冲突的 id：step-1、step-2…… */
export function nextNodeId(recipe: WorkflowGraphRecipe, type: Exclude<WorkflowNodeType, "start">): string {
  const taken = new Set([...recipe.nodes.map((node) => node.id), ...recipe.edges.map((edge) => edge.id)]);
  const prefix = type === "end" ? "end" : type;
  let n = recipe.nodes.filter((node) => node.type === type).length + 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/**
 * 加节点后的排版：新节点放在锚点正下方（中心对齐）。
 * 插进一条线中间时，原来在它下游的节点整体下移一层，给新节点腾位置；
 * 只是接出一条新线时不动别的节点，新节点避开已占位置向右找空位。没有锚点时放在全图下方。
 */
export function placeNewNode(
  before: WorkflowGraphRecipe,
  after: WorkflowGraphRecipe,
  newId: string,
  anchorId: string | null,
): Record<string, WorkflowNodePosition> {
  const positions = { ...positionsOf(before) };
  const newType = after.nodes.find((node) => node.id === newId)?.type ?? "step";
  const width = WORKFLOW_NODE_WIDTH[newType];
  const anchor = anchorId ? positions[anchorId] : undefined;
  const anchorType = before.nodes.find((node) => node.id === anchorId)?.type ?? "step";
  if (!anchor) {
    const all = Object.values(positions);
    positions[newId] = all.length === 0
      ? { x: 0, y: 0 }
      : { x: Math.min(...all.map((pos) => pos.x)), y: Math.max(...all.map((pos) => pos.y)) + LAYOUT_RANK_GAP };
    return positions;
  }
  const spot = { x: anchor.x + (WORKFLOW_NODE_WIDTH[anchorType] - width) / 2, y: anchor.y + LAYOUT_RANK_GAP };
  const split = before.edges.some((edge) => edge.source === anchorId && edge.kind === "next")
    && !after.edges.some((edge) => edge.source === anchorId && edge.kind === "next" && edge.target !== newId);
  if (split) {
    for (const id of forwardDescendants(after, newId)) {
      const pos = positions[id];
      if (pos && pos.y >= spot.y) positions[id] = { x: pos.x, y: pos.y + LAYOUT_RANK_GAP };
    }
    positions[newId] = spot;
    return positions;
  }
  const others = Object.values(positions);
  const occupied = (x: number) => others.some((pos) => Math.abs(pos.x - x) < LAYOUT_LANE_GAP / 2 && Math.abs(pos.y - spot.y) < LAYOUT_RANK_GAP / 2);
  let x = spot.x;
  while (occupied(x)) x += LAYOUT_LANE_GAP;
  positions[newId] = { x, y: spot.y };
  return positions;
}

/** 修改连线（类型 / 结果条件）：没有 update_edge 指令，就断开后以新属性重连。 */
export function updateEdgeOps(edge: WorkflowGraphEdge, patch: { kind?: "next" | "reject"; outcome?: string | null }): WorkflowGraphOp[] {
  const kind = patch.kind ?? edge.kind;
  const outcome = kind === "reject" ? undefined : patch.outcome === null ? undefined : patch.outcome ?? edge.outcome;
  return [
    { op: "disconnect", id: edge.id },
    { op: "connect", source: edge.source, target: edge.target, kind, ...(outcome !== undefined ? { outcome } : {}) },
  ];
}

/** 找出一批指令新增的那个节点 / 连线 id，便于把选中状态跟过去。 */
export function addedId(before: WorkflowGraphRecipe, after: WorkflowGraphRecipe, kind: "node" | "edge"): string | null {
  const list = kind === "node" ? after.nodes : after.edges;
  const known = new Set((kind === "node" ? before.nodes : before.edges).map((item) => item.id));
  return list.find((item) => !known.has(item.id))?.id ?? null;
}

/** 空白方案：只有起点与终点，等作者往里加工序。 */
export function blankRecipe(id: string, name: string): WorkflowGraphRecipe {
  return {
    schemaVersion: 2,
    id,
    name,
    commandId: `/novel:${id}`,
    description: "",
    status: "draft",
    revision: 0,
    createdBy: "author",
    nodes: [
      { id: START_NODE_ID, type: "start", label: "开始" },
      { id: END_NODE_ID, type: "end", label: "完成" },
    ],
    edges: [{ id: `e-${START_NODE_ID}-${END_NODE_ID}`, source: START_NODE_ID, target: END_NODE_ID, kind: "next" }],
    resultStrategy: "formal-chapter",
    maxRetries: 1,
    layout: { positions: { [START_NODE_ID]: { x: 0, y: 0 }, [END_NODE_ID]: { x: 0, y: LAYOUT_RANK_GAP } } },
  };
}

/** 复制一份方案为草稿（新 id、第 0 版、清掉画布外的发布状态）。 */
export function copyRecipe(source: WorkflowGraphRecipe, id: string, name: string): WorkflowGraphRecipe {
  return { ...source, id, name, commandId: `/novel:${id}`, status: "draft", revision: 0, createdBy: "author" };
}

export function uniqueRecipeId(base: string, taken: ReadonlySet<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
  return id;
}

/** 逗号 / 顿号 / 换行分隔的列表 ⇄ 字符串数组（工具、技能、分支结果的输入框用）。 */
export function parseList(text: string): string[] {
  return text.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
}
