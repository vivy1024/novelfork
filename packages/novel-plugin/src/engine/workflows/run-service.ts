/**
 * 创作工作流运行的编排：候选校验、按类别提交进既有权威源、驱动状态机。
 *
 * 候选表不是新的权威源。提交路径只有一条是真写入：
 *   scene-spec → replaceChapterScenes → narrative_scene（机器场景一律 dynamic + needs-review）
 * 其余类别只留在候选表：
 *   prose → 作为「已批准正文」钉住；之后的落盘工序调用 pipeline.write / chapter.write 时，
 *           产品适配器要求写入内容与它逐字一致（见 findApprovedProseMismatch）
 *   audit / other → 仅供作者查看
 * 任何提交之前，权威源零变化；提交与状态迁移在同一事务里，失败整体回滚。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { parseSceneSpecValue } from "../../handlers/scene-spec-handler.js";
import { replaceChapterScenes, sceneFromSpec } from "../narrative-memory/scene-store.js";
import { buildWorkflowRunBrief } from "./run-brief.js";
import {
  WORKFLOW_CANDIDATE_KINDS,
  type WorkflowCandidateKind,
  type WorkflowExplanation,
  type WorkflowStepState,
} from "./run-state-machine.js";
import {
  applyWorkflowAction,
  createWorkflowRun,
  decideWorkflowCandidate,
  getActiveWorkflowRunForNarrator,
  getLatestApprovedCandidate,
  getLatestCandidate,
  getWorkflowRun,
  insertWorkflowCandidate,
  listWorkflowRunCandidates,
  listWorkflowRunEvents,
  type WorkflowCandidateRecord,
  type WorkflowRunEvent,
  type WorkflowRunRecord,
  type WorkflowStoreResult,
} from "./run-store.js";
import { readWorkflowRecipes } from "./workflow-store.js";

const MAX_PROSE_CHARS = 200_000;
const MAX_SUMMARY_CHARS = 20_000;

export type WorkflowServiceResult<T> = WorkflowStoreResult<T>;

function invalid<T>(code: string, explanation: WorkflowExplanation): WorkflowServiceResult<T> {
  return { ok: false, code, status: 400, explanation };
}

function currentStepOf(run: WorkflowRunRecord): WorkflowStepState | undefined {
  return run.state.steps.find((step) => step.stepId === run.state.currentStepId);
}

// ─── 启动 ────────────────────────────────────────────────────────────────────

export interface StartWorkflowRunInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly bookRoot: string;
  readonly recipeId: string;
  readonly chapterNumber: number;
  /** 已由调用方校验属于本书的叙述者。 */
  readonly narratorId: string;
}

export async function startWorkflowRun(input: StartWorkflowRunInput): Promise<WorkflowServiceResult<WorkflowRunRecord>> {
  const recipes = await readWorkflowRecipes(input.bookRoot);
  const recipe = recipes.find((candidate) => candidate.id === input.recipeId || candidate.commandId === input.recipeId);
  if (!recipe) {
    return { ok: false, code: "recipe-not-found", status: 404, explanation: {
      what: `找不到工作流方案「${input.recipeId}」`,
      why: "方案可能已被删除或改名",
      action: "刷新「执行」页，从下拉框重新选择方案",
    } };
  }
  return createWorkflowRun(input.storage, {
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    recipe,
    narratorId: input.narratorId,
  });
}

// ─── 候选校验 ────────────────────────────────────────────────────────────────

export interface CandidateValidation {
  readonly payload: unknown;
  readonly validation: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function countChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/** 按产物类别做确定性校验；不合格时说明缺什么，模型据此改后重交。 */
export function validateWorkflowCandidate(
  kind: WorkflowCandidateKind,
  payload: unknown,
  context: { readonly chapterNumber: number; readonly wordTarget?: number },
): { ok: true; value: CandidateValidation } | { ok: false; explanation: WorkflowExplanation } {
  const body = record(payload);
  if (!body) {
    return { ok: false, explanation: { what: "payload 必须是对象", why: "产物要按固定结构校验与展示", action: "按工序简报里的 payload 结构重新提交" } };
  }
  switch (kind) {
    case "scene-spec": {
      const spec = parseSceneSpecValue(body.sceneSpec, context.chapterNumber, context.wordTarget ?? 3000);
      if (!spec) {
        return { ok: false, explanation: {
          what: "镜头蓝图结构不合格",
          why: "sceneSpec 缺失，或 scenes 为空——没有场景就没有可落盘的蓝图",
          action: "提交 { sceneSpec: { chapter, title, wordTarget, scenes: [...至少一个场景], constraints } }",
        } };
      }
      if (spec.chapter !== context.chapterNumber) {
        return { ok: false, explanation: {
          what: `蓝图写的是第 ${spec.chapter} 章，本次运行推进的是第 ${context.chapterNumber} 章`,
          why: "蓝图会落成该章的场景，章号不对会写到别的章上",
          action: `把 sceneSpec.chapter 改为 ${context.chapterNumber} 后重交`,
        } };
      }
      return { ok: true, value: { payload: { sceneSpec: spec }, validation: { sceneCount: spec.scenes.length, wordTarget: spec.wordTarget } } };
    }
    case "prose": {
      const content = typeof body.content === "string" ? body.content : "";
      if (!content.trim()) {
        return { ok: false, explanation: { what: "正文为空", why: "本工序要交的是完整正文", action: "把全文放进 payload.content 后重交" } };
      }
      if (content.length > MAX_PROSE_CHARS) {
        return { ok: false, explanation: {
          what: `正文过长（${content.length} 字符）`,
          why: `单章上限 ${MAX_PROSE_CHARS} 字符，超出通常是把多章或上下文一起贴了进来`,
          action: "只提交本章正文",
        } };
      }
      const wordCount = countChars(content);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      return {
        ok: true,
        value: {
          payload: { ...(title ? { title } : {}), content },
          validation: {
            wordCount,
            ...(context.wordTarget ? { wordTarget: context.wordTarget, ratio: Math.round((wordCount / context.wordTarget) * 100) / 100 } : {}),
          },
        },
      };
    }
    case "audit": {
      if (typeof body.passed !== "boolean" || typeof body.summary !== "string" || !body.summary.trim()) {
        return { ok: false, explanation: {
          what: "审查结论缺字段",
          why: "作者靠 passed 与 summary 判断要不要放行",
          action: "提交 { passed: true|false, summary: \"结论\", issues: [...] }",
        } };
      }
      const issues = Array.isArray(body.issues) ? body.issues.filter((issue) => record(issue)) : [];
      const errors = issues.filter((issue) => (issue as Record<string, unknown>).severity === "error").length;
      return {
        ok: true,
        value: {
          payload: { passed: body.passed, summary: body.summary.trim().slice(0, MAX_SUMMARY_CHARS), issues },
          validation: { issueCount: issues.length, errorCount: errors },
        },
      };
    }
    case "other": {
      if (typeof body.summary !== "string" || !body.summary.trim()) {
        return { ok: false, explanation: { what: "工序小结为空", why: "作者要能看到这道工序做了什么", action: "提交 { summary: \"做了什么、结果如何\" }" } };
      }
      return { ok: true, value: { payload: { ...body, summary: body.summary.trim().slice(0, MAX_SUMMARY_CHARS) }, validation: {} } };
    }
  }
}

/** 把已通过（无需确认或已被批准）的候选提交进既有权威源；返回提交引用。 */
function commitCandidate(storage: StorageDatabase, run: WorkflowRunRecord, candidate: { kind: WorkflowCandidateKind; payload: unknown }): string | undefined {
  if (candidate.kind !== "scene-spec") return undefined;
  const spec = record(record(candidate.payload)?.sceneSpec);
  const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  const inputs = scenes.map((scene, index) =>
    sceneFromSpec(run.bookId, run.chapterNumber, index + 1, scene as Parameters<typeof sceneFromSpec>[3], {
      source: "workflow",
      layer: "dynamic",
      status: "needs-review",
    }),
  );
  const result = replaceChapterScenes(storage, run.bookId, run.chapterNumber, inputs);
  if (!result.ok) throw new Error(result.summary);
  return `narrative_scene:chapter-${run.chapterNumber}:${result.data?.length ?? 0}`;
}

// ─── 模型侧动作（经工具调用） ────────────────────────────────────────────────

export interface SubmitStepOutputInput {
  readonly storage: StorageDatabase;
  readonly narratorId: string;
  readonly runRevision: number;
  readonly kind: string;
  readonly payload: unknown;
  readonly wordTarget?: number;
}

function noActiveRun<T>(): WorkflowServiceResult<T> {
  return { ok: false, code: "no-active-run", status: 404, explanation: {
    what: "当前没有进行中的创作工作流",
    why: "工作流由作者在「故事推进 › 执行」启动，没有运行就没有工序可提交",
    action: "按作者的普通指令继续；需要工作流时请作者先启动",
  } };
}

export function submitWorkflowStepOutput(input: SubmitStepOutputInput): WorkflowServiceResult<WorkflowRunRecord> {
  const run = getActiveWorkflowRunForNarrator(input.storage, input.narratorId);
  if (!run) return noActiveRun();
  const step = currentStepOf(run);
  if (!step) return noActiveRun();
  if (!(WORKFLOW_CANDIDATE_KINDS as readonly string[]).includes(input.kind)) {
    return invalid("invalid-kind", { what: `产物类别「${input.kind}」无效`, why: `只接受 ${WORKFLOW_CANDIDATE_KINDS.join(" / ")}`, action: "按工序简报的 kind 重交" });
  }
  const kind = input.kind as WorkflowCandidateKind;
  if (step.expectedOutput === null) {
    return { ok: false, code: "gate-step", status: 409, explanation: {
      what: `「${step.label}」是人工门禁，不接收产物`,
      why: "门禁只等作者放行",
      action: "停止产出，等待作者确认",
    } };
  }
  if (kind !== step.expectedOutput) {
    return invalid("kind-mismatch", {
      what: `本工序要交的是 ${step.expectedOutput}，收到的是 ${kind}`,
      why: "每道工序的产物类别由方案决定，交错类别无法校验与展示",
      action: `改用 kind="${step.expectedOutput}" 重交`,
    });
  }
  const checked = validateWorkflowCandidate(kind, input.payload, {
    chapterNumber: run.chapterNumber,
    ...(input.wordTarget ? { wordTarget: input.wordTarget } : {}),
  });
  if (!checked.ok) return invalid("candidate-invalid", checked.explanation);

  return applyWorkflowAction(input.storage, run.id, input.runRevision, { type: "submit", stepId: step.stepId }, {
    beforeCommit: ({ next }) => {
      const candidateId = insertWorkflowCandidate(input.storage, {
        runId: run.id,
        stepId: step.stepId,
        kind,
        payload: checked.value.payload,
        validation: checked.value.validation,
      });
      // 无需确认的工序：提交即批准，立即写进权威源。
      const nextStep = next.steps.find((candidate) => candidate.stepId === step.stepId);
      if (nextStep?.status === "done") {
        const committedRef = commitCandidate(input.storage, run, { kind, payload: checked.value.payload });
        decideWorkflowCandidate(input.storage, { candidateId, decision: "approved", ...(committedRef ? { committedRef } : {}) });
      }
    },
  });
}

export interface ReportBlockerInput {
  readonly storage: StorageDatabase;
  readonly narratorId: string;
  readonly runRevision: number;
  readonly explanation: WorkflowExplanation;
}

export function reportWorkflowBlocker(input: ReportBlockerInput): WorkflowServiceResult<WorkflowRunRecord> {
  const run = getActiveWorkflowRunForNarrator(input.storage, input.narratorId);
  if (!run) return noActiveRun();
  const step = currentStepOf(run);
  if (!step) return noActiveRun();
  const { what, why, action } = input.explanation;
  if (![what, why, action].every((text) => typeof text === "string" && text.trim())) {
    return invalid("explanation-required", {
      what: "阻塞说明不完整",
      why: "作者要靠 what / why / action 三段决定重试、跳过还是取消",
      action: "三个字段都写清楚后重交",
    });
  }
  return applyWorkflowAction(input.storage, run.id, input.runRevision, {
    type: "block",
    stepId: step.stepId,
    explanation: { what: what.trim(), why: why.trim(), action: action.trim() },
  });
}

// ─── 作者侧动作（经 HTTP） ───────────────────────────────────────────────────

export interface AuthorActionInput {
  readonly storage: StorageDatabase;
  readonly runId: string;
  readonly expectedRevision: number;
}

export function approveWorkflowStep(input: AuthorActionInput & { readonly stepId: string; readonly note?: string }): WorkflowServiceResult<WorkflowRunRecord> {
  const run = getWorkflowRun(input.storage, input.runId);
  const candidate = run ? getLatestCandidate(input.storage, run.id, input.stepId) : null;
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, { type: "approve", stepId: input.stepId }, {
    beforeCommit: ({ run: current }) => {
      const step = currentStepOf(current);
      if (!candidate || step?.executorKind === "manual-gate" || candidate.decision !== "pending") return;
      const committedRef = commitCandidate(input.storage, current, candidate);
      decideWorkflowCandidate(input.storage, {
        candidateId: candidate.id,
        decision: "approved",
        ...(input.note ? { note: input.note } : {}),
        ...(committedRef ? { committedRef } : {}),
      });
    },
  });
}

export function rejectWorkflowStep(
  input: AuthorActionInput & { readonly stepId: string; readonly note: string; readonly selection?: unknown },
): WorkflowServiceResult<WorkflowRunRecord> {
  const note = input.note.trim();
  if (!note) {
    return invalid("note-required", {
      what: "打回需要写意见",
      why: "意见会原样进入叙述者下一次的工序简报，不写它就不知道改什么",
      action: "写明哪里不行、希望怎么改",
    });
  }
  const run = getWorkflowRun(input.storage, input.runId);
  const candidate = run ? getLatestCandidate(input.storage, run.id, input.stepId) : null;
  const selectionText = record(input.selection) && typeof (input.selection as Record<string, unknown>).text === "string"
    ? `（针对：「${String((input.selection as Record<string, unknown>).text).slice(0, 200)}」）`
    : "";
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, {
    type: "reject",
    stepId: input.stepId,
    note: { what: "作者打回了本工序的产物", why: `${note}${selectionText}`, action: "按意见修改后重新提交" },
  }, {
    beforeCommit: () => {
      if (!candidate || candidate.decision !== "pending") return;
      decideWorkflowCandidate(input.storage, {
        candidateId: candidate.id,
        decision: "rejected",
        note,
        ...(input.selection !== undefined ? { selection: input.selection } : {}),
      });
    },
  });
}

export function retryWorkflowStep(input: AuthorActionInput): WorkflowServiceResult<WorkflowRunRecord> {
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, { type: "retry" });
}

export function skipWorkflowStep(input: AuthorActionInput): WorkflowServiceResult<WorkflowRunRecord> {
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, { type: "skip" });
}

export function cancelWorkflowRun(input: AuthorActionInput): WorkflowServiceResult<WorkflowRunRecord> {
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, { type: "cancel" });
}

// ─── 视图 ────────────────────────────────────────────────────────────────────

export interface WorkflowRunDetail {
  readonly run: WorkflowRunRecord;
  readonly brief: string | null;
  readonly candidates: readonly WorkflowCandidateRecord[];
  readonly events: readonly WorkflowRunEvent[];
}

export function getWorkflowRunDetail(storage: StorageDatabase, runId: string, sinceSeq = 0): WorkflowRunDetail | null {
  const run = getWorkflowRun(storage, runId);
  if (!run) return null;
  return {
    run,
    brief: buildWorkflowRunBrief(run),
    candidates: listWorkflowRunCandidates(storage, runId),
    events: listWorkflowRunEvents(storage, runId, sinceSeq),
  };
}

// ─── 落盘守卫 ────────────────────────────────────────────────────────────────

const PROSE_WRITE_TOOLS = new Set(["pipeline.write", "chapter.write"]);

function normalizeProse(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * 运行里已有作者批准的正文时，落盘工具写入的 content 必须与它一致；
 * 否则作者审的是一份、落盘的是另一份。返回 null 表示放行。
 */
export function findApprovedProseMismatch(
  storage: StorageDatabase,
  run: WorkflowRunRecord,
  canonicalToolName: string,
  input: Readonly<Record<string, unknown>>,
): WorkflowExplanation | null {
  if (!PROSE_WRITE_TOOLS.has(canonicalToolName)) return null;
  const approved = getLatestApprovedCandidate(storage, run.id, "prose");
  const approvedContent = typeof record(approved?.payload)?.content === "string" ? String(record(approved?.payload)?.content) : null;
  if (approvedContent === null) return null;
  const content = typeof input.content === "string" ? input.content : "";
  if (normalizeProse(content) === normalizeProse(approvedContent)) return null;
  return {
    what: `${canonicalToolName} 要写入的正文与作者批准的版本不一致`,
    why: "作者在「执行」页批准的是另一份正文；落盘不同内容会让审过的和写进书里的对不上",
    action: "用 workflow_get_current_step 取回已批准的正文原样写入；若确需改动，先重新提交正文等作者确认",
  };
}

/** 本运行已批准的正文（供落盘工序原样写入）。 */
export function getApprovedProse(storage: StorageDatabase, run: WorkflowRunRecord): { title?: string; content: string } | null {
  const approved = getLatestApprovedCandidate(storage, run.id, "prose");
  const payload = record(approved?.payload);
  if (!payload || typeof payload.content !== "string") return null;
  return { ...(typeof payload.title === "string" ? { title: payload.title } : {}), content: payload.content };
}
