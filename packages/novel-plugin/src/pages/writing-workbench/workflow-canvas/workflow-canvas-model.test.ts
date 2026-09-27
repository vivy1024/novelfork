import { describe, expect, it } from "vitest";

import { FANQIE_XUANHUAN_SERIAL_RECIPE } from "../../../engine/workflows/novel-workflows.js";
import {
  applyWorkflowOps,
  checkWorkflowGraph,
  LAYOUT_LANE_GAP,
  LAYOUT_RANK_GAP,
  type WorkflowGraphRecipe,
} from "../../../engine/workflows/workflow-graph.js";
import {
  addNodeOps,
  blankRecipe,
  connectionToOp,
  copyRecipe,
  HANDLE_REJECT,
  HANDLE_REJECT_IN,
  nextNodeId,
  placeNewNode,
  positionsOf,
  toCanvasEdges,
  toCanvasNodes,
  uniqueRecipeId,
  updateEdgeOps,
} from "./workflow-canvas-model";

function apply(recipe: WorkflowGraphRecipe, ops: Parameters<typeof applyWorkflowOps>[1]): WorkflowGraphRecipe {
  const result = applyWorkflowOps(recipe, ops);
  if (!result.ok) throw new Error(result.explanation.what);
  return result.recipe;
}

/** 起点 → 审查（通过 / 不通过）→ 通过去终点，不通过去返修 → 返修去终点；审查需要确认并可打回到起草。 */
function branchingRecipe(): WorkflowGraphRecipe {
  return apply(blankRecipe("branchy", "分支流"), [
    { op: "disconnect", source: "start", target: "end" },
    { op: "add_node", node: { type: "step", id: "draft", label: "起草", kind: "writer-generate" } },
    { op: "add_node", node: { type: "step", id: "audit", label: "审查", kind: "audit", outcomes: ["通过", "不通过"], requiresApproval: true } },
    { op: "add_node", node: { type: "step", id: "fix", label: "返修", kind: "writer-generate" } },
    { op: "add_node", node: { type: "join", id: "join-1", label: "汇合" } },
    { op: "connect", source: "start", target: "draft" },
    { op: "connect", source: "draft", target: "audit" },
    { op: "connect", source: "audit", target: "join-1", outcome: "通过", id: "e-pass" },
    { op: "connect", source: "audit", target: "fix", outcome: "不通过", id: "e-fail" },
    { op: "connect", source: "fix", target: "join-1" },
    { op: "connect", source: "join-1", target: "end" },
    { op: "connect", source: "audit", target: "draft", kind: "reject", id: "e-reject" },
  ]);
}

describe("工作流画布模型", () => {
  it("空白方案：只有起点与终点，起点不能删", () => {
    const recipe = blankRecipe("x", "新工作流");
    expect(recipe.status).toBe("draft");
    expect(recipe.revision).toBe(0);
    const nodes = toCanvasNodes(recipe, [], { editable: true });
    expect(nodes.map((node) => node.id)).toEqual(["start", "end"]);
    expect(nodes.find((node) => node.id === "start")!.deletable).toBe(false);
    expect(nodes.find((node) => node.id === "end")!.deletable).toBe(true);
  });

  it("节点带上各自的结构问题；需要确认的工序可以打回", () => {
    const recipe = apply(branchingRecipe(), [{ op: "disconnect", id: "e-fail" }]);
    const issues = checkWorkflowGraph(recipe);
    const nodes = toCanvasNodes(recipe, issues, { editable: true });
    const audit = nodes.find((node) => node.id === "audit")!;
    expect(audit.data.canReject).toBe(true);
    expect(audit.data.issues.map((issue) => issue.code)).toContain("outcome-uncovered");
    expect(nodes.find((node) => node.id === "draft")!.data.canReject).toBe(false);
  });

  it("打回线从工序右侧的打回出口连到上游工序右侧的打回入口", () => {
    const edges = toCanvasEdges(branchingRecipe(), [], { editable: true });
    expect(edges.find((edge) => edge.id === "e-reject")).toMatchObject({ sourceHandle: HANDLE_REJECT, targetHandle: HANDLE_REJECT_IN });
    expect(edges.find((edge) => edge.id === "e-pass")).toMatchObject({ sourceHandle: "next", targetHandle: "in" });
  });

  it("打回线指向非工序节点（结构问题）时退回普通连接点，照样画出来", () => {
    const recipe = apply(branchingRecipe(), [{ op: "connect", source: "audit", target: "start", kind: "reject", id: "e-bad" }]);
    expect(toCanvasEdges(recipe, [], { editable: true }).find((edge) => edge.id === "e-bad")).toMatchObject({ targetHandle: "in" });
  });

  it("运行叠加：走过的线标为已走，未选中的分支线与通往未走到工序的线标为作废", () => {
    const recipe = branchingRecipe();
    const edges = toCanvasEdges(recipe, [], {
      editable: false,
      runSteps: [
        { stepId: "draft", status: "done", attempt: 1 },
        { stepId: "audit", status: "done", attempt: 1, outcome: "通过" },
        { stepId: "fix", status: "bypassed", attempt: 0 },
      ],
    });
    const state = (id: string) => edges.find((edge) => edge.id === id)!.data!.runState;
    expect(state("e-pass")).toBe("taken");
    expect(state("e-fail")).toBe("dead");
    expect(state("e-reject")).toBeUndefined();
    const nodes = toCanvasNodes(recipe, [], { editable: false, runSteps: [{ stepId: "audit", status: "done", attempt: 1, outcome: "通过" }] });
    expect(nodes.find((node) => node.id === "audit")!.data.run).toMatchObject({ outcome: "通过" });
    expect(nodes.every((node) => node.draggable === false && node.connectable === false)).toBe(true);
  });

  it("从画布拖线：右侧连接点连下一步，底部连接点连打回，连向自己忽略", () => {
    expect(connectionToOp({ source: "a", target: "b", sourceHandle: "next" })).toEqual({ op: "connect", source: "a", target: "b", kind: "next" });
    expect(connectionToOp({ source: "a", target: "b", sourceHandle: HANDLE_REJECT })).toMatchObject({ kind: "reject" });
    expect(connectionToOp({ source: "a", target: "a" })).toBeNull();
    expect(connectionToOp({ source: null, target: "a" })).toBeNull();
  });

  it("选中一道只有一条出线的工序再加工序：新工序插进这条线中间", () => {
    const recipe = FANQIE_XUANHUAN_SERIAL_RECIPE;
    const id = nextNodeId(recipe, "step");
    const next = apply(recipe, addNodeOps(recipe, "step", id, "step-context"));
    const outs = next.edges.filter((edge) => edge.source === "step-context" && edge.kind === "next").map((edge) => edge.target);
    expect(outs).toEqual([id]);
    const original = recipe.edges.find((edge) => edge.source === "step-context" && edge.kind === "next")!.target;
    expect(next.edges.some((edge) => edge.source === id && edge.target === original)).toBe(true);
    expect(checkWorkflowGraph(next)).toEqual([]);
  });

  it("锚点已有多条出线（分支）时只连一条新线，不拆原有分支", () => {
    const recipe = branchingRecipe();
    const next = apply(recipe, addNodeOps(recipe, "step", nextNodeId(recipe, "step"), "audit"));
    expect(next.edges.filter((edge) => edge.id === "e-pass" || edge.id === "e-fail")).toHaveLength(2);
    expect(next.edges.filter((edge) => edge.source === "audit" && edge.kind === "next")).toHaveLength(3);
  });

  it("新节点 id 不与已有 id 冲突", () => {
    expect(nextNodeId(branchingRecipe(), "join")).toBe("join-2");
    expect(nextNodeId(blankRecipe("x", "空"), "step")).toBe("step-1");
  });

  it("插进一条线中间：新节点落在锚点正下方，原下游整体下移一层", () => {
    const before = blankRecipe("x", "空");
    const after = apply(before, addNodeOps(before, "step", "step-1", "start"));
    const positions = placeNewNode(before, after, "step-1", "start");
    const old = positionsOf(before);
    expect(positions["step-1"]!.y).toBe(old.start!.y + LAYOUT_RANK_GAP);
    // 起点窄、工序宽：中心对齐
    expect(positions["step-1"]!.x + 104).toBe(old.start!.x + 56);
    expect(positions.end!.y).toBe(old.end!.y + LAYOUT_RANK_GAP);
  });

  it("从分支工序接出新线：不动别的节点，新节点向右找空位；没有锚点时放到全图下方", () => {
    const before = branchingRecipe();
    const after = apply(before, addNodeOps(before, "step", "step-9", "audit"));
    const old = positionsOf(before);
    const positions = placeNewNode(before, after, "step-9", "audit");
    for (const id of Object.keys(old)) expect(positions[id]).toEqual(old[id]);
    expect(positions["step-9"]!.y).toBe(old.audit!.y + LAYOUT_RANK_GAP);
    expect(Object.entries(old).every(([, pos]) => pos.y !== positions["step-9"]!.y || Math.abs(pos.x - positions["step-9"]!.x) >= LAYOUT_LANE_GAP / 2)).toBe(true);

    const lone = apply(before, [{ op: "add_node", node: { type: "join", id: "join-9", label: "汇合" } }]);
    const bottom = Math.max(...Object.values(old).map((pos) => pos.y));
    expect(placeNewNode(before, lone, "join-9", null)["join-9"]!.y).toBe(bottom + LAYOUT_RANK_GAP);
  });

  it("修改连线条件：断开后按新条件重连；改成打回线时去掉条件", () => {
    const recipe = branchingRecipe();
    const edge = recipe.edges.find((candidate) => candidate.id === "e-pass")!;
    const toDefault = apply(recipe, updateEdgeOps(edge, { outcome: null }));
    expect(toDefault.edges.find((candidate) => candidate.source === "audit" && candidate.target === "join-1")!.outcome).toBeUndefined();
    const toReject = updateEdgeOps(edge, { kind: "reject" });
    expect(toReject[1]).toEqual({ op: "connect", source: "audit", target: "join-1", kind: "reject" });
  });

  it("复制方案成为作者的草稿；方案 id 按已有 id 去重", () => {
    const copy = copyRecipe(FANQIE_XUANHUAN_SERIAL_RECIPE, "copy", "副本");
    expect(copy).toMatchObject({ id: "copy", status: "draft", revision: 0, createdBy: "author", commandId: "/novel:copy" });
    expect(copy.nodes).toEqual(FANQIE_XUANHUAN_SERIAL_RECIPE.nodes);
    expect(uniqueRecipeId("Workflow", new Set(["workflow", "workflow-2"]))).toBe("workflow-3");
    expect(uniqueRecipeId("悬疑流", new Set())).toBe("workflow");
  });
});
