/**
 * 叙述者侧的三个工作流工具：取当前工序、提交工序产物、报告阻塞。
 *
 * 运行由「可信书籍绑定 + 宿主注入的会话 id（= narratorId）」定位，模型输入里
 * 不含运行 id、书籍或叙述者标识。模型只能交候选、报阻塞，不能推进或结束运行——
 * 那是状态机与作者的事。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { rosterTemplatesForStep } from "../engine/agents/roster.js";
import type { ChapterLengthRule } from "./chapter-length-check.js";
import { buildDelegatedStepBrief, buildWorkflowRunBrief } from "../engine/workflows/run-brief.js";
import {
  getApprovedProse,
  reportWorkflowBlocker,
  submitWorkflowStepOutput,
} from "../engine/workflows/run-service.js";
import {
  getActiveWorkflowRunForNarrator,
  getLatestApprovedCandidate,
  getLatestCandidateOfKind,
  type WorkflowCandidateRecord,
  type WorkflowRunRecord,
  type WorkflowStoreResult,
} from "../engine/workflows/run-store.js";
import { runningSteps, type WorkflowRunStatus, type WorkflowStepStatus } from "../engine/workflows/run-state-machine.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

export const WORKFLOW_RUN_TOOL_NAMES = [
  "workflow.get_current_step",
  "workflow.submit_step_output",
  "workflow.report_blocker",
] as const;

/** 进度卡（Studio `workflow` 渲染器）的状态口径。 */
const CARD_RUN_STATUS: Record<WorkflowRunStatus, string> = {
  running: "running",
  awaiting_approval: "approval-pending",
  blocked: "failed",
  done: "completed",
  cancelled: "stopped",
};

const CARD_STEP_STATUS: Record<WorkflowStepStatus, string> = {
  pending: "pending",
  running: "running",
  awaiting_approval: "approval-pending",
  done: "success",
  skipped: "skipped",
  // 没被选中的分支：进度卡里按「跳过」显示，摘要注明原因。
  bypassed: "skipped",
  failed: "failed",
};

const PROSE_WRITE_TOOLS = new Set(["pipeline.write", "chapter.write"]);

function fail(error: string, summary: string, data?: unknown): RuntimeToolResult {
  return { ok: false, error, summary, ...(data === undefined ? {} : { data }) };
}

/** 工具结果数据：既是进度卡的输入，也带着模型需要的简报与版本号。 */
export function toWorkflowToolView(storage: StorageDatabase, run: WorkflowRunRecord): Record<string, unknown> {
  const needsProse = runningSteps(run.state).some((step) => step.tools.some((tool) => PROSE_WRITE_TOOLS.has(tool)));
  const approvedProse = needsProse ? getApprovedProse(storage, run) : null;
  return {
    title: `${run.recipe.name} · 第 ${run.chapterNumber} 章`,
    runId: run.id,
    runRevision: run.state.revision,
    runStatus: run.state.status,
    status: CARD_RUN_STATUS[run.state.status],
    currentStepId: run.state.currentStepId,
    steps: run.state.steps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      status: CARD_STEP_STATUS[step.status],
      ...(step.status === "bypassed" ? { summary: "所在分支没被选中" } : step.note ? { summary: step.note.what } : {}),
      ...(step.outcome ? { outcome: step.outcome } : {}),
    })),
    completedStepCount: run.state.steps.filter((step) => step.status === "done").length,
    totalStepCount: run.state.steps.length,
    brief: buildWorkflowRunBrief(run),
    // 落盘工序需要原样写入作者批准的正文；上下文被压缩后也能从这里取回。
    ...(approvedProse ? { approvedProse } : {}),
  };
}

/** 运行里当前进行中、且期望由该模板完成的工序。 */
export function delegatedStepIdsFor(run: WorkflowRunRecord, template: string): string[] {
  return runningSteps(run.state)
    .filter((step) => rosterTemplatesForStep(step).includes(template))
    .map((step) => step.stepId);
}

const CANDIDATE_TEXT_LIMIT = 60_000;

function candidateMaterial(candidate: WorkflowCandidateRecord | null): Record<string, unknown> | null {
  if (!candidate) return null;
  const text = JSON.stringify(candidate.payload ?? null);
  return {
    candidateId: candidate.id,
    stepId: candidate.stepId,
    decision: candidate.decision,
    payload: text.length > CANDIDATE_TEXT_LIMIT ? { truncated: true, preview: text.slice(0, CANDIDATE_TEXT_LIMIT) } : candidate.payload,
  };
}

/**
 * 委派子代理看到的运行视图：只有分给它的工序简报，以及做这道工序要用的上游候选原文
 * （蓝图、最近一版正文、最近一份审校）。正文原文只在这里给子代理，领导者那边只见候选 id。
 */
export function toDelegatedWorkflowView(
  storage: StorageDatabase,
  run: WorkflowRunRecord,
  template: string,
  allowedStepIds: readonly string[],
): Record<string, unknown> {
  const steps = run.state.steps.filter((step) => allowedStepIds.includes(step.stepId));
  return {
    runId: run.id,
    runRevision: run.state.revision,
    runStatus: run.state.status,
    chapterNumber: run.chapterNumber,
    template,
    assignedSteps: steps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      kind: step.expectedOutput,
      ...(step.outcomes.length > 0 ? { outcomes: step.outcomes } : {}),
      ...(step.note ? { note: step.note } : {}),
    })),
    brief: buildDelegatedStepBrief(run, template, allowedStepIds),
    upstream: {
      sceneSpec: candidateMaterial(getLatestApprovedCandidate(storage, run.id, "scene-spec")),
      prose: candidateMaterial(getLatestCandidateOfKind(storage, run.id, "prose")),
      audit: candidateMaterial(getLatestCandidateOfKind(storage, run.id, "audit")),
    },
  };
}

/** 子代理提交 / 报阻塞的结果：只回结论与候选 id，不回正文、不回领导者的整份简报。 */
function fromStoreDelegated(
  storage: StorageDatabase,
  result: WorkflowStoreResult<WorkflowRunRecord>,
  fallback: WorkflowRunRecord,
  template: string,
  candidateId: string | undefined,
): RuntimeToolResult {
  if (!result.ok) {
    const { what, why, action } = result.explanation;
    return fail(result.code, `${what}。${why}。${action}。`, {
      explanation: result.explanation,
      ...toDelegatedWorkflowView(storage, fallback, template, delegatedStepIdsFor(fallback, template)),
    });
  }
  const next = result.data;
  return {
    ok: true,
    summary: candidateId
      ? `已提交（候选 ${candidateId}）。把 3–6 行摘要和这个候选 id 交还领导者即可，不要贴正文。`
      : "已报告，交还领导者。",
    data: {
      runId: next.id,
      runRevision: next.state.revision,
      runStatus: next.state.status,
      ...(candidateId ? { candidateId } : {}),
    },
  };
}

function resolveNarratorId(context: ToolExecutionContext): string | null {
  const id = context.sessionId?.trim();
  return id ? id : null;
}

function activeRunFor(storage: StorageDatabase, binding: TrustedRuntimeBookBinding, narratorId: string): WorkflowRunRecord | null {
  const run = getActiveWorkflowRunForNarrator(storage, narratorId);
  // 运行必须属于当前可信绑定的书；对不上一律当作没有运行。
  return run && run.bookId === binding.bookId ? run : null;
}

/**
 * 本书的字数设置（book.json，pipeline.write 用的同一份）：目标字数与硬范围规则。
 * 读不到时两者都缺省——正文候选不做硬范围校验，落盘时 pipeline.write 仍会校验。
 */
async function readChapterLengthRule(bookRoot: string): Promise<ChapterLengthRule | undefined> {
  try {
    const config = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as { chapterWordCount?: unknown; language?: unknown };
    if (typeof config.chapterWordCount !== "number" || !Number.isSafeInteger(config.chapterWordCount) || config.chapterWordCount < 1) return undefined;
    return { chapterWordCount: config.chapterWordCount, language: config.language === "en" ? "en" : "zh" };
  } catch {
    return undefined;
  }
}

function fromStore(
  storage: StorageDatabase,
  result: WorkflowStoreResult<WorkflowRunRecord>,
  successSummary: (run: WorkflowRunRecord) => string,
  fallback: WorkflowRunRecord | null,
): RuntimeToolResult {
  if (result.ok) {
    return { ok: true, summary: successSummary(result.data), data: toWorkflowToolView(storage, result.data) };
  }
  const { what, why, action } = result.explanation;
  // 失败时附上当前运行的视图，模型据此重新对齐版本号与工序。
  return fail(result.code, `${what}。${why}。${action}。`, {
    explanation: result.explanation,
    ...(fallback ? toWorkflowToolView(storage, fallback) : {}),
  });
}

function nextStepSummary(run: WorkflowRunRecord): string {
  if (run.state.status === "done") return "工作流已完成。";
  if (run.state.status === "awaiting_approval") return "已提交，等待作者在「写作 › 工作流」确认；现在停止产出。";
  const running = runningSteps(run.state);
  if (running.length === 0) return "已提交。";
  return `进行中的工序：${running.map((step) => `「${step.label}」`).join("、")}，按返回的 brief 继续。`;
}

export async function executeWorkflowRunTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult | null> {
  // 入参可能是目录名（workflow.get_current_step）或线上名（workflow_get_current_step）。
  const wire = toolName.replace(/\./g, "_");
  const normalized = WORKFLOW_RUN_TOOL_NAMES.find((name) => name.replace(/\./g, "_") === wire);
  if (!normalized) return null;

  const sessionId = resolveNarratorId(context);
  if (!sessionId) {
    return fail("missing-session", "缺少宿主注入的会话标识，无法定位工作流运行。");
  }
  // 委派子代理（宿主按自己的记录解析，不来自模型输入）：运行属于它的领导者，
  // 且它只能操作当前与自己模板对应的工序。
  const delegation = context.delegatedBy;
  const narratorId = delegation?.narratorId ?? sessionId;
  const storage = getStorageDatabase();
  const run = activeRunFor(storage, binding, narratorId);
  const allowedStepIds = delegation && run ? delegatedStepIdsFor(run, delegation.template) : undefined;

  if (normalized === "workflow.get_current_step") {
    if (!run) {
      return { ok: true, summary: "当前没有进行中的创作工作流，按作者的普通指令继续即可。", data: { runStatus: "none", brief: null } };
    }
    if (delegation) {
      return {
        ok: true,
        summary: allowedStepIds && allowedStepIds.length > 0
          ? `第 ${run.chapterNumber} 章 · 分给你的工序：${allowedStepIds.join("、")}`
          : `第 ${run.chapterNumber} 章 · 现在没有分给你的工序`,
        data: toDelegatedWorkflowView(storage, run, delegation.template, allowedStepIds ?? []),
      };
    }
    return { ok: true, summary: `第 ${run.chapterNumber} 章 · ${run.recipe.name}：${run.state.status}`, data: toWorkflowToolView(storage, run) };
  }

  if (!run) {
    return fail("no-active-run", "当前没有进行中的创作工作流。工作流由作者在「写作 › 工作流」启动；没有运行时按作者的普通指令继续。");
  }
  const runRevision = typeof input.runRevision === "number" ? input.runRevision : Number.NaN;
  if (!Number.isInteger(runRevision)) {
    return fail("run-revision-required", "必须传入 runRevision（取自工序简报或 workflow_get_current_step）。", toWorkflowToolView(storage, run));
  }

  if (normalized === "workflow.submit_step_output") {
    const lengthRule = await readChapterLengthRule(binding.root);
    const wordTarget = lengthRule?.chapterWordCount;
    const capture: { candidateId?: string } = {};
    const result = submitWorkflowStepOutput({
      storage,
      narratorId,
      runRevision,
      kind: typeof input.kind === "string" ? input.kind : "",
      payload: input.payload,
      ...(typeof input.stepId === "string" && input.stepId.trim() ? { stepId: input.stepId.trim() } : {}),
      ...(typeof input.outcome === "string" && input.outcome.trim() ? { outcome: input.outcome.trim() } : {}),
      ...(wordTarget ? { wordTarget } : {}),
      ...(lengthRule ? { lengthRule } : {}),
      ...(allowedStepIds ? { allowedStepIds } : {}),
      capture,
    });
    if (delegation) return fromStoreDelegated(storage, result, run, delegation.template, capture.candidateId);
    const view = fromStore(storage, result, nextStepSummary, run);
    return result.ok && capture.candidateId
      ? { ...view, data: { ...(view.data as Record<string, unknown>), candidateId: capture.candidateId } }
      : view;
  }

  if (delegation) {
    const result = reportWorkflowBlocker({
      storage,
      narratorId,
      runRevision,
      allowedStepIds: allowedStepIds ?? [],
      ...(typeof input.stepId === "string" && input.stepId.trim() ? { stepId: input.stepId.trim() } : {}),
      explanation: {
        what: typeof input.what === "string" ? input.what : "",
        why: typeof input.why === "string" ? input.why : "",
        action: typeof input.action === "string" ? input.action : "",
      },
    });
    return fromStoreDelegated(storage, result, run, delegation.template, undefined);
  }

  const result = reportWorkflowBlocker({
    storage,
    narratorId,
    runRevision,
    ...(typeof input.stepId === "string" && input.stepId.trim() ? { stepId: input.stepId.trim() } : {}),
    explanation: {
      what: typeof input.what === "string" ? input.what : "",
      why: typeof input.why === "string" ? input.why : "",
      action: typeof input.action === "string" ? input.action : "",
    },
  });
  return fromStore(storage, result, (next) => next.state.status === "blocked"
    ? "已报告阻塞，等待作者选择重试、跳过或取消；期间不要调用写入工具。"
    : next.state.status === "running" && next.state.revision === run.state.revision + 1 && runningSteps(next.state).length === runningSteps(run.state).length
      ? "已报告阻塞，按方案自动重试本工序，请按 brief 里的说明调整后再做一次。"
      : nextStepSummary(next), run);
}
