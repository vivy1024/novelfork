/**
 * 创作工作流运行状态机（纯函数，按工作流图推进）。
 *
 * 状态迁移只在后端发生：模型只能提交产物（submit）、报告阻塞（block），
 * 作者只能批准 / 打回 / 重试 / 跳过 / 取消。模型不能宣布「完成」——完成是
 * 所有终点都有了结果之后状态机自己推出来的。
 *
 * 推进规则（settle）：按正向拓扑序扫描，一道工序的入线「有结果」时才开始；
 * 入线来自没被选中的分支，则这道工序标为「未走到」（bypassed）并继续向下传递。
 * 汇合与终点等所有入线都有结果，只要有一条是真正走到的就算走到。
 * 运行级状态由各工序状态派生，不另存。
 *
 * 所有非法迁移都返回带三段式 explanation 的拒绝，而不是静默忽略：
 * 前端审批与模型提交会并发打同一个运行，拒绝理由必须能直接给作者看。
 */

import type { NovelWorkflowStepKind } from "./novel-workflows.js";
import {
  checkWorkflowGraph,
  forwardDescendants,
  nextEdges,
  requiresAuthorDecision,
  stepNodes,
  topologicalOrder,
  type WorkflowGraphEdge,
  type WorkflowGraphRecipe,
  type WorkflowStepNode,
} from "./workflow-graph.js";

export type WorkflowRunStatus = "running" | "awaiting_approval" | "blocked" | "done" | "cancelled";
/** bypassed：所在分支没被选中，这道工序不会执行。skipped：执行路径上被跳过，流程照常往下走。 */
export type WorkflowStepStatus = "pending" | "running" | "awaiting_approval" | "done" | "skipped" | "bypassed" | "failed";
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
  /** 正向拓扑序中的序号（从 1 开始），用于展示与简报排序。 */
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
  readonly enabled: boolean;
  /** 这道工序允许调用的写类小说工具（读类恒允许，不在此列）。 */
  readonly tools: readonly string[];
  /** 这道工序必须提交的产物类别；人工门禁工序为 null。 */
  readonly expectedOutput: WorkflowCandidateKind | null;
  /** 声明的提交结果；非空时提交必须给出其中之一，出线据此分支。 */
  readonly outcomes: readonly string[];
  /** 本轮提交给出的结果。 */
  readonly outcome?: string;
  /** 最近一次打回意见或阻塞说明，会进入下一次工序简报。 */
  readonly note?: WorkflowExplanation;
}

export interface WorkflowRunState {
  readonly status: WorkflowRunStatus;
  /** 焦点工序：第一道进行中的工序，其次是等待确认 / 受阻的；只用于展示与兼容，不参与推进。 */
  readonly currentStepId: string | null;
  readonly revision: number;
  readonly steps: readonly WorkflowStepState[];
}

export type WorkflowRunAction =
  | { readonly type: "submit"; readonly stepId: string; readonly outcome?: string }
  | { readonly type: "approve"; readonly stepId: string }
  | { readonly type: "reject"; readonly stepId: string; readonly note: WorkflowExplanation }
  | { readonly type: "block"; readonly stepId: string; readonly explanation: WorkflowExplanation }
  | { readonly type: "retry"; readonly stepId?: string }
  | { readonly type: "skip"; readonly stepId?: string }
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

function executorKindFor(step: WorkflowStepNode): WorkflowExecutorKind {
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
 * 由冻结的工作流派生工序模板（全部 pending、attempt 0），按正向拓扑序编号。
 * 建运行与从库里加载运行都用这一份映射，工序的静态属性只有一个来源。
 */
export function buildStepTemplates(recipe: WorkflowGraphRecipe): WorkflowStepState[] {
  const order = topologicalOrder(recipe) ?? recipe.nodes.map((node) => node.id);
  const byId = new Map(stepNodes(recipe).map((node) => [node.id, node]));
  const maxAttempts = Math.max(1, 1 + Math.max(0, Math.floor(recipe.maxRetries)));
  return order
    .filter((id) => byId.has(id))
    .map((id, index) => {
      const step = byId.get(id)!;
      return {
        stepId: step.id,
        ordinal: index + 1,
        label: step.label,
        kind: step.kind,
        status: "pending",
        attempt: 0,
        maxAttempts,
        executorKind: executorKindFor(step),
        ...(step.agentId ? { agentId: step.agentId } : {}),
        requiresApproval: requiresAuthorDecision(step),
        onFailure: step.onFailure ?? "stop",
        enabled: step.enabled,
        tools: [...(step.tools ?? [])],
        expectedOutput: expectedOutputFor(step.kind),
        outcomes: [...(step.outcomes ?? [])],
      };
    });
}

// ─── 推进 ────────────────────────────────────────────────────────────────────

type Delivery = "live" | "dead" | null;

/** 按工序状态与提交结果，算出每条「下一步」连线与每个结构节点当前是否已有结果。 */
function createDeliveryResolver(recipe: WorkflowGraphRecipe, steps: readonly WorkflowStepState[]) {
  const nodeById = new Map(recipe.nodes.map((node) => [node.id, node]));
  const stepById = new Map(steps.map((step) => [step.stepId, step]));
  const edges = nextEdges(recipe);
  const incoming = new Map<string, WorkflowGraphEdge[]>();
  const outgoing = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const nodeMemo = new Map<string, Delivery>();

  function edgeDelivery(edge: WorkflowGraphEdge): Delivery {
    const source = nodeById.get(edge.source);
    if (!source) return "dead";
    if (source.type !== "step") return nodeDelivery(source.id);
    const step = stepById.get(source.id);
    if (!step) return "dead";
    if (step.status === "bypassed") return "dead";
    if (step.status !== "done" && step.status !== "skipped") return null;
    if (step.outcomes.length === 0) return "live";
    // 分支工序：走与结果相符的线；没有相符的就走不带条件的默认线。
    const outs = outgoing.get(source.id) ?? [];
    const matched = outs.some((candidate) => candidate.outcome !== undefined && candidate.outcome === step.outcome);
    if (matched) return edge.outcome === step.outcome ? "live" : "dead";
    return edge.outcome === undefined ? "live" : "dead";
  }

  function nodeDelivery(nodeId: string): Delivery {
    if (nodeMemo.has(nodeId)) return nodeMemo.get(nodeId)!;
    const node = nodeById.get(nodeId);
    let result: Delivery;
    if (!node) result = "dead";
    else if (node.type === "start") result = "live";
    else {
      const states = (incoming.get(nodeId) ?? []).map(edgeDelivery);
      if (states.length === 0) result = "dead";
      else if (states.some((state) => state === null)) result = null;
      else result = states.some((state) => state === "live") ? "live" : "dead";
    }
    nodeMemo.set(nodeId, result);
    return result;
  }

  return { edgeDelivery, nodeDelivery, incoming };
}

/**
 * 从当前工序状态出发，把能开始的工序开始、走不到的工序标为未走到，并派生运行状态。
 * 按拓扑序单遍扫描即可：前驱总在后继之前处理。
 */
function settle(
  recipe: WorkflowGraphRecipe,
  input: readonly WorkflowStepState[],
  revision: number,
  events: WorkflowRunEventDraft[],
  previousStatus: WorkflowRunStatus | null,
): WorkflowRunState {
  const steps = [...input];
  const indexById = new Map(steps.map((step, index) => [step.stepId, index]));
  const order = topologicalOrder(recipe) ?? [];
  for (const nodeId of order) {
    const index = indexById.get(nodeId);
    if (index === undefined) continue;
    const step = steps[index]!;
    if (step.status !== "pending") continue;
    // 每处理一道工序都重建解析器：前面刚开始 / 跳过的工序会改变后面的入线结果。
    const { edgeDelivery, incoming } = createDeliveryResolver(recipe, steps);
    const inbound = (incoming.get(nodeId) ?? []).map(edgeDelivery);
    if (inbound.length === 0 || inbound.some((state) => state === null)) continue;
    if (!inbound.some((state) => state === "live")) {
      steps[index] = { ...step, status: "bypassed" };
      events.push({ type: "step_bypassed", payload: { stepId: step.stepId } });
      continue;
    }
    if (!step.enabled) {
      steps[index] = { ...step, status: "skipped" };
      events.push({ type: "step_skipped", payload: { stepId: step.stepId, reason: "disabled" } });
      continue;
    }
    const gate = step.executorKind === "manual-gate";
    steps[index] = { ...step, status: gate ? "awaiting_approval" : "running", attempt: step.attempt + 1 };
    events.push({ type: gate ? "step_awaiting_approval" : "step_started", payload: { stepId: step.stepId, attempt: step.attempt + 1 } });
  }

  const status = deriveRunStatus(recipe, steps);
  if (status === "done" && previousStatus !== "done") events.push({ type: "run_done", payload: {} });
  if (status === "blocked" && previousStatus !== "blocked") {
    const failed = steps.find((step) => step.status === "failed");
    events.push({ type: "run_blocked", payload: { stepId: failed?.stepId ?? null } });
  }
  return { status, currentStepId: focusStepId(steps), revision, steps };
}

function deriveRunStatus(recipe: WorkflowGraphRecipe, steps: readonly WorkflowStepState[]): WorkflowRunStatus {
  if (steps.some((step) => step.status === "failed")) return "blocked";
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "awaiting_approval")) return "awaiting_approval";
  const { nodeDelivery } = createDeliveryResolver(recipe, steps);
  const ends = recipe.nodes.filter((node) => node.type === "end");
  return ends.length > 0 && ends.every((node) => nodeDelivery(node.id) !== null) ? "done" : "running";
}

function focusStepId(steps: readonly WorkflowStepState[]): string | null {
  for (const status of ["running", "awaiting_approval", "failed"] as const) {
    const step = steps.find((candidate) => candidate.status === status);
    if (step) return step.stepId;
  }
  return null;
}

/** 进行中（模型该做事）的工序，按序号排列。 */
export function runningSteps(state: Pick<WorkflowRunState, "steps">): WorkflowStepState[] {
  return state.steps.filter((step) => step.status === "running");
}

/** 用冻结的工作流建运行的初始状态。结构有问题的工作流不能运行。 */
export function createRunState(recipe: WorkflowGraphRecipe): WorkflowTransition {
  const issues = checkWorkflowGraph(recipe);
  if (issues.length > 0) {
    const first = issues[0]!.explanation;
    return reject(
      "graph-invalid",
      `工作流「${recipe.name}」的结构有 ${issues.length} 处问题，无法运行：${first.what}`,
      first.why,
      `到「写作 › 工作流」的画布上修好后再启动（${first.action}）`,
    );
  }
  if (!stepNodes(recipe).some((step) => step.enabled)) {
    return reject(
      "no-enabled-steps",
      `工作流「${recipe.name}」没有启用的工序`,
      "工作流按工序推进，一道工序都没有就无事可做",
      "在画布上启用至少一道工序后再启动",
    );
  }
  const events: WorkflowRunEventDraft[] = [{ type: "run_started", payload: { recipeId: recipe.id } }];
  const state = settle(recipe, buildStepTemplates(recipe), 0, events, null);
  return { ok: true, state, events };
}

function staleStep(stepId: string, state: WorkflowRunState): WorkflowTransition {
  const active = state.steps.filter((step) => step.status === "running" || step.status === "awaiting_approval").map((step) => step.label);
  return reject(
    "stale-step",
    `工序 ${stepId} 现在不能这样操作（进行中：${active.join("、") || "无"}）`,
    "只能操作正在进行或等待确认的工序，旧工序的操作多半来自过期的页面或模型记错了进度",
    "重新读取运行状态（叙述者调用 workflow_get_current_step，作者刷新「工作流」页）后再操作",
  );
}

/** 对运行执行一个动作。每次成功迁移 revision + 1。 */
export function transition(recipe: WorkflowGraphRecipe, state: WorkflowRunState, action: WorkflowRunAction): WorkflowTransition {
  if (isTerminal(state.status)) {
    return reject(
      "run-finished",
      `这个运行已${state.status === "done" ? "完成" : "取消"}`,
      "已结束的运行不再接受任何操作",
      "如需继续，请在「写作 › 工作流」重新启动一个运行",
    );
  }

  const steps = [...state.steps];
  const events: WorkflowRunEventDraft[] = [];
  const revision = state.revision + 1;
  const done = (): WorkflowTransition => ({ ok: true, state: settle(recipe, steps, revision, events, state.status), events });

  if (action.type === "cancel") {
    events.push({ type: "run_cancelled", payload: { stepId: state.currentStepId } });
    return { ok: true, state: { status: "cancelled", currentStepId: state.currentStepId, revision, steps }, events };
  }

  if (action.type === "retry" || action.type === "skip") {
    const failed = action.stepId
      ? steps.findIndex((step) => step.stepId === action.stepId && step.status === "failed")
      : steps.findIndex((step) => step.status === "failed");
    if (failed < 0) {
      return reject(
        "not-blocked",
        `运行没有受阻的工序（当前状态：${state.status}）`,
        action.type === "retry" ? "重试只用于处理受阻的工序" : "跳过只用于处理受阻的工序",
        "当前无需处理",
      );
    }
    const current = steps[failed]!;
    if (action.type === "skip") {
      if (current.outcomes.length > 0) {
        return reject(
          "branch-cannot-skip",
          `「${current.label}」是分支工序，不能跳过`,
          "跳过就没有结果，不知道该走哪条分支",
          "选择重试，或取消运行",
        );
      }
      steps[failed] = { ...current, status: "skipped" };
      events.push({ type: "step_skipped", payload: { stepId: current.stepId, by: "author" } });
      return done();
    }
    // 作者主动重试不受 maxAttempts 限制：上限只约束模型的自动重试。
    steps[failed] = { ...current, status: "running", attempt: current.attempt + 1 };
    events.push({ type: "step_retried", payload: { stepId: current.stepId, attempt: current.attempt + 1, by: "author" } });
    return done();
  }

  const index = steps.findIndex((step) => step.stepId === action.stepId);
  const current = index >= 0 ? steps[index] : undefined;
  if (!current) {
    return reject("unknown-step", `工作流里没有工序「${action.stepId}」`, "工序 id 必须来自当前运行", "重新读取运行状态后再操作");
  }

  switch (action.type) {
    case "submit": {
      if (current.status !== "running") {
        if (current.status === "awaiting_approval") {
          return reject(
            "not-accepting-output",
            `工序「${current.label}」现在不接收产物`,
            "上一份产物正在等作者确认，此时再交会让作者审的内容和最终落盘的对不上",
            "停止产出，等待作者在「工作流」页确认或打回",
          );
        }
        return staleStep(current.stepId, state);
      }
      if (state.status === "blocked") {
        return reject(
          "run-blocked",
          `运行受阻中，暂不接收「${current.label}」的产物`,
          "有工序失败且设为停止，作者要先决定重试、跳过还是取消",
          "等待作者处理受阻的工序",
        );
      }
      let outcome: string | undefined;
      if (current.outcomes.length > 0) {
        if (!action.outcome || !current.outcomes.includes(action.outcome)) {
          return reject(
            "outcome-required",
            `「${current.label}」要给出结果：${current.outcomes.join(" / ")}（收到：${action.outcome ?? "未填"}）`,
            "这道工序之后的流程按结果分支",
            `提交时带上 outcome，取 ${current.outcomes.join(" / ")} 之一`,
          );
        }
        outcome = action.outcome;
      }
      events.push({ type: "candidate_submitted", payload: { stepId: current.stepId, ...(outcome ? { outcome } : {}) } });
      const withOutcome = { ...current, ...(outcome !== undefined ? { outcome } : {}) };
      if (current.requiresApproval) {
        steps[index] = { ...withOutcome, status: "awaiting_approval" };
        events.push({ type: "step_awaiting_approval", payload: { stepId: current.stepId } });
        return done();
      }
      steps[index] = { ...withOutcome, status: "done" };
      events.push({ type: "step_done", payload: { stepId: current.stepId } });
      return done();
    }

    case "approve": {
      if (current.status !== "awaiting_approval") {
        return reject(
          "nothing-to-approve",
          `工序「${current.label}」没有待确认的产物`,
          "只有提交后等待确认的工序才能批准",
          "等叙述者提交本工序产物后再批准",
        );
      }
      steps[index] = { ...current, status: "done" };
      events.push({ type: "step_approved", payload: { stepId: current.stepId } });
      return done();
    }

    case "reject": {
      if (current.status !== "awaiting_approval") {
        return reject(
          "nothing-to-reject",
          `工序「${current.label}」没有待确认的产物`,
          "只有提交后等待确认的工序才能打回",
          "等叙述者提交本工序产物后再打回",
        );
      }
      const rejectEdge = recipe.edges.find((edge) => edge.kind === "reject" && edge.source === current.stepId);
      if (rejectEdge) {
        // 打回上游：目标工序及其全部正向下游重置，从目标工序重做。
        const targetId = rejectEdge.target;
        const reset = new Set([targetId, ...forwardDescendants(recipe, targetId)]);
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]!;
          if (!reset.has(step.stepId)) continue;
          const { outcome: _outcome, note: _note, ...rest } = step;
          steps[i] = { ...rest, status: "pending", ...(step.stepId === targetId ? { note: action.note } : {}) };
        }
        events.push({ type: "step_rejected", payload: { stepId: current.stepId, note: action.note, returnTo: targetId } });
        return done();
      }
      if (current.executorKind === "manual-gate") {
        return reject(
          "gate-cannot-reject",
          `「${current.label}」是人工门禁，没有可打回的产物`,
          "门禁只决定是否放行；要打回，需要在画布上从它连一条打回线到要重做的工序",
          "放行请批准；不想继续请取消运行",
        );
      }
      const { outcome: _outcome, ...rest } = current;
      steps[index] = { ...rest, status: "running", attempt: current.attempt + 1, note: action.note };
      events.push({ type: "step_rejected", payload: { stepId: current.stepId, note: action.note } });
      return done();
    }

    case "block": {
      if (current.status !== "running") return staleStep(current.stepId, state);
      if (state.status === "blocked") {
        return reject(
          "run-blocked",
          "运行已受阻，等待作者处理",
          "同一时间只处理一处受阻，避免作者面对多个互相影响的失败",
          "等待作者处理受阻的工序",
        );
      }
      events.push({ type: "step_blocked", payload: { stepId: current.stepId, explanation: action.explanation } });
      if (current.onFailure === "retry" && current.attempt < current.maxAttempts) {
        steps[index] = { ...current, attempt: current.attempt + 1, note: action.explanation };
        events.push({ type: "step_retried", payload: { stepId: current.stepId, attempt: current.attempt + 1 } });
        return done();
      }
      if (current.onFailure === "skip" && current.outcomes.length === 0) {
        steps[index] = { ...current, status: "skipped", note: action.explanation };
        events.push({ type: "step_skipped", payload: { stepId: current.stepId } });
        return done();
      }
      steps[index] = { ...current, status: "failed", note: action.explanation };
      return done();
    }
  }
}
