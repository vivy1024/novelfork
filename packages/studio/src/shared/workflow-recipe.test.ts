import { describe, expect, it } from "vitest";
import {
  DEFAULT_WRITE_NEXT_RECIPE,
  DEFAULT_AUDIT_RECIPE,
  DEFAULT_WORKFLOW_RECIPES,
  getWorkflowRecipe,
  getEnabledSteps,
  type WorkflowRecipeConfig,
} from "./workflow-recipe";

describe("workflow recipe", () => {
  it("provides a default /novel:write-next recipe with 6 steps", () => {
    expect(DEFAULT_WRITE_NEXT_RECIPE.commandId).toBe("/novel:write-next");
    expect(DEFAULT_WRITE_NEXT_RECIPE.steps).toHaveLength(6);
    expect(DEFAULT_WRITE_NEXT_RECIPE.steps.map((s) => s.kind)).toEqual([
      "context-load",
      "pgi",
      "guided-plan",
      "approval-gate",
      "writer-generate",
      "canvas-open",
    ]);
    expect(DEFAULT_WRITE_NEXT_RECIPE.candidateStrategy).toBe("create-candidate");
    expect(DEFAULT_WRITE_NEXT_RECIPE.requireFinalApproval).toBe(true);
  });

  it("provides a default /novel:audit recipe with 3 steps", () => {
    expect(DEFAULT_AUDIT_RECIPE.commandId).toBe("/novel:audit");
    expect(DEFAULT_AUDIT_RECIPE.steps).toHaveLength(3);
    expect(DEFAULT_AUDIT_RECIPE.candidateStrategy).toBe("create-draft");
  });

  it("looks up recipes by commandId", () => {
    expect(getWorkflowRecipe("/novel:write-next")).toBe(DEFAULT_WRITE_NEXT_RECIPE);
    expect(getWorkflowRecipe("/novel:audit")).toBe(DEFAULT_AUDIT_RECIPE);
    expect(getWorkflowRecipe("/novel:unknown")).toBeUndefined();
  });

  it("filters enabled steps from a recipe", () => {
    const modified: WorkflowRecipeConfig = {
      ...DEFAULT_WRITE_NEXT_RECIPE,
      steps: DEFAULT_WRITE_NEXT_RECIPE.steps.map((step) =>
        step.kind === "pgi" ? { ...step, enabled: false } : step,
      ),
    };

    const enabled = getEnabledSteps(modified);
    expect(enabled).toHaveLength(5);
    expect(enabled.find((s) => s.kind === "pgi")).toBeUndefined();
  });

  it("assigns agent roles to appropriate steps", () => {
    const contextStep = DEFAULT_WRITE_NEXT_RECIPE.steps.find((s) => s.kind === "context-load");
    const planStep = DEFAULT_WRITE_NEXT_RECIPE.steps.find((s) => s.kind === "guided-plan");
    const writerStep = DEFAULT_WRITE_NEXT_RECIPE.steps.find((s) => s.kind === "writer-generate");

    expect(contextStep?.agentId).toBe("explorer");
    expect(planStep?.agentId).toBe("planner");
    expect(writerStep?.agentId).toBe("writer");
  });

  it("marks approval-requiring steps", () => {
    const approvalSteps = DEFAULT_WRITE_NEXT_RECIPE.steps.filter((s) => s.requiresApproval);
    expect(approvalSteps.length).toBeGreaterThanOrEqual(2);
    expect(approvalSteps.map((s) => s.kind)).toContain("guided-plan");
    expect(approvalSteps.map((s) => s.kind)).toContain("approval-gate");
  });

  it("supports custom recipe list override", () => {
    const custom: WorkflowRecipeConfig = {
      id: "custom",
      name: "Custom",
      commandId: "/custom",
      description: "test",
      steps: [],
      candidateStrategy: "create-candidate",
      requireFinalApproval: false,
      maxRetries: 0,
    };

    expect(getWorkflowRecipe("/custom", [custom])).toBe(custom);
    expect(getWorkflowRecipe("/novel:write-next", [custom])).toBeUndefined();
  });
});
