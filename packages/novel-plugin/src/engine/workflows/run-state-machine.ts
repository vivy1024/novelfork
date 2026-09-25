/**
 * 创作工作流运行状态机（纯函数）。
 *
 * 状态迁移只在后端发生：模型只能提交候选（submit）、报告阻塞（block），
 * 作者只能批准 / 打回 / 重试 / 跳过 / 取消。模型不能宣布「完成」——完成是
 * 最后一道工序被提交（或批准）之后状态机自己推出来的。
 *
 * 所有非法迁移都返回带三段式 explanation 的拒绝，而不是静默忽略：
 * 前端审批与模型提交会并发打同一个运行，拒绝理由必须能直接给作者看。
 */

import type { NovelWorkflowRecipe, NovelWorkflowStep, NovelWorkflowStepKind } from "./novel-workflows.js";

export type WorkflowRunStatus = "running" | "awaiting_approval" | "blocked" | "done" | "cancelled";
export type WorkflowStepStatus = "pending" | "running" | "awaiting_approval" | "done" | "skipped" | "failed";
export type WorkflowExecutorKind = "narrator" | "subagent" | "domain-tool" | "manual-gate";
export type WorkflowCandidateKind = "scene-spec" | "prose" | "audit" | "other";

export const WORKFLOW_CANDIDATE_KINDS: readonly WorkflowCandidateKind[] = ["scene-spec", "prose", "audit", "other"];
export const ACTIVE_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = ["running", "awaiting_approval", "blocked"];

export interface WorkflowExplanation {
  readonly what: string;
  readonly why: string;
  readonly action: string;
}

export interface WorkflowStepState {
  readonly stepId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly kind: NovelWorkflowStepKind;
  readonly status: WorkflowStepStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly executorKind: WorkflowExecutorKind;
  readonly agentId?: string;
  readonly requiresApproval: boolean;
  readonly onFailure: "stop" | "skip" | "retry";
  /** 这道工序允许调用的写类小说工具（读类恒允许，不在此列）。 */
  readonly tools: readonly string[];
  /** 这道工序必须提交的产物类别；人工门禁工序为 null。 */
  readonly expectedOutput: WorkflowCandidateKind | null;
  /** 最近一次打回意见或阻塞说明，会进入下一次工序简报。 */
  readonly note?: WorkflowExplanation;
}

export interface WorkflowRunState {
  readonly status: WorkflowRunStatus;
  readonly currentStepId: string | null;
  readonly revision: number;
  readonly steps: readonly WorkflowStepState[];
}

export type WorkflowRunAction =
  | { readonly type: "submit"; readonly stepId: string }
  | { readonly type: "approve"; readonly stepId: string }
  | { readonly type: "reject"; readonly stepId: string; readonly note: WorkflowExplanation }
  | { readonly type: "block"; readonly stepId: string; readonly explanation: WorkflowExplanation }
  | { readonly type: "retry" }
  | { readonly type: "skip" }
  | { readonly type: "cancel" };

export interface WorkflowRunEventDraft {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type WorkflowTransition =
  | { readonly ok: true; readonly state: WorkflowRunState; readonly events: readonly WorkflowRunEventDraft[] }
  | { readonly ok: false; readonly code: string; readonly explanation: WorkflowExplanation };

/** 工序类别 → 必交产物。人工门禁不要求模型交任何东西。 */
export function expectedOutputFor(kind: NovelWorkflowStepKind): WorkflowCandidateKind | null {
  switch (kind) {
    case "guided-plan":
      return "scene-spec";
    case "writer-generate":
      return "prose";
    case "audit":
    case "adversarial-audit":
      return "audit";
    case "approval-gate":
      return null;
    default:
      return "other";
  }
}

function executorKindFor(step: NovelWorkflowStep): WorkflowExecutorKind {
  if (step.kind === "approval-gate") return "manual-gate";
  if (step.executionMode === "subagent") return "subagent";
  if (step.executionMode === "tool-only") return "domain-tool";
  return "narrator";
}

function reject(code: string, what: string, why: string, action: string): WorkflowTransition {
  return { ok: false, code, explanation: { what, why, action } };
}

function isTerminal(status: WorkflowRunStatus): boolean {
  return status === "done" || status === "cancelled";
}

/**
 * 进入某道工序：人工门禁直接等作者确认，其余工序交给叙述者执行。
 * 没有下一道工序时整个运行完成。
 */
function enterStep(
  steps: WorkflowStepState[],
  index: number,
  revision: number,
  events: WorkflowRunEventDraft[],
): WorkflowRunState {
  const next = steps[index];
  if (!next) {
    events.push({ type: "run_done", payload: {} });
    return { status: "done", currentStepId: null, revision, steps };
  }
  const gate = next.executorKind === "manual-gate";
  steps[index] = {
    ...next,
    status: gate ? "awaiting_approval" : "running",
    attempt: next.attempt + 1,
  };
  events.push({
    type: gate ? "step_awaiting_approval" : "step_started",
    payload: { stepId: next.stepId, attempt: next.attempt + 1 },
  });
  return {
    status: gate ? "awaiting_approval" : "running",
    currentStepId: next.stepId,
    revision,
    steps,
  };
}

/**
 * 由冻结的配方派生工序模板（全部 pending、attempt 0）。
 * 建运行与从库里加载运行都用这一份映射，工序的静态属性只有一个来源。
 */
export function buildStepTemplates(recipe: NovelWorkflowRecipe): WorkflowStepState[] {
  const enabled = recipe.steps.filter((step) => step.enabled);
  const maxAttempts = Math.max(1, 1 + Math.max(0, Math.floor(recipe.maxRetries)));
  const lastIndex = enabled.length - 1;
  return enabled.map((step, index) => ({
    stepId: step.id,
    ordinal: index + 1,
    label: step.label,
    kind: step.kind,
    status: "pending",
    attempt: 0,
    maxAttempts,
    executorKind: executorKindFor(step),
    ...(step.agentId ? { agentId: step.agentId } : {}),
    // requireFinalApproval 等价于「最后一道工序必须作者确认」，不再单独造一个终审态。
    requiresApproval: Boolean(step.requiresApproval) || (recipe.requireFinalApproval && index === lastIndex),
    onFailure: step.onFailure ?? "stop",
    tools: [...(step.tools ?? [])],
    expectedOutput: expectedOutputFor(step.kind),
  }));
}

/** 用冻结的配方建运行的初始状态：只取启用的工序，第一道立即开始。 */
export function createRunState(recipe: NovelWorkflowRecipe): WorkflowTransition {
  const steps = buildStepTemplates(recipe);
  if (steps.length === 0) {
    return reject(
      "no-enabled-steps",
      `方案「${recipe.name}」没有启用的工序`,
      "工作流按工序推进，一道工序都没有就无事可做",
      "到「套路 › 工作流装配」里启用至少一道工序后再启动",
    );
  }
  const events: WorkflowRunEventDraft[] = [{ type: "run_started", payload: { recipeId: recipe.id } }];
  const state = enterStep(steps, 0, 0, events);
  return { ok: true, state, events };
}

function currentStepIndex(state: WorkflowRunState): number {
  return state.currentStepId === null ? -1 : state.steps.findIndex((step) => step.stepId === state.currentStepId);
}

function staleStep(stepId: string, state: WorkflowRunState): WorkflowTransition {
  return reject(
    "stale-step",
    `工序 ${stepId} 不是当前工序（当前：${state.currentStepId ?? "无"}）`,
    "工作流只能推进当前这一道工序，旧工序的操作多半来自过期的页面或模型记错了进度",
    "重新读取运行状态（叙述者调用 workflow_get_current_step，作者刷新「执行」页）后再操作",
  );
}

/** 对运行执行一个动作。每次成功迁移 revision + 1。 */
export function transition(state: WorkflowRunState, action: WorkflowRunAction): WorkflowTransition {
  if (isTerminal(state.status)) {
    return reject(
      "run-finished",
      `这个运行已${state.status === "done" ? "完成" : "取消"}`,
      "已结束的运行不再接受任何操作",
      "如需继续，请在「故事推进 › 执行」重新启动一个运行",
    );
  }

  const steps = [...state.steps];
  const events: WorkflowRunEventDraft[] = [];
  const revision = state.revision + 1;
  const index = currentStepIndex(state);
  const current = index >= 0 ? steps[index] : undefined;

  if (action.type === "cancel") {
    events.push({ type: "run_cancelled", payload: { stepId: state.currentStepId } });
    return { ok: true, state: { status: "cancelled", currentStepId: state.currentStepId, revision, steps }, events };
  }

  if (!current) {
    return reject("no-current-step", "运行没有当前工序", "状态数据不一致", "取消该运行后重新启动");
  }

  switch (action.type) {
    case "submit": {
      if (action.stepId !== current.stepId) return staleStep(action.stepId, state);
      if (state.status !== "running" || current.status !== "running") {
        return reject(
          "not-accepting-output",
          `工序「${current.label}」现在不接收产物（运行状态：${state.status}）`,
          state.status === "awaiting_approval"
            ? "上一份产物正在等作者确认，此时再交会让作者审的内容和最终落盘的对不上"
            : "工序处于阻塞中，要先由作者决定重试、跳过还是取消",
          state.status === "awaiting_approval" ? "停止产出，等待作者在「执行」页确认或打回" : "等待作者处理阻塞",
        );
      }
      events.push({ type: "candidate_submitted", payload: { stepId: current.stepId } });
      if (current.requiresApproval) {
        steps[index] = { ...current, status: "awaiting_approval" };
        events.push({ type: "step_awaiting_approval", payload: { stepId: current.stepId } });
        return { ok: true, state: { status: "awaiting_approval", currentStepId: current.stepId, revision, steps }, events };
      }
      steps[index] = { ...current, status: "done" };
      events.push({ type: "step_done", payload: { stepId: current.stepId } });
      return { ok: true, state: enterStep(steps, index + 1, revision, events), events };
    }

    case "approve": {
      if (action.stepId !== current.stepId) return staleStep(action.stepId, state);
      if (state.status !== "awaiting_approval" || current.status !== "awaiting_approval") {
        return reject(
          "nothing-to-approve",
          `工序「${current.label}」没有待确认的产物`,
          "只有提交后等待确认的工序才能批准",
          "等叙述者提交本工序产物后再批准",
        );
      }
      steps[index] = { ...current, status: "done" };
      events.push({ type: "step_approved", payload: { stepId: current.stepId } });
      return { ok: true, state: enterStep(steps, index + 1, revision, events), events };
    }

    case "reject": {
      if (action.stepId !== current.stepId) return staleStep(action.stepId, state);
      if (state.status !== "awaiting_approval" || current.status !== "awaiting_approval") {
        return reject(
          "nothing-to-reject",
          `工序「${current.label}」没有待确认的产物`,
          "只有提交后等待确认的工序才能打回",
          "等叙述者提交本工序产物后再打回",
        );
      }
      if (current.executorKind === "manual-gate") {
        return reject(
          "gate-cannot-reject",
          `「${current.label}」是人工门禁，没有可打回的产物`,
          "门禁只决定是否放行，打回无处可回",
          "放行请批准；不想继续请取消运行",
        );
      }
      steps[index] = { ...current, status: "running", attempt: current.attempt + 1, note: action.note };
      events.push({ type: "step_rejected", payload: { stepId: current.stepId, note: action.note } });
      return { ok: true, state: { status: "running", currentStepId: current.stepId, revision, steps }, events };
    }

    case "block": {
      if (action.stepId !== current.stepId) return staleStep(action.stepId, state);
      if (state.status !== "running" || current.status !== "running") {
        return reject(
          "not-running",
          `工序「${current.label}」不在执行中`,
          "只有正在执行的工序才能报告阻塞",
          "等待作者处理当前状态",
        );
      }
      events.push({ type: "step_blocked", payload: { stepId: current.stepId, explanation: action.explanation } });
      if (current.onFailure === "retry" && current.attempt < current.maxAttempts) {
        steps[index] = { ...current, attempt: current.attempt + 1, note: action.explanation };
        events.push({ type: "step_retried", payload: { stepId: current.stepId, attempt: current.attempt + 1 } });
        return { ok: true, state: { status: "running", currentStepId: current.stepId, revision, steps }, events };
      }
      if (current.onFailure === "skip") {
        steps[index] = { ...current, status: "skipped", note: action.explanation };
        events.push({ type: "step_skipped", payload: { stepId: current.stepId } });
        return { ok: true, state: enterStep(steps, index + 1, revision, events), events };
      }
      steps[index] = { ...current, status: "failed", note: action.explanation };
      events.push({ type: "run_blocked", payload: { stepId: current.stepId } });
      return { ok: true, state: { status: "blocked", currentStepId: current.stepId, revision, steps }, events };
    }

    case "retry":
    case "skip": {
      if (state.status !== "blocked" || current.status !== "failed") {
        return reject(
          "not-blocked",
          `运行没有受阻（当前状态：${state.status}）`,
          action.type === "retry" ? "重试只用于处理受阻的工序" : "跳过只用于处理受阻的工序",
          "当前无需处理",
        );
      }
      if (action.type === "skip") {
        steps[index] = { ...current, status: "skipped" };
        events.push({ type: "step_skipped", payload: { stepId: current.stepId, by: "author" } });
        return { ok: true, state: enterStep(steps, index + 1, revision, events), events };
      }
      // 作者主动重试不受 maxAttempts 限制：上限只约束模型的自动重试。
      steps[index] = { ...current, status: "running", attempt: current.attempt + 1 };
      events.push({ type: "step_retried", payload: { stepId: current.stepId, attempt: current.attempt + 1, by: "author" } });
      return { ok: true, state: { status: "running", currentStepId: current.stepId, revision, steps }, events };
    }
  }
}
