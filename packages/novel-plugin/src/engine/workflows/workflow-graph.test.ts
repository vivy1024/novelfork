import { describe, expect, it } from "vitest";

import { FANQIE_XUANHUAN_SERIAL_RECIPE, NOVEL_BUILTIN_WORKFLOWS } from "./novel-workflows.js";
import {
  applyWorkflowOps,
  checkWorkflowGraph,
  forwardDescendants,
  layoutWorkflowGraph,
  linearRecipeToGraph,
  LAYOUT_COLUMN_GAP,
  topologicalOrder,
  type LegacyWorkflowRecipe,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowGraphRecipe,
} from "./workflow-graph.js";

function recipe(nodes: WorkflowGraphNode[], edges: Array<Omit<WorkflowGraphEdge, "id" | "kind"> & Partial<WorkflowGraphEdge>>): WorkflowGraphRecipe {
  return {
    schemaVersion: 2,
    id: "r",
    name: "测试",
    commandId: "/test",
    description: "",
    status: "draft",
    revision: 1,
    nodes,
    edges: edges.map((edge, index) => ({ id: edge.id ?? `e${index}`, kind: edge.kind ?? "next", ...edge })),
    resultStrategy: "formal-chapter",
    maxRetries: 1,
  };
}

const start: WorkflowGraphNode = { id: "start", type: "start", label: "开始" };
const end: WorkflowGraphNode = { id: "end", type: "end", label: "完成" };
const step = (id: string, extra: Record<string, unknown> = {}): WorkflowGraphNode =>
  ({ id, type: "step", label: id, kind: "custom-tool", enabled: true, ...extra }) as WorkflowGraphNode;
const codes = (r: WorkflowGraphRecipe) => checkWorkflowGraph(r).map((issue) => issue.code).sort();

describe("linearRecipeToGraph", () => {
  it("线性方案转成 起点 → 工序… → 终点 的链，终审并入最后一道启用的工序", () => {
    const legacy: LegacyWorkflowRecipe = {
      id: "legacy",
      name: "旧方案",
      commandId: "/legacy",
      description: "",
      steps: [
        { id: "a", kind: "context-load", label: "A", enabled: true },
        { id: "b", kind: "writer-generate", label: "B", enabled: true },
        { id: "c", kind: "audit", label: "C（停用）", enabled: false },
      ],
      resultStrategy: "formal-chapter",
      requireFinalApproval: true,
      maxRetries: 2,
    };
    const graph = linearRecipeToGraph(legacy);
    expect(graph.status).toBe("published");
    expect(graph.nodes.map((node) => node.id)).toEqual(["start", "a", "b", "c", "end"]);
    expect(graph.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual(["start>a", "a>b", "b>c", "c>end"]);
    const b = graph.nodes.find((node) => node.id === "b") as { requiresApproval?: boolean };
    const c = graph.nodes.find((node) => node.id === "c") as { requiresApproval?: boolean };
    expect(b.requiresApproval).toBe(true);
    expect(c.requiresApproval).toBeUndefined();
    expect(checkWorkflowGraph(graph)).toEqual([]);
  });

  it("三个内置方案转换后都能直接发布", () => {
    for (const builtin of NOVEL_BUILTIN_WORKFLOWS) {
      const graph = "steps" in builtin ? linearRecipeToGraph(builtin as unknown as LegacyWorkflowRecipe) : (builtin as unknown as WorkflowGraphRecipe);
      expect(checkWorkflowGraph(graph), builtin.id).toEqual([]);
    }
    expect(FANQIE_XUANHUAN_SERIAL_RECIPE.id).toBe("fanqie-xuanhuan-serial");
  });
});

describe("checkWorkflowGraph", () => {
  it("并行分叉 + 汇合是合法的", () => {
    const r = recipe([start, step("plan"), step("draft"), step("research"), { id: "join", type: "join", label: "汇合" }, step("audit"), end], [
      { source: "start", target: "plan" },
      { source: "plan", target: "draft" },
      { source: "plan", target: "research" },
      { source: "draft", target: "join" },
      { source: "research", target: "join" },
      { source: "join", target: "audit" },
      { source: "audit", target: "end" },
    ]);
    expect(checkWorkflowGraph(r)).toEqual([]);
    expect(topologicalOrder(r)?.indexOf("join")).toBeGreaterThan(topologicalOrder(r)!.indexOf("research"));
  });

  it("多条分支直接汇到一道工序时要求加汇合", () => {
    const r = recipe([start, step("a"), step("b"), step("c"), end], [
      { source: "start", target: "a" },
      { source: "start", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "c" },
      { source: "c", target: "end" },
    ]);
    expect(codes(r)).toEqual(["step-multi-input"]);
  });

  it("「下一步」连线成环被拒，并给出三段说明", () => {
    const r = recipe([start, step("a"), step("b"), end], [
      { source: "start", target: "a" },
      { source: "a", target: "b" },
      { source: "b", target: "a" },
      { source: "b", target: "end" },
    ]);
    const cycle = checkWorkflowGraph(r).find((item) => item.code === "cycle");
    expect(cycle?.explanation.action).toContain("打回");
  });

  it("分支工序：每种结果都要有去处，连线条件必须是已声明的结果", () => {
    const audit = step("audit", { outcomes: ["通过", "不通过"] });
    const ok = recipe([start, audit, step("fix"), { id: "join", type: "join", label: "汇合" }, end], [
      { source: "start", target: "audit" },
      { source: "audit", target: "join", outcome: "通过" },
      { source: "audit", target: "fix", outcome: "不通过" },
      { source: "fix", target: "join" },
      { source: "join", target: "end" },
    ]);
    expect(checkWorkflowGraph(ok)).toEqual([]);

    const uncovered = recipe([start, audit, end], [
      { source: "start", target: "audit" },
      { source: "audit", target: "end", outcome: "通过" },
      { source: "audit", target: "end", outcome: "未知" },
    ]);
    expect(codes(uncovered)).toEqual(["outcome-uncovered", "outcome-unknown"]);

    const disabledBranch = recipe([start, step("audit", { outcomes: ["通过"], enabled: false }), end], [
      { source: "start", target: "audit" },
      { source: "audit", target: "end", outcome: "通过" },
    ]);
    expect(codes(disabledBranch)).toEqual(["branch-disabled"]);
  });

  it("打回线只能从需要确认的工序指回正向上游", () => {
    const base = [start, step("plan"), step("draft"), step("audit", { requiresApproval: true }), end];
    const chain = [
      { source: "start", target: "plan" },
      { source: "plan", target: "draft" },
      { source: "draft", target: "audit" },
      { source: "audit", target: "end" },
    ];
    expect(checkWorkflowGraph(recipe(base, [...chain, { source: "audit", target: "plan", kind: "reject" }]))).toEqual([]);
    expect(codes(recipe(base, [...chain, { source: "draft", target: "plan", kind: "reject" }]))).toEqual(["reject-source"]);
    expect(codes(recipe(base, [...chain, { source: "audit", target: "end", kind: "reject" }]))).toEqual(["reject-target"]);
    const sideBranch = recipe([...base, step("side")], [...chain, { source: "start", target: "side" }, { source: "side", target: "end" }, { source: "audit", target: "side", kind: "reject" }]);
    expect(codes(sideBranch)).toEqual(["reject-not-upstream"]);
  });

  it("断开的流程与缺起点、终点都会被逐条指出", () => {
    const r = recipe([step("a"), step("b")], [{ source: "a", target: "b" }]);
    expect(codes(r)).toEqual(expect.arrayContaining(["start-count", "no-end", "step-unreached", "step-dangling"]));
  });
});

describe("applyWorkflowOps", () => {
  const empty = recipe([start, end], []);

  it("用指令从空白搭出一条可发布的流程", () => {
    const result = applyWorkflowOps(empty, [
      { op: "add_node", node: { type: "step", id: "plan", label: "写蓝图", kind: "guided-plan", tools: ["scene.spec"] } },
      { op: "add_node", node: { type: "step", id: "draft", label: "起草", kind: "writer-generate", requiresApproval: true } },
      { op: "connect", source: "start", target: "plan" },
      { op: "connect", source: "plan", target: "draft" },
      { op: "connect", source: "draft", target: "end" },
      { op: "connect", source: "draft", target: "plan", kind: "reject" },
      { op: "set_meta", patch: { name: "新流程" } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toEqual([]);
    expect(result.recipe.name).toBe("新流程");
    expect(result.recipe.edges.filter((edge) => edge.kind === "reject")).toHaveLength(1);
  });

  it("一批指令里有一条不合法时整批不生效，并指出是第几条", () => {
    const result = applyWorkflowOps(empty, [
      { op: "add_node", node: { type: "step", id: "plan", label: "写蓝图", kind: "guided-plan" } },
      { op: "connect", source: "plan", target: "不存在" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedIndex).toBe(1);
    expect(result.explanation.what).toContain("第 2 条");
    expect(empty.nodes).toHaveLength(2);
  });

  it("草稿允许暂时有结构问题：指令成功，同时返回问题清单", () => {
    const result = applyWorkflowOps(empty, [{ op: "add_node", node: { type: "step", label: "孤立工序", kind: "audit" } }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["step-unreached", "start-dangling"]));
  });

  it("删除节点会带走它的连线与画布位置；不能改节点 id；null 表示删除字段", () => {
    const base: WorkflowGraphRecipe = {
      ...recipe([start, step("a", { agentId: "writer" }), end], [{ source: "start", target: "a" }, { source: "a", target: "end" }]),
      layout: { positions: { start: { x: 0, y: 0 }, a: { x: 100, y: 0 }, end: { x: 200, y: 0 } } },
    };
    const removed = applyWorkflowOps(base, [{ op: "remove_node", id: "a" }]);
    expect(removed.ok && removed.recipe.edges).toEqual([]);
    expect(removed.ok && Object.keys(removed.recipe.layout!.positions)).toEqual(["start", "end"]);

    const renamed = applyWorkflowOps(base, [{ op: "update_node", id: "a", patch: { id: "b" } }]);
    expect(renamed.ok).toBe(false);

    const cleared = applyWorkflowOps(base, [{ op: "update_node", id: "a", patch: { agentId: null, label: "新名字" } }]);
    expect(cleared.ok).toBe(true);
    const node = cleared.ok ? (cleared.recipe.nodes.find((item) => item.id === "a") as Record<string, unknown>) : {};
    expect(node.agentId).toBeUndefined();
    expect(node.label).toBe("新名字");
    expect(node.enabled).toBe(true);
  });

  it("未知字段直接报错，而不是悄悄忽略", () => {
    const base = recipe([start, step("a"), end], [{ source: "start", target: "a" }, { source: "a", target: "end" }]);
    const result = applyWorkflowOps(base, [{ op: "update_node", id: "a", patch: { prompt: "写得好一点" } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.explanation.what).toContain("prompt");
  });
});

describe("layoutWorkflowGraph 与图查询", () => {
  it("按最长路径分列；已有位置的节点不动", () => {
    const r: WorkflowGraphRecipe = {
      ...recipe([start, step("a"), step("b"), step("c"), { id: "join", type: "join", label: "汇合" }, end], [
        { source: "start", target: "a" },
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "join" },
        { source: "c", target: "join" },
        { source: "join", target: "end" },
      ]),
      layout: { positions: { c: { x: 999, y: 999 } } },
    };
    const positions = layoutWorkflowGraph(r);
    expect(positions.start!.x).toBe(0);
    expect(positions.a!.x).toBe(LAYOUT_COLUMN_GAP);
    expect(positions.b!.x).toBe(2 * LAYOUT_COLUMN_GAP);
    expect(positions.c).toEqual({ x: 999, y: 999 });
    expect(positions.end!.x).toBe(4 * LAYOUT_COLUMN_GAP);
    expect([...forwardDescendants(r, "a")].sort()).toEqual(["b", "c", "end", "join"]);
  });
});
