/** 工序级「审校不过最多自动打回几轮」：缺省沿用 MAX_AUDIT_AUTO_RETURNS，可按工序改。 */
import { describe, expect, it } from "vitest";

import { FANQIE_XUANHUAN_SERIAL_RECIPE, type NovelWorkflowRecipe } from "./novel-workflows";
import { createRunState, transition, type WorkflowRunAction, type WorkflowRunState } from "./run-state-machine";
import { applyWorkflowOps } from "./workflow-graph";
import { validateWorkflowRecipes, WorkflowStoreError } from "./workflow-store";

const failNote = { what: "审校未通过", why: "冲突没有升级", action: "按意见修改" };

function withAuditRounds(rounds: number): NovelWorkflowRecipe {
  const result = applyWorkflowOps(FANQIE_XUANHUAN_SERIAL_RECIPE, [
    { op: "update_node", id: "step-adversarial-audit", patch: { maxAutoReturns: rounds } },
  ]);
  if (!result.ok) throw new Error(result.explanation.what);
  return result.recipe;
}

function drive(recipe: NovelWorkflowRecipe) {
  const created = createRunState(recipe);
  if (!created.ok) throw new Error(created.explanation.what);
  let state: WorkflowRunState = created.state;
  const apply = (action: WorkflowRunAction) => {
    const result = transition(recipe, state, action);
    if (!result.ok) throw new Error(result.explanation.what);
    state = result.state;
  };
  const status = (id: string) => state.steps.find((step) => step.stepId === id)!.status;
  apply({ type: "submit", stepId: "step-context" });
  apply({ type: "submit", stepId: "step-blueprint" });
  return { apply, status, get state() { return state; } };
}

describe("maxAutoReturns", () => {
  it("设为 0：第一次不通过就交作者决定", () => {
    const r = drive(withAuditRounds(0));
    r.apply({ type: "submit", stepId: "step-draft" });
    r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: false, note: failNote } });
    expect(r.status("step-adversarial-audit")).toBe("awaiting_approval");
    expect(r.state.steps.find((step) => step.stepId === "step-adversarial-audit")!.note?.why).toContain("最多 0 轮");
  });

  it("设为 1：打回一轮后第二次不通过交作者", () => {
    const r = drive(withAuditRounds(1));
    r.apply({ type: "submit", stepId: "step-draft" });
    r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: false, note: failNote } });
    expect(r.status("step-draft")).toBe("running");
    r.apply({ type: "submit", stepId: "step-draft" });
    r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: false, note: failNote } });
    expect(r.status("step-adversarial-audit")).toBe("awaiting_approval");
  });

  it("编辑指令与存储都拒绝越界值", () => {
    const bad = applyWorkflowOps(FANQIE_XUANHUAN_SERIAL_RECIPE, [
      { op: "update_node", id: "step-adversarial-audit", patch: { maxAutoReturns: 9 } },
    ]);
    expect(bad.ok).toBe(false);
    const recipe = withAuditRounds(3);
    expect(validateWorkflowRecipes([recipe])[0]!.nodes.find((node) => node.id === "step-adversarial-audit")).toMatchObject({ maxAutoReturns: 3 });
    const broken = { ...recipe, nodes: recipe.nodes.map((node) => (node.id === "step-adversarial-audit" ? { ...node, maxAutoReturns: -1 } : node)) };
    expect(() => validateWorkflowRecipes([broken])).toThrow(WorkflowStoreError);
  });
});
