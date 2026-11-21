/**
 * 叙述者侧的三个工作流工具：取当前工序、提交工序产物、报告阻塞。
 *
 * 运行由「可信书籍绑定 + 宿主注入的会话 id（= narratorId）」定位，模型输入里
 * 不含运行 id、书籍或叙述者标识。模型只能交候选、报阻塞，不能推进或结束运行——
 * 那是状态机与作者的事。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { rosterTemplatesForStep } from "../engine/agents/roster.js";
import {
  CHAPTERS_DIRECTORY,
  chapterRelativePath,
  chapterTitleFromContent,
  listChapterFiles,
  normalizeChapterRelativePath,
  parseChapterFileName,
} from "../engine/writing-resource/chapter-layout.js";
import { createChapterFileResolver } from "../engine/writing-resource/chapter-path-guard.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";
import type { ChapterLengthRule } from "./chapter-length-check.js";
import { buildDelegatedStepBrief, buildWorkflowRunBrief } from "../engine/workflows/run-brief.js";
import { checkWorkflowDraftFilePath } from "../engine/workflows/draft-write-scope.js";
import {
  getApprovedProse,
  reportWorkflowBlocker,
  submitWorkflowStepOutput,
} from "../engine/workflows/run-service.js";
import {
  getActiveWorkflowRunForNarrator,
  getLatestApprovedCandidate,
  getLatestCandidateOfKind,
  listWorkflowRunCandidates,
  type WorkflowCandidateRecord,
  type WorkflowRunRecord,
  type WorkflowStoreResult,
} from "../engine/workflows/run-store.js";
import { runningSteps, type WorkflowRunStatus, type WorkflowStepStatus } from "../engine/workflows/run-state-machine.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

export const WORKFLOW_RUN_TOOL_NAMES = [
  "workflow.step",
] as const;

/** 进度卡（Studio `workflow` 渲染器）的状态口径。 */
const CARD_RUN_STATUS: Record<WorkflowRunStatus, string> = {
  running: "running",
  awaiting_approval: "approval-pending",
  blocked: "failed",
  done: "completed",
  cancelled: "stopped",
};

/** 推算工作流当前章节的目标草稿相对路径（chapters/卷XX/XXXX_标题.md），优先复用磁盘已有章文件。 */
async function resolveWorkflowTargetChapterPath(
  storage: StorageDatabase,
  binding: TrustedRuntimeBookBinding,
  run: WorkflowRunRecord,
  preferredTitle?: string,
): Promise<string> {
  const existingFiles = await listChapterFiles(binding.root).catch(() => []);
  const existing = existingFiles.find((file) => file.number === run.chapterNumber);
  if (existing) return existing.relativePath;
  const approvedSpec = getLatestApprovedCandidate(storage, run.id, "scene-spec");
  const specObj = approvedSpec?.payload && typeof approvedSpec.payload === "object"
    ? (approvedSpec.payload as { sceneSpec?: { title?: unknown } }).sceneSpec
    : undefined;
  const specTitle = typeof specObj?.title === "string" ? specObj.title.trim() : "";
  const title = preferredTitle?.trim() || specTitle || `第${run.chapterNumber}章`;
  const volDir = resolveChapterVolumeDirectory(storage, run.bookId, run.chapterNumber);
  return `${CHAPTERS_DIRECTORY}/${chapterRelativePath(volDir, run.chapterNumber, title)}`;
}

/**
 * 方案 1（统一流式写盘）：
 * - 当 submit(kind="prose") 传入 filePath（不重复传 content）时，自动从磁盘读取草稿正文补齐 content，
 *   并保留 filePath 供下游审校与最终 chapter.commit 定位；
 * - 当 submit(kind="prose") 仅传入 content（兼容既有调用与旧测试）时，顺带镜像写入磁盘草稿文件，
 *   让编辑器立即呈现未入库草稿（uncommitted），作者可直接审阅与手改。
 */
async function hydrateOrMirrorWorkflowProsePayload(
  storage: StorageDatabase,
  binding: TrustedRuntimeBookBinding,
  run: WorkflowRunRecord,
  rawPayload: unknown,
): Promise<{ readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly result: RuntimeToolResult }> {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return { ok: true, payload: rawPayload };
  }
  const body = rawPayload as Record<string, unknown>;
  const rawContent = typeof body.content === "string" ? body.content : "";
  const rawFilePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
  const chaptersDir = join(binding.root, CHAPTERS_DIRECTORY);
  const resolveChapterFile = createChapterFileResolver(chaptersDir);

  // 交稿路径只能是本运行这一章的章节文件：不接受索引、废稿、其他章节或书内其他数据文件
  // （否则既能把任意书内文件当正文登记，也能借镜像落盘把 content 写进 chapters/index.json）。
  if (rawFilePath) {
    const pathCheck = checkWorkflowDraftFilePath(rawFilePath, run.chapterNumber);
    if (!pathCheck.ok) {
      const { what, why, action } = pathCheck.explanation;
      return { ok: false, result: fail("invalid-file-path", `${what}。${why}。${action}。`, { explanation: pathCheck.explanation }) };
    }
  }

  if (!rawContent.trim() && rawFilePath) {
    const normalizedRel = normalizeChapterRelativePath(rawFilePath);
    const chapterRel = normalizedRel.startsWith(`${CHAPTERS_DIRECTORY}/`)
      ? normalizedRel.slice(CHAPTERS_DIRECTORY.length + 1)
      : normalizedRel;
    const absPath = resolveChapterFile(chapterRel);
    if (!absPath) {
      return { ok: false, result: fail("invalid-file-path", `filePath 必须指向本书 chapters/ 目录内的章节文件（收到：${rawFilePath}）。`) };
    }
    try {
      const diskContent = await readFile(absPath, "utf8");
      const parsed = parseChapterFileName(basename(absPath));
      const title = (typeof body.title === "string" && body.title.trim())
        || (parsed ? chapterTitleFromContent(parsed, diskContent) : undefined);
      return {
        ok: true,
        payload: {
          ...body,
          ...(title ? { title } : {}),
          content: diskContent,
          filePath: `${CHAPTERS_DIRECTORY}/${chapterRel}`,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          ok: false,
          result: fail("draft-file-not-found", `找不到草稿文件 ${rawFilePath}，请先用原生 Write 写入章节草稿后再提交。`),
        };
      }
      throw error;
    }
  }

  // 若未传 filePath 但传了 content，尝试镜像到章节草稿路径（不改 chapters/index.json，保持 uncommitted 态）
  if (rawContent.trim()) {
    try {
      const targetRel = rawFilePath
        ? (() => {
            const norm = normalizeChapterRelativePath(rawFilePath);
            return norm.startsWith(`${CHAPTERS_DIRECTORY}/`) ? norm : `${CHAPTERS_DIRECTORY}/${norm}`;
          })()
        : await resolveWorkflowTargetChapterPath(
            storage,
            binding,
            run,
            typeof body.title === "string" ? body.title : undefined,
          );
      const chapterRel = targetRel.slice(CHAPTERS_DIRECTORY.length + 1);
      const absPath = resolveChapterFile(chapterRel);
      if (absPath) {
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, rawContent, "utf8");
        return { ok: true, payload: { ...body, filePath: targetRel } };
      }
    } catch {
      // 镜像落盘失败不影响候选提交本身
    }
  }
  return { ok: true, payload: rawPayload };
}

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

const PROSE_WRITE_TOOLS = new Set(["chapter.commit"]);

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

/** 每道工序只留最近一份候选（候选按提交时间升序）。 */
function latestPerStep(candidates: readonly WorkflowCandidateRecord[]): WorkflowCandidateRecord[] {
  const byStep = new Map<string, WorkflowCandidateRecord>();
  for (const candidate of candidates) byStep.set(candidate.stepId, candidate);
  return [...byStep.values()];
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
  targetChapterPath?: string,
): Record<string, unknown> {
  const steps = run.state.steps.filter((step) => allowedStepIds.includes(step.stepId));
  return {
    runId: run.id,
    runRevision: run.state.revision,
    runStatus: run.state.status,
    chapterNumber: run.chapterNumber,
    ...(targetChapterPath ? { targetChapterPath } : {}),
    template,
    assignedSteps: steps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      kind: step.expectedOutput,
      ...(step.outcomes.length > 0 ? { outcomes: step.outcomes } : {}),
      ...(step.note ? { note: step.note } : {}),
    })),
    brief: buildDelegatedStepBrief(run, template, allowedStepIds, targetChapterPath ? { targetChapterPath } : undefined),
    upstream: {
      sceneSpec: candidateMaterial(getLatestApprovedCandidate(storage, run.id, "scene-spec")),
      prose: candidateMaterial(getLatestCandidateOfKind(storage, run.id, "prose")),
      audit: candidateMaterial(getLatestCandidateOfKind(storage, run.id, "audit")),
      // 并行审校（如精修一章）：每道审校工序各取最近一份，返修要逐份落实。
      audits: latestPerStep(listWorkflowRunCandidates(storage, run.id).filter((candidate) => candidate.kind === "audit")).map(candidateMaterial),
      outline: candidateMaterial(getLatestCandidateOfKind(storage, run.id, "outline")),
      // 自定义工序的小结（如市场分析），供下游大纲推演参考。
      notes: latestPerStep(listWorkflowRunCandidates(storage, run.id).filter((candidate) => candidate.kind === "other")).map(candidateMaterial),
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
  const wire = toolName.replace(/\./g, "_");
  if (wire !== "workflow_step") return null;

  const stepAction = typeof input.action === "string" ? input.action.trim().toLowerCase() : "current";
  if (stepAction !== "current" && stepAction !== "submit" && stepAction !== "blocker") {
    return fail("invalid-action", `未知的 workflow.step action：${String(input.action ?? "")}。支持 current | submit | blocker。`);
  }

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

  if (stepAction === "current") {
    if (!run) {
      return { ok: true, summary: "当前没有进行中的创作工作流，按作者的普通指令继续即可。", data: { runStatus: "none", brief: null } };
    }
    const targetChapterPath = await resolveWorkflowTargetChapterPath(storage, binding, run);
    if (delegation) {
      return {
        ok: true,
        summary: allowedStepIds && allowedStepIds.length > 0
          ? `第 ${run.chapterNumber} 章 · 分给你的工序：${allowedStepIds.join("、")}`
          : `第 ${run.chapterNumber} 章 · 现在没有分给你的工序`,
        data: toDelegatedWorkflowView(storage, run, delegation.template, allowedStepIds ?? [], targetChapterPath),
      };
    }
    return {
      ok: true,
      summary: `第 ${run.chapterNumber} 章 · ${run.recipe.name}：${run.state.status}`,
      data: { ...toWorkflowToolView(storage, run), targetChapterPath },
    };
  }

  if (!run) {
    return fail("no-active-run", "当前没有进行中的创作工作流。工作流由作者在「写作 › 工作流」启动；没有运行时按作者的普通指令继续。");
  }
  const runRevision = typeof input.runRevision === "number" ? input.runRevision : Number.NaN;
  if (!Number.isInteger(runRevision)) {
    return fail("run-revision-required", "必须传入 runRevision（取自工序简报或 workflow_step action=current）。", toWorkflowToolView(storage, run));
  }

  if (stepAction === "submit") {
    const lengthRule = await readChapterLengthRule(binding.root);
    const wordTarget = lengthRule?.chapterWordCount;
    const capture: { candidateId?: string } = {};
    const kind = typeof input.kind === "string" ? input.kind : "";
    let submitPayload: unknown = input.payload;
    if (submitPayload === undefined && typeof input.payloadJson === "string" && input.payloadJson.trim()) {
      try {
        submitPayload = JSON.parse(input.payloadJson);
      } catch {
        return fail("invalid-payload-json", "payloadJson 不是合法的 JSON 字符串。");
      }
    }
    if (kind === "prose") {
      const prepared = await hydrateOrMirrorWorkflowProsePayload(storage, binding, run, submitPayload);
      if (!prepared.ok) return prepared.result;
      submitPayload = prepared.payload;
    }
    const result = submitWorkflowStepOutput({
      storage,
      narratorId,
      runRevision,
      kind,
      payload: submitPayload,
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

  // action === "blocker"
  const blockerAction = typeof input.suggestion === "string" && input.suggestion.trim()
    ? input.suggestion
    : "";
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
        action: blockerAction,
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
      action: blockerAction,
    },
  });
  return fromStore(storage, result, (next) => next.state.status === "blocked"
    ? "已报告阻塞，等待作者选择重试、跳过或取消；期间不要调用写入工具。"
    : next.state.status === "running" && next.state.revision === run.state.revision + 1 && runningSteps(next.state).length === runningSteps(run.state).length
      ? "已报告阻塞，按方案自动重试本工序，请按 brief 里的说明调整后再做一次。"
      : nextStepSummary(next), run);
}
