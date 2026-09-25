import { describe, expect, it } from "vitest";

import type { NovelWorkflowRecipe, NovelWorkflowStep } from "./novel-workflows";
import {
  createRunState,
  transition,
  type WorkflowRunAction,
  type WorkflowRunState,
  type WorkflowRunStatus,
} from "./run-state-machine";

function step(id: string, patch: Partial<NovelWorkflowStep> = {}): NovelWorkflowStep {
  return { id, kind: "custom-tool", label: `工序 ${id}`, enabled: true, ...patch };
}

function recipe(steps: NovelWorkflowStep[], patch: Partial<NovelWorkflowRecipe> = {}): NovelWorkflowRecipe {
  return {
    id: "r",
    name: "测试方案",
    commandId: "/novel:test",
    description: "",
    steps,
    resultStrategy: "formal-chapter",
    requireFinalApproval: false,
    maxRetries: 1,
    ...patch,
  };
}

function start(r: NovelWorkflowRecipe): WorkflowRunState {
  const created = createRunState(r);
  if (!created.ok) throw new Error(created.explanation.what);
  return created.state;
}

function apply(state: WorkflowRunState, action: WorkflowRunAction): WorkflowRunState {
  const result = transition(state, action);
  if (!result.ok) throw new Error(`${result.code}: ${result.explanation.what}`);
  expect(result.state.revision).toBe(state.revision + 1);
  return result.state;
}

const note = { what: "意见", why: "原因", action: "建议" };

describe("createRunState", () => {
  it("只取启用的工序，第一道立即进入执行", () => {
    const state = start(recipe([step("a"), step("b", { enabled: false }), step("c")]));
    expect(state.steps.map((s) => s.stepId)).toEqual(["a", "c"]);
    expect(state.status).toBe("running");
    expect(state.currentStepId).toBe("a");
    expect(state.steps[0]).toMatchObject({ status: "running", attempt: 1 });
    expect(state.revision).toBe(0);
  });

  it("requireFinalApproval 等价于最后一道工序必须作者确认", () => {
    const state = start(recipe([step("a"), step("b")], { requireFinalApproval: true }));
    expect(state.steps.map((s) => s.requiresApproval)).toEqual([false, true]);
  });

  it("人工门禁作为第一道时直接等作者放行", () => {
    const state = start(recipe([step("gate", { kind: "approval-gate" }), step("b")]));
    expect(state.status).toBe("awaiting_approval");
    expect(state.steps[0]).toMatchObject({ status: "awaiting_approval", executorKind: "manual-gate", expectedOutput: null });
  });

  it("工序类别决定必交产物", () => {
    const state = start(recipe([
      step("p", { kind: "guided-plan" }),
      step("w", { kind: "writer-generate" }),
      step("x", { kind: "adversarial-audit" }),
      step("s", { kind: "post-settlement" }),
    ]));
    expect(state.steps.map((s) => s.expectedOutput)).toEqual(["scene-spec", "prose", "audit", "other"]);
  });

  it("一道启用的工序都没有时拒绝启动并说明原因", () => {
    const created = createRunState(recipe([step("a", { enabled: false })]));
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.explanation.action).toContain("启用");
  });
});

describe("transition 正常路径", () => {
  it("无需确认的工序提交即完成并进入下一道，最后一道提交后运行完成", () => {
    let state = start(recipe([step("a"), step("b")]));
    state = apply(state, { type: "submit", stepId: "a" });
    expect(state.currentStepId).toBe("b");
    expect(state.steps.map((s) => s.status)).toEqual(["done", "running"]);
    state = apply(state, { type: "submit", stepId: "b" });
    expect(state.status).toBe("done");
    expect(state.currentStepId).toBeNull();
  });

  it("需要确认的工序：提交 → 等待确认 → 打回带意见重做 → 再提交 → 批准进入下一道", () => {
    let state = start(recipe([step("a", { requiresApproval: true }), step("b")]));
    state = apply(state, { type: "submit", stepId: "a" });
    expect(state.status).toBe("awaiting_approval");
    state = apply(state, { type: "reject", stepId: "a", note });
    expect(state.status).toBe("running");
    expect(state.steps[0]).toMatchObject({ status: "running", attempt: 2, note });
    state = apply(state, { type: "submit", stepId: "a" });
    state = apply(state, { type: "approve", stepId: "a" });
    expect(state.currentStepId).toBe("b");
    expect(state.steps[0]!.status).toBe("done");
  });

  it("人工门禁批准后放行", () => {
    let state = start(recipe([step("gate", { kind: "approval-gate" }), step("b")]));
    state = apply(state, { type: "approve", stepId: "gate" });
    expect(state).toMatchObject({ status: "running", currentStepId: "b" });
  });
});

describe("transition 阻塞与失败策略", () => {
  it("retry：次数未用完时自动重试，用完后受阻；作者重试不受上限约束", () => {
    let state = start(recipe([step("a", { onFailure: "retry" })], { maxRetries: 1 }));
    state = apply(state, { type: "block", stepId: "a", explanation: note });
    expect(state).toMatchObject({ status: "running" });
    expect(state.steps[0]).toMatchObject({ attempt: 2, note });
    state = apply(state, { type: "block", stepId: "a", explanation: note });
    expect(state.status).toBe("blocked");
    expect(state.steps[0]!.status).toBe("failed");
    state = apply(state, { type: "retry" });
    expect(state.status).toBe("running");
    expect(state.steps[0]).toMatchObject({ status: "running", attempt: 3 });
  });

  it("skip：阻塞即跳过进入下一道", () => {
    let state = start(recipe([step("a", { onFailure: "skip" }), step("b")]));
    state = apply(state, { type: "block", stepId: "a", explanation: note });
    expect(state.steps.map((s) => s.status)).toEqual(["skipped", "running"]);
  });

  it("stop：阻塞即受阻，作者可跳过继续", () => {
    let state = start(recipe([step("a", { onFailure: "stop" }), step("b")]));
    state = apply(state, { type: "block", stepId: "a", explanation: note });
    expect(state.status).toBe("blocked");
    state = apply(state, { type: "skip" });
    expect(state).toMatchObject({ status: "running", currentStepId: "b" });
  });

  it("任意进行中状态都可取消，取消后不再接受任何操作", () => {
    let state = start(recipe([step("a")]));
    state = apply(state, { type: "cancel" });
    expect(state.status).toBe("cancelled");
    const after = transition(state, { type: "submit", stepId: "a" });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe("run-finished");
  });
});

describe("transition 非法迁移一律被拒且带说明", () => {
  function stateWith(status: WorkflowRunStatus): WorkflowRunState {
    const base = start(recipe([step("a", { requiresApproval: true, onFailure: "stop" }), step("b")]));
    switch (status) {
      case "running":
        return base;
      case "awaiting_approval":
        return apply(base, { type: "submit", stepId: "a" });
      case "blocked":
        return apply(base, { type: "block", stepId: "a", explanation: note });
      case "done":
        return { ...base, status: "done", currentStepId: null };
      case "cancelled":
        return apply(base, { type: "cancel" });
    }
  }

  const actions: WorkflowRunAction[] = [
    { type: "submit", stepId: "a" },
    { type: "approve", stepId: "a" },
    { type: "reject", stepId: "a", note },
    { type: "block", stepId: "a", explanation: note },
    { type: "retry" },
    { type: "skip" },
    { type: "cancel" },
  ];

  // 每个 (状态, 动作) 组合的期望：true = 合法迁移。
  const allowed: Record<WorkflowRunStatus, readonly WorkflowRunAction["type"][]> = {
    running: ["submit", "block", "cancel"],
    awaiting_approval: ["approve", "reject", "cancel"],
    blocked: ["retry", "skip", "cancel"],
    done: [],
    cancelled: [],
  };

  for (const status of Object.keys(allowed) as WorkflowRunStatus[]) {
    for (const action of actions) {
      const legal = allowed[status].includes(action.type);
      it(`${status} × ${action.type} → ${legal ? "允许" : "拒绝"}`, () => {
        const before = stateWith(status);
        const result = transition(before, action);
        expect(result.ok).toBe(legal);
        if (result.ok) {
          expect(result.state.revision).toBe(before.revision + 1);
          expect(result.events.length).toBeGreaterThan(0);
        } else {
          expect(result.explanation.what.length).toBeGreaterThan(0);
          expect(result.explanation.why.length).toBeGreaterThan(0);
          expect(result.explanation.action.length).toBeGreaterThan(0);
        }
      });
    }
  }

  it("针对非当前工序的操作被拒（多半来自过期页面）", () => {
    const state = start(recipe([step("a"), step("b")]));
    const result = transition(state, { type: "submit", stepId: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("stale-step");
  });

  it("人工门禁不能打回", () => {
    const state = start(recipe([step("gate", { kind: "approval-gate" })]));
    const result = transition(state, { type: "reject", stepId: "gate", note });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("gate-cannot-reject");
  });
});
