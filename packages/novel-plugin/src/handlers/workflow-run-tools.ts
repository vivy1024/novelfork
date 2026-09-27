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

import { buildWorkflowRunBrief } from "../engine/workflows/run-brief.js";
import {
  getApprovedProse,
  reportWorkflowBlocker,
  submitWorkflowStepOutput,
} from "../engine/workflows/run-service.js";
import { getActiveWorkflowRunForNarrator, type WorkflowRunRecord, type WorkflowStoreResult } from "../engine/workflows/run-store.js";
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

function resolveNarratorId(context: ToolExecutionContext): string | null {
  const id = context.sessionId?.trim();
  return id ? id : null;
}

function activeRunFor(storage: StorageDatabase, binding: TrustedRuntimeBookBinding, narratorId: string): WorkflowRunRecord | null {
  const run = getActiveWorkflowRunForNarrator(storage, narratorId);
  // 运行必须属于当前可信绑定的书；对不上一律当作没有运行。
  return run && run.bookId === binding.bookId ? run : null;
}

async function readChapterWordTarget(bookRoot: string): Promise<number | undefined> {
  try {
    const config = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as { chapterWordCount?: unknown };
    return typeof config.chapterWordCount === "number" && config.chapterWordCount > 0 ? config.chapterWordCount : undefined;
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
  if (run.state.status === "awaiting_approval") return "已提交，等待作者在「故事推进 › 执行」确认；现在停止产出。";
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

  const narratorId = resolveNarratorId(context);
  if (!narratorId) {
    return fail("missing-session", "缺少宿主注入的会话标识，无法定位工作流运行。");
  }
  const storage = getStorageDatabase();
  const run = activeRunFor(storage, binding, narratorId);

  if (normalized === "workflow.get_current_step") {
    if (!run) {
      return { ok: true, summary: "当前没有进行中的创作工作流，按作者的普通指令继续即可。", data: { runStatus: "none", brief: null } };
    }
    return { ok: true, summary: `第 ${run.chapterNumber} 章 · ${run.recipe.name}：${run.state.status}`, data: toWorkflowToolView(storage, run) };
  }

  if (!run) {
    return fail("no-active-run", "当前没有进行中的创作工作流。工作流由作者在「故事推进 › 执行」启动；没有运行时按作者的普通指令继续。");
  }
  const runRevision = typeof input.runRevision === "number" ? input.runRevision : Number.NaN;
  if (!Number.isInteger(runRevision)) {
    return fail("run-revision-required", "必须传入 runRevision（取自工序简报或 workflow_get_current_step）。", toWorkflowToolView(storage, run));
  }

  if (normalized === "workflow.submit_step_output") {
    const wordTarget = await readChapterWordTarget(binding.root);
    const result = submitWorkflowStepOutput({
      storage,
      narratorId,
      runRevision,
      kind: typeof input.kind === "string" ? input.kind : "",
      payload: input.payload,
      ...(typeof input.stepId === "string" && input.stepId.trim() ? { stepId: input.stepId.trim() } : {}),
      ...(typeof input.outcome === "string" && input.outcome.trim() ? { outcome: input.outcome.trim() } : {}),
      ...(wordTarget ? { wordTarget } : {}),
    });
    return fromStore(storage, result, nextStepSummary, run);
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
