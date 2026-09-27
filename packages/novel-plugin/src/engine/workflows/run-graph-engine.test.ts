import { describe, expect, it } from "vitest";

import { createRunState, transition, type WorkflowRunAction, type WorkflowRunState } from "./run-state-machine";
import type { WorkflowGraphEdge, WorkflowGraphNode, WorkflowGraphRecipe } from "./workflow-graph";

const start: WorkflowGraphNode = { id: "start", type: "start", label: "开始" };
const end: WorkflowGraphNode = { id: "end", type: "end", label: "完成" };
const join = (id = "join"): WorkflowGraphNode => ({ id, type: "join", label: "汇合" });
const step = (id: string, extra: Record<string, unknown> = {}): WorkflowGraphNode =>
  ({ id, type: "step", label: `工序 ${id}`, kind: "custom-tool", enabled: true, ...extra }) as WorkflowGraphNode;

function graph(nodes: WorkflowGraphNode[], edges: Array<Pick<WorkflowGraphEdge, "source" | "target"> & Partial<WorkflowGraphEdge>>): WorkflowGraphRecipe {
  return {
    schemaVersion: 2,
    id: "g",
    name: "图测试",
    commandId: "/novel:graph",
    description: "",
    status: "published",
    revision: 1,
    nodes,
    edges: edges.map((edge, index) => ({ id: `e${index}`, kind: "next", ...edge })),
    resultStrategy: "formal-chapter",
    maxRetries: 0,
  };
}

function run(recipe: WorkflowGraphRecipe) {
  const created = createRunState(recipe);
  if (!created.ok) throw new Error(created.explanation.what);
  let state: WorkflowRunState = created.state;
  const events: string[] = created.events.map((event) => event.type);
  return {
    get state() {
      return state;
    },
    events,
    status: (id: string) => state.steps.find((candidate) => candidate.stepId === id)!.status,
    apply(action: WorkflowRunAction) {
      const result = transition(recipe, state, action);
      if (!result.ok) throw new Error(`${result.code}: ${result.explanation.what}`);
      expect(result.state.revision).toBe(state.revision + 1);
      state = result.state;
      events.push(...result.events.map((event) => event.type));
      return state;
    },
    attempt(action: WorkflowRunAction) {
      return transition(recipe, state, action);
    },
  };
}

const note = { what: "意见", why: "原因", action: "建议" };

describe("并行分叉与汇合", () => {
  const parallel = graph([start, step("plan"), step("draft"), step("research"), join(), step("audit"), end], [
    { source: "start", target: "plan" },
    { source: "plan", target: "draft" },
    { source: "plan", target: "research" },
    { source: "draft", target: "join" },
    { source: "research", target: "join" },
    { source: "join", target: "audit" },
    { source: "audit", target: "end" },
  ]);

  it("分叉后两道工序同时进行；汇合等两边都完成才继续；走到终点运行完成", () => {
    const r = run(parallel);
    r.apply({ type: "submit", stepId: "plan" });
    expect([r.status("draft"), r.status("research"), r.status("audit")]).toEqual(["running", "running", "pending"]);
    expect(r.state.status).toBe("running");

    r.apply({ type: "submit", stepId: "research" });
    expect(r.status("audit")).toBe("pending");

    r.apply({ type: "submit", stepId: "draft" });
    expect(r.status("audit")).toBe("running");

    r.apply({ type: "submit", stepId: "audit" });
    expect(r.state.status).toBe("done");
    expect(r.events.filter((type) => type === "run_done")).toHaveLength(1);
  });

  it("一边等作者确认时，另一边照常推进，运行仍是进行中", () => {
    const withApproval = graph(parallel.nodes.map((node) => (node.id === "draft" ? { ...node, requiresApproval: true } as WorkflowGraphNode : node)), parallel.edges);
    const r = run(withApproval);
    r.apply({ type: "submit", stepId: "plan" });
    r.apply({ type: "submit", stepId: "draft" });
    expect(r.status("draft")).toBe("awaiting_approval");
    expect(r.state.status).toBe("running");
    r.apply({ type: "submit", stepId: "research" });
    expect(r.state.status).toBe("awaiting_approval");
    r.apply({ type: "approve", stepId: "draft" });
    expect(r.status("audit")).toBe("running");
  });

  it("一处受阻暂停整个运行：别的分支不能提交，作者重试后恢复", () => {
    const r = run(parallel);
    r.apply({ type: "submit", stepId: "plan" });
    r.apply({ type: "block", stepId: "draft", explanation: note });
    expect(r.state.status).toBe("blocked");
    const blocked = r.attempt({ type: "submit", stepId: "research" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("run-blocked");
    r.apply({ type: "retry", stepId: "draft" });
    expect(r.state.status).toBe("running");
    expect(r.status("draft")).toBe("running");
  });
});

describe("按结果分支", () => {
  const branching = graph([start, step("audit", { outcomes: ["通过", "不通过"] }), step("fix"), join(), end], [
    { source: "start", target: "audit" },
    { source: "audit", target: "join", outcome: "通过" },
    { source: "audit", target: "fix", outcome: "不通过" },
    { source: "fix", target: "join" },
    { source: "join", target: "end" },
  ]);

  it("提交「通过」：返修分支标为未走到，汇合照常触发，运行完成", () => {
    const r = run(branching);
    r.apply({ type: "submit", stepId: "audit", outcome: "通过" });
    expect(r.status("fix")).toBe("bypassed");
    expect(r.state.status).toBe("done");
    expect(r.state.steps.find((candidate) => candidate.stepId === "audit")!.outcome).toBe("通过");
  });

  it("提交「不通过」：进入返修，返修完成后汇合、完成", () => {
    const r = run(branching);
    r.apply({ type: "submit", stepId: "audit", outcome: "不通过" });
    expect(r.status("fix")).toBe("running");
    r.apply({ type: "submit", stepId: "fix" });
    expect(r.state.status).toBe("done");
  });

  it("分支工序必须给出声明过的结果", () => {
    const r = run(branching);
    for (const outcome of [undefined, "差不多"]) {
      const result = r.attempt({ type: "submit", stepId: "audit", ...(outcome ? { outcome } : {}) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("outcome-required");
        expect(result.explanation.action).toContain("通过 / 不通过");
      }
    }
  });

  it("受阻的分支工序不能跳过（跳过就没有结果）", () => {
    const r = run(branching);
    r.apply({ type: "block", stepId: "audit", explanation: note });
    const skipped = r.attempt({ type: "skip" });
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.code).toBe("branch-cannot-skip");
  });
});

describe("打回上游", () => {
  const loop = graph([start, step("plan"), step("draft"), step("review", { requiresApproval: true }), end], [
    { source: "start", target: "plan" },
    { source: "plan", target: "draft" },
    { source: "draft", target: "review" },
    { source: "review", target: "end" },
    { source: "review", target: "plan", kind: "reject" },
  ]);

  it("作者打回时回到打回线指向的工序重做，中间工序全部重置，意见交给重做的工序", () => {
    const r = run(loop);
    r.apply({ type: "submit", stepId: "plan" });
    r.apply({ type: "submit", stepId: "draft" });
    r.apply({ type: "submit", stepId: "review" });
    expect(r.state.status).toBe("awaiting_approval");

    r.apply({ type: "reject", stepId: "review", note });
    const plan = r.state.steps.find((candidate) => candidate.stepId === "plan")!;
    expect(plan).toMatchObject({ status: "running", attempt: 2, note });
    expect([r.status("draft"), r.status("review")]).toEqual(["pending", "pending"]);
    expect(r.state.steps.find((candidate) => candidate.stepId === "review")!.note).toBeUndefined();

    r.apply({ type: "submit", stepId: "plan" });
    r.apply({ type: "submit", stepId: "draft" });
    r.apply({ type: "submit", stepId: "review" });
    r.apply({ type: "approve", stepId: "review" });
    expect(r.state.status).toBe("done");
  });

  it("人工门禁连了打回线就可以打回", () => {
    const gated = graph([start, step("draft"), step("gate", { kind: "approval-gate" }), end], [
      { source: "start", target: "draft" },
      { source: "draft", target: "gate" },
      { source: "gate", target: "end" },
      { source: "gate", target: "draft", kind: "reject" },
    ]);
    const r = run(gated);
    r.apply({ type: "submit", stepId: "draft" });
    expect(r.status("gate")).toBe("awaiting_approval");
    r.apply({ type: "reject", stepId: "gate", note });
    expect(r.status("draft")).toBe("running");
  });
});

describe("启动前的结构检查", () => {
  it("结构有问题的工作流不能启动，说明里指出第一处问题", () => {
    const broken = graph([start, step("a"), step("b"), end], [
      { source: "start", target: "a" },
      { source: "a", target: "end" },
    ]);
    const created = createRunState(broken);
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe("graph-invalid");
      expect(created.explanation.what).toContain("工序 b");
    }
  });
});
