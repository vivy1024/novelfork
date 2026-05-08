/**
 * Workflow Executor — executes a WorkflowRecipeConfig step by step.
 *
 * 对标 Claude Code CLI 的 agent tool loop，但按 recipe 步骤顺序执行。
 * 任一步失败时根据 onFailure 策略决定是否继续。
 */

import type { WorkflowRecipeConfig, WorkflowStepConfig } from "../../shared/workflow-recipe.js";
import { getEnabledSteps } from "../../shared/workflow-recipe.js";

export type WorkflowStepStatus = "pending" | "running" | "success" | "skipped" | "failed" | "approval-pending";

export interface WorkflowStepResult {
  readonly stepId: string;
  readonly kind: WorkflowStepConfig["kind"];
  readonly status: WorkflowStepStatus;
  readonly summary?: string;
  readonly data?: unknown;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface WorkflowExecutionResult {
  readonly recipeId: string;
  readonly commandId: string;
  readonly status: "completed" | "stopped" | "approval-pending" | "failed";
  readonly steps: readonly WorkflowStepResult[];
  readonly summary: string;
  readonly completedStepCount: number;
  readonly totalStepCount: number;
}

export interface WorkflowStepExecutor {
  (step: WorkflowStepConfig, context: WorkflowExecutionContext): Promise<WorkflowStepResult>;
}

export interface WorkflowExecutionContext {
  readonly bookId: string;
  readonly sessionId: string;
  /** 前序步骤的结果，供后续步骤引用 */
  readonly previousResults: readonly WorkflowStepResult[];
  /** 中止信号 */
  readonly signal?: AbortSignal;
}

export interface WorkflowExecutorOptions {
  readonly executeStep: WorkflowStepExecutor;
  readonly onStepStart?: (step: WorkflowStepConfig) => void;
  readonly onStepComplete?: (result: WorkflowStepResult) => void;
}

/**
 * 执行 workflow recipe 的所有启用步骤。
 * 遇到 approval-gate 或 requiresApproval 步骤时暂停。
 * 遇到失败时根据 onFailure 策略决定是否继续。
 */
export async function executeWorkflow(
  recipe: WorkflowRecipeConfig,
  context: WorkflowExecutionContext,
  options: WorkflowExecutorOptions,
): Promise<WorkflowExecutionResult> {
  const enabledSteps = getEnabledSteps(recipe);
  const results: WorkflowStepResult[] = [];
  let finalStatus: WorkflowExecutionResult["status"] = "completed";

  for (const step of enabledSteps) {
    if (context.signal?.aborted) {
      finalStatus = "stopped";
      results.push({ stepId: step.id, kind: step.kind, status: "skipped", summary: "执行被中止" });
      break;
    }

    options.onStepStart?.(step);

    const stepContext: WorkflowExecutionContext = {
      ...context,
      previousResults: [...results],
    };

    const startTime = Date.now();
    let result: WorkflowStepResult;

    try {
      result = await options.executeStep(step, stepContext);
    } catch (error) {
      result = {
        stepId: step.id,
        kind: step.kind,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }

    // 补充 durationMs
    if (result.durationMs === undefined) {
      result = { ...result, durationMs: Date.now() - startTime };
    }

    results.push(result);
    options.onStepComplete?.(result);

    // 处理 approval-pending
    if (result.status === "approval-pending") {
      finalStatus = "approval-pending";
      break;
    }

    // 处理失败
    if (result.status === "failed") {
      const failureAction = step.onFailure ?? "stop";
      if (failureAction === "stop") {
        finalStatus = "failed";
        break;
      }
      // skip: 继续下一步
    }
  }

  const completedStepCount = results.filter((r) => r.status === "success" || r.status === "skipped").length;

  return {
    recipeId: recipe.id,
    commandId: recipe.commandId,
    status: finalStatus,
    steps: results,
    summary: buildWorkflowSummary(recipe, results, finalStatus),
    completedStepCount,
    totalStepCount: enabledSteps.length,
  };
}

function buildWorkflowSummary(
  recipe: WorkflowRecipeConfig,
  results: readonly WorkflowStepResult[],
  status: WorkflowExecutionResult["status"],
): string {
  const successCount = results.filter((r) => r.status === "success").length;
  const total = results.length;

  switch (status) {
    case "completed":
      return `${recipe.name} 完成（${successCount}/${total} 步成功）`;
    case "approval-pending": {
      const pendingStep = results.find((r) => r.status === "approval-pending");
      return `${recipe.name} 等待用户批准：${pendingStep?.summary ?? "确认门"}`;
    }
    case "failed": {
      const failedStep = results.find((r) => r.status === "failed");
      return `${recipe.name} 失败于步骤 ${failedStep?.stepId}：${failedStep?.error ?? "未知错误"}`;
    }
    case "stopped":
      return `${recipe.name} 被中止（已完成 ${successCount}/${total} 步）`;
  }
}
