import { describe, expect, it, vi } from "vitest";
import { executeWorkflow, type WorkflowExecutionContext, type WorkflowStepResult } from "./workflow-executor";
import { DEFAULT_WRITE_NEXT_RECIPE } from "../../shared/workflow-recipe";
import type { WorkflowStepConfig } from "../../shared/workflow-recipe";

function createContext(overrides: Partial<WorkflowExecutionContext> = {}): WorkflowExecutionContext {
  return {
    bookId: "book-1",
    sessionId: "session-1",
    previousResults: [],
    ...overrides,
  };
}

function successStep(step: WorkflowStepConfig): WorkflowStepResult {
  return { stepId: step.id, kind: step.kind, status: "success", summary: `${step.label} 完成` };
}

describe("workflow executor", () => {
  it("executes all enabled steps in sequence and reports completion", async () => {
    const executeStep = vi.fn(async (step: WorkflowStepConfig) => successStep(step));

    const result = await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep });

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(6);
    expect(result.completedStepCount).toBe(6);
    expect(result.totalStepCount).toBe(6);
    expect(executeStep).toHaveBeenCalledTimes(6);
    expect(result.summary).toContain("写下一章 完成");
  });

  it("stops at approval-pending step", async () => {
    const executeStep = vi.fn(async (step: WorkflowStepConfig): Promise<WorkflowStepResult> => {
      if (step.kind === "approval-gate") {
        return { stepId: step.id, kind: step.kind, status: "approval-pending", summary: "等待用户批准计划" };
      }
      return successStep(step);
    });

    const result = await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep });

    expect(result.status).toBe("approval-pending");
    // Should have executed context-load, pgi, guided-plan, then stopped at approval-gate
    expect(result.steps).toHaveLength(4);
    expect(result.steps[3].status).toBe("approval-pending");
    expect(result.summary).toContain("等待用户批准");
  });

  it("stops on failure when onFailure is stop", async () => {
    const executeStep = vi.fn(async (step: WorkflowStepConfig): Promise<WorkflowStepResult> => {
      if (step.kind === "pgi") {
        return { stepId: step.id, kind: step.kind, status: "failed", error: "模型不可用" };
      }
      return successStep(step);
    });

    const result = await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep });

    // PGI step has onFailure: "skip", so it should continue
    expect(result.status).toBe("completed");
    expect(result.steps.find((s) => s.kind === "pgi")?.status).toBe("failed");
  });

  it("stops on failure when onFailure is stop (context-load)", async () => {
    const executeStep = vi.fn(async (step: WorkflowStepConfig): Promise<WorkflowStepResult> => {
      if (step.kind === "context-load") {
        return { stepId: step.id, kind: step.kind, status: "failed", error: "书籍不存在" };
      }
      return successStep(step);
    });

    const result = await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep });

    // context-load has onFailure: "stop"
    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(1);
    expect(result.summary).toContain("失败于步骤");
    expect(result.summary).toContain("书籍不存在");
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const executeStep = vi.fn(async (step: WorkflowStepConfig) => successStep(step));

    const result = await executeWorkflow(
      DEFAULT_WRITE_NEXT_RECIPE,
      createContext({ signal: controller.signal }),
      { executeStep },
    );

    expect(result.status).toBe("stopped");
    expect(executeStep).not.toHaveBeenCalled();
  });

  it("calls onStepStart and onStepComplete callbacks", async () => {
    const onStepStart = vi.fn();
    const onStepComplete = vi.fn();
    const executeStep = vi.fn(async (step: WorkflowStepConfig) => successStep(step));

    await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep, onStepStart, onStepComplete });

    expect(onStepStart).toHaveBeenCalledTimes(6);
    expect(onStepComplete).toHaveBeenCalledTimes(6);
  });

  it("passes previous results to subsequent steps", async () => {
    const contexts: WorkflowExecutionContext[] = [];
    const executeStep = vi.fn(async (step: WorkflowStepConfig, ctx: WorkflowExecutionContext) => {
      contexts.push(ctx);
      return successStep(step);
    });

    await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep });

    expect(contexts[0].previousResults).toHaveLength(0);
    expect(contexts[1].previousResults).toHaveLength(1);
    expect(contexts[5].previousResults).toHaveLength(5);
  });

  it("catches exceptions from executeStep and treats as failure", async () => {
    const executeStep = vi.fn(async (step: WorkflowStepConfig): Promise<WorkflowStepResult> => {
      if (step.kind === "writer-generate") {
        throw new Error("LLM timeout");
      }
      return successStep(step);
    });

    const result = await executeWorkflow(DEFAULT_WRITE_NEXT_RECIPE, createContext(), { executeStep });

    // writer-generate has onFailure: "stop"
    expect(result.status).toBe("failed");
    const writerStep = result.steps.find((s) => s.kind === "writer-generate");
    expect(writerStep?.status).toBe("failed");
    expect(writerStep?.error).toBe("LLM timeout");
    expect(writerStep?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
