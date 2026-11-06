/**
 * 创作工作流运行的编排：候选校验、按类别提交进既有权威源、驱动状态机。
 *
 * 候选表不是新的权威源。提交路径只有一条是真写入：
 *   scene-spec → replaceChapterScenes → narrative_scene（机器场景一律 dynamic + needs-review）
 * 其余类别只留在候选表：
 *   prose → 作为「已批准正文」钉住；之后的落盘工序调用 pipeline.write / chapter.write 时，
 *           产品适配器要求写入内容与它逐字一致（见 findApprovedProseMismatch）
 *   audit / outline / other → 仅供作者查看（outline 经作者确认后由叙述者自己落到卷纲，引擎不代写）
 * 任何提交之前，权威源零变化；提交与状态迁移在同一事务里，失败整体回滚。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { checkChapterHardLength, describeLengthGap, type ChapterLengthRule } from "../../handlers/chapter-length-check.js";
import { parseSceneSpecValue } from "../../handlers/scene-spec-handler.js";
import { replaceChapterScenes, sceneFromSpec } from "../narrative-memory/scene-store.js";
import { buildWorkflowRunBrief } from "./run-brief.js";
import {
  runningSteps,
  WORKFLOW_CANDIDATE_KINDS,
  type WorkflowAuditVerdict,
  type WorkflowCandidateKind,
  type WorkflowExplanation,
  type WorkflowRunState,
  type WorkflowStepState,
} from "./run-state-machine.js";
import {
  applyWorkflowAction,
  createWorkflowRun,
  decideWorkflowCandidate,
  getActiveWorkflowRunForNarrator,
  getLatestApprovedCandidate,
  getLatestCandidate,
  getLatestPendingCandidate,
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
/** 大纲候选单次最多推演的章数。 */
const MAX_OUTLINE_CHAPTERS = 30;

export type WorkflowServiceResult<T> = WorkflowStoreResult<T>;

function invalid<T>(code: string, explanation: WorkflowExplanation): WorkflowServiceResult<T> {
  return { ok: false, code, status: 400, explanation };
}

/**
 * 模型要操作的工序：给了 stepId 就用它；没给时只有一道进行中的工序才能推断，
 * 有多道并行时必须指明，否则提交可能落到错误的分支上。
 */
function targetStepOf<T>(run: WorkflowRunRecord, stepId: string | undefined): { step: WorkflowStepState } | { error: WorkflowServiceResult<T> } {
  if (stepId) {
    const step = run.state.steps.find((candidate) => candidate.stepId === stepId);
    if (step) return { step };
    return { error: invalid("unknown-step", {
      what: `工作流里没有工序「${stepId}」`,
      why: "stepId 必须取自工序简报",
      action: "调用 workflow_get_current_step 重新读取进行中的工序",
    }) };
  }
  const running = runningSteps(run.state);
  if (running.length === 1) return { step: running[0]! };
  if (running.length === 0) {
    const waiting = run.state.steps.find((step) => step.status === "awaiting_approval" || step.status === "failed");
    return waiting ? { step: waiting } : { error: noActiveRun() };
  }
  return { error: invalid("step-id-required", {
    what: `现在有 ${running.length} 道工序同时进行：${running.map((step) => `${step.label}（${step.stepId}）`).join("、")}`,
    why: "并行分支各自提交，不指明就不知道这份产物属于哪一道",
    action: "带上 stepId 重新调用",
  }) };
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
      action: "刷新「工作流」页，从下拉框重新选择方案",
    } };
  }
  if (recipe.status !== "published") {
    return { ok: false, code: "recipe-not-published", status: 409, explanation: {
      what: `「${recipe.name}」还是草稿，不能运行`,
      why: recipe.createdBy === "narrator"
        ? "叙述者建的工作流要作者在画布上确认后才能运行"
        : "草稿可能还有没修好的结构问题",
      action: "在「写作 › 工作流」的画布上检查并发布它",
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
  context: {
    readonly chapterNumber: number;
    readonly wordTarget?: number;
    /** 本书字数硬范围规则；给了就按与 pipeline.write 相同的口径校验正文。 */
    readonly lengthRule?: ChapterLengthRule;
  },
): { ok: true; value: CandidateValidation; code?: undefined } | { ok: false; explanation: WorkflowExplanation; code?: string } {
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
      if (context.lengthRule) {
        // 与 pipeline.write 落盘前的硬校验同一函数：过不了落盘的正文，在这里就不让它进审校与作者确认。
        const violation = checkChapterHardLength(content, context.lengthRule);
        if (violation) {
          return {
            ok: false,
            code: "length-out-of-range",
            explanation: {
              what: `正文 ${violation.count}${violation.unit}，不在本书 ${violation.target}${violation.unit} 的硬范围 ${violation.hardMin}-${violation.hardMax} 内（${describeLengthGap(violation)}）`,
              why: "落盘（pipeline.write）按同一硬范围拒存；不合格的正文过了审校和作者确认也写不进书里",
              action: violation.delta < 0
                ? `补写到至少 ${violation.hardMin}${violation.unit}（目标 ${violation.target}${violation.unit}）后重交`
                : `删减到不超过 ${violation.hardMax}${violation.unit}（目标 ${violation.target}${violation.unit}）后重交`,
            },
          };
        }
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
    case "outline": {
      const summary = typeof body.summary === "string" ? body.summary.trim() : "";
      const chapters = Array.isArray(body.chapters) ? body.chapters.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
      const numbered = chapters.filter((item) => typeof item.chapter === "number" && Number.isInteger(item.chapter) && item.chapter > 0);
      if (!summary || numbered.length === 0 || numbered.length !== chapters.length) {
        return { ok: false, explanation: {
          what: "大纲候选结构不合格",
          why: "作者要靠调整思路与逐章安排决定采不采纳；缺 summary、没有章，或某章缺正整数章号都没法核对",
          action: "提交 { summary: \"调整思路\", chapters: [{ chapter: 章号, goal, conflict, hooks }], risks: [...] }，每章都带章号",
        } };
      }
      if (numbered.length > MAX_OUTLINE_CHAPTERS) {
        return { ok: false, explanation: {
          what: `大纲候选一次推演了 ${numbered.length} 章`,
          why: `单次上限 ${MAX_OUTLINE_CHAPTERS} 章，推得太远多半要重推`,
          action: `只推演接下来最多 ${MAX_OUTLINE_CHAPTERS} 章后重交`,
        } };
      }
      const sorted = [...numbered].sort((a, b) => (a.chapter as number) - (b.chapter as number));
      const risks = Array.isArray(body.risks) ? body.risks.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      return {
        ok: true,
        value: {
          payload: { ...body, summary: summary.slice(0, MAX_SUMMARY_CHARS), chapters: sorted, risks },
          validation: { chapterCount: sorted.length, fromChapter: sorted[0]!.chapter, toChapter: sorted.at(-1)!.chapter },
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
  /** 并行时必填；只有一道进行中的工序时可省略。 */
  readonly stepId?: string;
  /** 分支工序必填：取工序声明的结果之一。 */
  readonly outcome?: string;
  readonly wordTarget?: number;
  /** 本书字数硬范围规则（book.json）；正文候选按它校验，口径与 pipeline.write 一致。 */
  readonly lengthRule?: ChapterLengthRule;
  /** 提交成功时写入新候选的 id（返回给提交者，供领导者按 id 引用，不再转贴正文）。 */
  readonly capture?: { candidateId?: string };
  /** 委派子代理提交时：只允许提交这些工序（由调用方按模板与工序的对应关系算出）。 */
  readonly allowedStepIds?: readonly string[];
}

/**
 * 委派子代理只能操作分给它的工序：给了 stepId 就必须在名单里；没给时名单里恰好一道
 * 进行中的工序才能推断。名单为空表示当前没有它能做的工序。
 */
function delegatedStepOf<T>(
  run: WorkflowRunRecord,
  stepId: string | undefined,
  allowed: readonly string[],
): { step: WorkflowStepState } | { error: WorkflowServiceResult<T> } {
  const running = runningSteps(run.state).filter((step) => allowed.includes(step.stepId));
  const denied = (what: string): { error: WorkflowServiceResult<T> } => ({
    error: {
      ok: false,
      code: "step-not-delegated",
      status: 409,
      explanation: {
        what,
        why: "委派子代理只能提交分给它的那道工序，其余工序由领导者或对应的子代理负责",
        action: "调用 workflow_get_current_step 确认分给你的 stepId；不是你的工序就把情况写进摘要交还领导者",
      },
    },
  });
  if (stepId) {
    const step = running.find((candidate) => candidate.stepId === stepId);
    return step ? { step } : denied(`工序「${stepId}」不是分给你的进行中工序`);
  }
  if (running.length === 1) return { step: running[0]! };
  if (running.length === 0) return denied("现在没有分给你的进行中工序");
  return { error: invalid("step-id-required", {
    what: `有 ${running.length} 道分给你的工序同时进行`,
    why: "不指明就不知道这份产物属于哪一道",
    action: "带上 stepId 重新调用",
  }) };
}

/** 审校不通过时进入上游简报的打回意见：取审校结论与前几条问题。 */
function auditVerdictOf(payload: unknown): WorkflowAuditVerdict {
  const body = record(payload) ?? {};
  const passed = body.passed === true;
  const issues = Array.isArray(body.issues) ? body.issues.map(record).filter((issue): issue is Record<string, unknown> => issue !== null) : [];
  const listed = issues
    .slice(0, 5)
    .map((issue, index) => `${index + 1}. [${String(issue.severity ?? "info")}] ${String(issue.description ?? "").slice(0, 200)}`)
    .join("；");
  return {
    passed,
    note: {
      what: `审校未通过：${String(body.summary ?? "").slice(0, 300)}`,
      why: listed ? `问题：${listed}${issues.length > 5 ? `（另有 ${issues.length - 5} 条，见审校候选）` : ""}` : "审校认为本章正文需要修改",
      action: "按审校意见逐条修改正文后重新提交；只改被指出的问题",
    },
  };
}

/** 审校 / 门禁类工序：作者在这里批准时，一并批准它审过的那份待定正文。 */
const REVIEW_STEP_KINDS = new Set<WorkflowStepState["kind"]>(["audit", "adversarial-audit", "approval-gate"]);

function decidePendingProse(
  storage: StorageDatabase,
  runId: string,
  decision: "approved" | "rejected",
  note?: string,
): void {
  const pending = getLatestPendingCandidate(storage, runId, "prose");
  if (!pending) return;
  decideWorkflowCandidate(storage, { candidateId: pending.id, decision, ...(note ? { note } : {}) });
}

function stepOf(state: WorkflowRunState, stepId: string): WorkflowStepState | undefined {
  return state.steps.find((candidate) => candidate.stepId === stepId);
}

function noActiveRun<T>(): WorkflowServiceResult<T> {
  return { ok: false, code: "no-active-run", status: 404, explanation: {
    what: "当前没有进行中的创作工作流",
    why: "工作流由作者在「写作 › 工作流」启动，没有运行就没有工序可提交",
    action: "按作者的普通指令继续；需要工作流时请作者先启动",
  } };
}

export function submitWorkflowStepOutput(input: SubmitStepOutputInput): WorkflowServiceResult<WorkflowRunRecord> {
  const run = getActiveWorkflowRunForNarrator(input.storage, input.narratorId);
  if (!run) return noActiveRun();
  const target = input.allowedStepIds
    ? delegatedStepOf<WorkflowRunRecord>(run, input.stepId, input.allowedStepIds)
    : targetStepOf<WorkflowRunRecord>(run, input.stepId);
  if ("error" in target) return target.error;
  const { step } = target;
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
    ...(input.lengthRule ? { lengthRule: input.lengthRule } : {}),
  });
  if (!checked.ok) return invalid(checked.code ?? "candidate-invalid", checked.explanation);

  const audit = kind === "audit" ? auditVerdictOf(checked.value.payload) : undefined;
  return applyWorkflowAction(input.storage, run.id, input.runRevision, {
    type: "submit",
    stepId: step.stepId,
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    ...(audit ? { audit } : {}),
  }, {
    beforeCommit: ({ next }) => {
      const candidateId = insertWorkflowCandidate(input.storage, {
        runId: run.id,
        stepId: step.stepId,
        kind,
        payload: checked.value.payload,
        validation: checked.value.validation,
      });
      if (input.capture) input.capture.candidateId = candidateId;
      const nextStep = stepOf(next, step.stepId);
      // 审校不通过、自动打回上游：这份审校意见已被采纳去返修，被审的正文作废。
      if (audit && !audit.passed && nextStep?.status === "pending") {
        decideWorkflowCandidate(input.storage, { candidateId, decision: "approved", note: "审校未通过，已自动打回重写" });
        decidePendingProse(input.storage, run.id, "rejected", audit.note.what);
        return;
      }
      // 无需确认的工序：提交即批准，立即写进权威源。
      // 正文例外：它只有经作者确认（本工序或下游审校 / 门禁）才算批准，提交时一律保持待定。
      if (nextStep?.status === "done" && kind !== "prose") {
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
  /** 并行时必填；只有一道进行中的工序时可省略。 */
  readonly stepId?: string;
  /** 委派子代理报告阻塞时：只允许这些工序。 */
  readonly allowedStepIds?: readonly string[];
}

export function reportWorkflowBlocker(input: ReportBlockerInput): WorkflowServiceResult<WorkflowRunRecord> {
  const run = getActiveWorkflowRunForNarrator(input.storage, input.narratorId);
  if (!run) return noActiveRun();
  const target = input.allowedStepIds
    ? delegatedStepOf<WorkflowRunRecord>(run, input.stepId, input.allowedStepIds)
    : targetStepOf<WorkflowRunRecord>(run, input.stepId);
  if ("error" in target) return target.error;
  const { step } = target;
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
      const step = stepOf(current.state, input.stepId);
      // 作者在审校 / 门禁工序放行，等于认可了它审过的那份正文：一并批准，落盘工序才能引用它。
      if (step && REVIEW_STEP_KINDS.has(step.kind)) {
        decidePendingProse(input.storage, current.id, "approved", input.note);
      }
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
    beforeCommit: ({ run: current, next }) => {
      // 打回让写正文的工序重做时，旧正文作废（不会再被当成待确认的版本）。
      const proseStepReset = current.state.steps.some((step) =>
        step.expectedOutput === "prose" && step.status !== "pending" && stepOf(next, step.stepId)?.status !== step.status,
      );
      if (proseStepReset) {
        decidePendingProse(input.storage, current.id, "rejected", note);
        // 受阻的落盘工序打回：作者已批准过的那份正文也作废，重写的正文要重新审校、确认后才能落盘。
        const failedStep = stepOf(current.state, input.stepId);
        if (failedStep?.status === "failed") {
          const approved = getLatestApprovedCandidate(input.storage, current.id, "prose");
          if (approved) decideWorkflowCandidate(input.storage, { candidateId: approved.id, decision: "rejected", note });
        }
      }
      // 受阻工序没有待确认的候选：本工序的候选（若有）保持原样。
      if (stepOf(current.state, input.stepId)?.status === "failed") return;
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

export function retryWorkflowStep(input: AuthorActionInput & { readonly stepId?: string }): WorkflowServiceResult<WorkflowRunRecord> {
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, { type: "retry", ...(input.stepId ? { stepId: input.stepId } : {}) });
}

export function skipWorkflowStep(input: AuthorActionInput & { readonly stepId?: string }): WorkflowServiceResult<WorkflowRunRecord> {
  return applyWorkflowAction(input.storage, input.runId, input.expectedRevision, { type: "skip", ...(input.stepId ? { stepId: input.stepId } : {}) });
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
  if (approvedContent === null) {
    // 方案里有写正文的工序，正文却还没经作者确认：此时落盘就是「提交即落盘」。
    const proseOnPath = run.state.steps.some((step) =>
      step.expectedOutput === "prose" && step.enabled && step.status !== "bypassed" && step.status !== "skipped",
    );
    if (!proseOnPath) return null;
    return {
      what: `${canonicalToolName} 被拦下：本运行的正文还没有经作者确认`,
      why: "正文要先过审校与作者确认才能写进书里；现在落盘会让未审的内容成为正式章节",
      action: "等作者在「写作 › 工作流」确认正文后，再用 pipeline_write（fromWorkflowRun=true）落盘",
    };
  }
  // 引用已批准的候选：正文由工具自己从运行里取，不经模型转贴，天然一致。
  if (input.fromWorkflowRun === true && (typeof input.content !== "string" || !input.content.trim())) return null;
  const content = typeof input.content === "string" ? input.content : "";
  if (normalizeProse(content) === normalizeProse(approvedContent)) return null;
  return {
    what: `${canonicalToolName} 要写入的正文与作者批准的版本不一致`,
    why: "作者在「工作流」页批准的是另一份正文；落盘不同内容会让审过的和写进书里的对不上",
    action: "用 workflow_get_current_step 取回已批准的正文原样写入；若确需改动，先重新提交正文等作者确认",
  };
}

/** 本运行最近一份已落盘（已批准）的镜头蓝图。 */
export function getApprovedSceneSpec(storage: StorageDatabase, run: WorkflowRunRecord): Record<string, unknown> | null {
  const approved = getLatestApprovedCandidate(storage, run.id, "scene-spec");
  return record(record(approved?.payload)?.sceneSpec);
}

/** 本运行已批准的正文（供落盘工序原样写入）。 */
export function getApprovedProse(storage: StorageDatabase, run: WorkflowRunRecord): { title?: string; content: string } | null {
  const approved = getLatestApprovedCandidate(storage, run.id, "prose");
  const payload = record(approved?.payload);
  if (!payload || typeof payload.content !== "string") return null;
  return { ...(typeof payload.title === "string" ? { title: payload.title } : {}), content: payload.content };
}
