/**
 * 创作工作流运行的存取层。
 *
 * 只负责把状态机的结果落库：每次迁移在一个事务里完成「校验 revision → 写运行 →
 * 写变更的工序 → 追加事件 → 调用方的副作用（写候选 / 提交权威源）」，任何一步失败整体回滚。
 * 状态本身怎么变由 run-state-machine 决定，这里不做任何业务判断。
 *
 * 工序的静态属性（名称、类别、允许的工具、是否需要确认……）不入库，每次加载都由
 * 冻结的配方快照经 buildStepTemplates 重新派生；库里只存会变的部分（状态、次数、说明）。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { NovelWorkflowRecipe } from "./novel-workflows.js";
import {
  ACTIVE_WORKFLOW_RUN_STATUSES,
  buildStepTemplates,
  createRunState,
  transition,
  type WorkflowCandidateKind,
  type WorkflowExplanation,
  type WorkflowRunAction,
  type WorkflowRunEventDraft,
  type WorkflowRunState,
  type WorkflowRunStatus,
  type WorkflowStepState,
  type WorkflowStepStatus,
} from "./run-state-machine.js";

export interface WorkflowRunRecord {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly recipeId: string;
  readonly recipe: NovelWorkflowRecipe;
  readonly narratorId: string;
  readonly state: WorkflowRunState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly finishedAt?: number;
}

export type WorkflowCandidateDecision = "pending" | "approved" | "rejected";

export interface WorkflowCandidateRecord {
  readonly id: string;
  readonly runId: string;
  readonly stepId: string;
  readonly kind: WorkflowCandidateKind;
  readonly payload: unknown;
  readonly submittedAt: number;
  readonly validation: unknown;
  readonly decision: WorkflowCandidateDecision;
  readonly decidedAt?: number;
  readonly reviewerNote?: string;
  readonly reviewerSelection?: unknown;
  readonly committedRef?: string;
}

export interface WorkflowRunEvent {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export type WorkflowStoreResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: string;
      /** HTTP 语义：400 请求不合法 / 404 找不到 / 409 状态冲突。 */
      readonly status: 400 | 404 | 409;
      readonly explanation: WorkflowExplanation;
    };

function failure<T>(code: string, status: 400 | 404 | 409, explanation: WorkflowExplanation): WorkflowStoreResult<T> {
  return { ok: false, code, status, explanation };
}

export function ensureWorkflowRunSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "workflow_runs" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "book_id" TEXT NOT NULL,
      "chapter_number" INTEGER NOT NULL,
      "recipe_id" TEXT NOT NULL,
      "recipe_snapshot_json" TEXT NOT NULL,
      "narrator_id" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "current_step_id" TEXT,
      "revision" INTEGER NOT NULL DEFAULT 0,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL,
      "finished_at" INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_runs_active_narrator"
      ON "workflow_runs" ("narrator_id")
      WHERE "status" IN ('running', 'awaiting_approval', 'blocked');
    CREATE INDEX IF NOT EXISTS "idx_workflow_runs_book"
      ON "workflow_runs" ("book_id", "created_at");
    CREATE TABLE IF NOT EXISTS "workflow_run_steps" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "run_id" TEXT NOT NULL,
      "step_id" TEXT NOT NULL,
      "ordinal" INTEGER NOT NULL,
      "status" TEXT NOT NULL,
      "attempt" INTEGER NOT NULL DEFAULT 0,
      "max_attempts" INTEGER NOT NULL,
      "executor_kind" TEXT NOT NULL,
      "agent_id" TEXT,
      "subagent_ids_json" TEXT NOT NULL DEFAULT '[]',
      "started_at" INTEGER,
      "finished_at" INTEGER,
      "failure_reason" TEXT,
      "explanation_json" TEXT,
      FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_run_steps_run_step"
      ON "workflow_run_steps" ("run_id", "step_id");
    CREATE TABLE IF NOT EXISTS "workflow_run_candidates" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "run_id" TEXT NOT NULL,
      "step_id" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "payload_json" TEXT NOT NULL,
      "submitted_at" INTEGER NOT NULL,
      "validation_json" TEXT,
      "decision" TEXT NOT NULL DEFAULT 'pending',
      "decided_at" INTEGER,
      "reviewer_note" TEXT,
      "reviewer_selection_json" TEXT,
      "committed_ref" TEXT,
      FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "idx_workflow_run_candidates_step"
      ON "workflow_run_candidates" ("run_id", "step_id", "submitted_at");
    CREATE TABLE IF NOT EXISTS "workflow_run_events" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "run_id" TEXT NOT NULL,
      "seq" INTEGER NOT NULL,
      "at" INTEGER NOT NULL,
      "type" TEXT NOT NULL,
      "payload_json" TEXT NOT NULL,
      FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_run_events_seq"
      ON "workflow_run_events" ("run_id", "seq");
  `);
}

// ─── 行映射 ──────────────────────────────────────────────────────────────────

interface RunRow {
  id: string;
  book_id: string;
  chapter_number: number;
  recipe_id: string;
  recipe_snapshot_json: string;
  narrator_id: string;
  status: string;
  current_step_id: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

interface StepRow {
  step_id: string;
  status: string;
  attempt: number;
  explanation_json: string | null;
}

interface CandidateRow {
  id: string;
  run_id: string;
  step_id: string;
  kind: string;
  payload_json: string;
  submitted_at: number;
  validation_json: string | null;
  decision: string;
  decided_at: number | null;
  reviewer_note: string | null;
  reviewer_selection_json: string | null;
  committed_ref: string | null;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isExplanation(value: unknown): value is WorkflowExplanation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.what === "string" && typeof record.why === "string" && typeof record.action === "string";
}

function toRecord(storage: StorageDatabase, row: RunRow): WorkflowRunRecord {
  const recipe = parseJson<NovelWorkflowRecipe>(row.recipe_snapshot_json, {
    id: row.recipe_id,
    name: row.recipe_id,
    commandId: row.recipe_id,
    description: "",
    steps: [],
    resultStrategy: "formal-chapter",
    requireFinalApproval: false,
    maxRetries: 0,
  });
  const persisted = new Map(
    storage.sqlite
      .prepare<StepRow>(`SELECT step_id, status, attempt, explanation_json FROM workflow_run_steps WHERE run_id = ?`)
      .all(row.id)
      .map((step) => [step.step_id, step]),
  );
  const steps: WorkflowStepState[] = buildStepTemplates(recipe).map((template) => {
    const saved = persisted.get(template.stepId);
    if (!saved) return template;
    const note = parseJson<unknown>(saved.explanation_json, null);
    return {
      ...template,
      status: saved.status as WorkflowStepStatus,
      attempt: saved.attempt,
      ...(isExplanation(note) ? { note } : {}),
    };
  });
  return {
    id: row.id,
    bookId: row.book_id,
    chapterNumber: row.chapter_number,
    recipeId: row.recipe_id,
    recipe,
    narratorId: row.narrator_id,
    state: {
      status: row.status as WorkflowRunStatus,
      currentStepId: row.current_step_id,
      revision: row.revision,
      steps,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
  };
}

function toCandidate(row: CandidateRow): WorkflowCandidateRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    kind: row.kind as WorkflowCandidateKind,
    payload: parseJson<unknown>(row.payload_json, null),
    submittedAt: row.submitted_at,
    validation: parseJson<unknown>(row.validation_json, null),
    decision: row.decision as WorkflowCandidateDecision,
    ...(row.decided_at !== null ? { decidedAt: row.decided_at } : {}),
    ...(row.reviewer_note !== null ? { reviewerNote: row.reviewer_note } : {}),
    ...(row.reviewer_selection_json !== null ? { reviewerSelection: parseJson<unknown>(row.reviewer_selection_json, null) } : {}),
    ...(row.committed_ref !== null ? { committedRef: row.committed_ref } : {}),
  };
}

// ─── 读 ──────────────────────────────────────────────────────────────────────

export function getWorkflowRun(storage: StorageDatabase, runId: string): WorkflowRunRecord | null {
  ensureWorkflowRunSchema(storage);
  const row = storage.sqlite.prepare<RunRow>(`SELECT * FROM workflow_runs WHERE id = ?`).get(runId);
  return row ? toRecord(storage, row) : null;
}

/** 叙述者当前进行中的运行（运行中 / 等待确认 / 受阻）。一个叙述者至多一个。 */
export function getActiveWorkflowRunForNarrator(storage: StorageDatabase, narratorId: string): WorkflowRunRecord | null {
  ensureWorkflowRunSchema(storage);
  const placeholders = ACTIVE_WORKFLOW_RUN_STATUSES.map(() => "?").join(", ");
  const row = storage.sqlite
    .prepare<RunRow>(`SELECT * FROM workflow_runs WHERE narrator_id = ? AND status IN (${placeholders}) LIMIT 1`)
    .get(narratorId, ...ACTIVE_WORKFLOW_RUN_STATUSES);
  return row ? toRecord(storage, row) : null;
}

export function listWorkflowRunsForBook(storage: StorageDatabase, bookId: string, limit = 20): WorkflowRunRecord[] {
  ensureWorkflowRunSchema(storage);
  return storage.sqlite
    .prepare<RunRow>(`SELECT * FROM workflow_runs WHERE book_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(bookId, limit)
    .map((row) => toRecord(storage, row));
}

export function listWorkflowRunEvents(storage: StorageDatabase, runId: string, sinceSeq = 0): WorkflowRunEvent[] {
  ensureWorkflowRunSchema(storage);
  return storage.sqlite
    .prepare<{ seq: number; at: number; type: string; payload_json: string }>(
      `SELECT seq, at, type, payload_json FROM workflow_run_events WHERE run_id = ? AND seq > ? ORDER BY seq`,
    )
    .all(runId, sinceSeq)
    .map((row) => ({ seq: row.seq, at: row.at, type: row.type, payload: parseJson<Record<string, unknown>>(row.payload_json, {}) }));
}

export function listWorkflowRunCandidates(storage: StorageDatabase, runId: string): WorkflowCandidateRecord[] {
  ensureWorkflowRunSchema(storage);
  return storage.sqlite
    .prepare<CandidateRow>(`SELECT * FROM workflow_run_candidates WHERE run_id = ? ORDER BY submitted_at, id`)
    .all(runId)
    .map(toCandidate);
}

/** 某道工序最近一次提交的候选。 */
export function getLatestCandidate(
  storage: StorageDatabase,
  runId: string,
  stepId: string,
): WorkflowCandidateRecord | null {
  ensureWorkflowRunSchema(storage);
  const row = storage.sqlite
    .prepare<CandidateRow>(
      `SELECT * FROM workflow_run_candidates WHERE run_id = ? AND step_id = ? ORDER BY submitted_at DESC, rowid DESC LIMIT 1`,
    )
    .get(runId, stepId);
  return row ? toCandidate(row) : null;
}

/** 本运行里最近一份已批准的某类候选（如已批准的正文）。 */
export function getLatestApprovedCandidate(
  storage: StorageDatabase,
  runId: string,
  kind: WorkflowCandidateKind,
): WorkflowCandidateRecord | null {
  ensureWorkflowRunSchema(storage);
  const row = storage.sqlite
    .prepare<CandidateRow>(
      `SELECT * FROM workflow_run_candidates WHERE run_id = ? AND kind = ? AND decision = 'approved'
       ORDER BY decided_at DESC, rowid DESC LIMIT 1`,
    )
    .get(runId, kind);
  return row ? toCandidate(row) : null;
}

// ─── 写 ──────────────────────────────────────────────────────────────────────

function appendEvents(storage: StorageDatabase, runId: string, events: readonly WorkflowRunEventDraft[], at: number): void {
  if (events.length === 0) return;
  const last = storage.sqlite
    .prepare<{ seq: number | null }>(`SELECT MAX(seq) AS seq FROM workflow_run_events WHERE run_id = ?`)
    .get(runId);
  let seq = last?.seq ?? 0;
  const insert = storage.sqlite.prepare(
    `INSERT INTO workflow_run_events (id, run_id, seq, at, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const event of events) {
    seq += 1;
    insert.run(`${runId}:ev:${seq}`, runId, seq, at, event.type, JSON.stringify(event.payload));
  }
}

function writeSteps(
  storage: StorageDatabase,
  runId: string,
  previous: readonly WorkflowStepState[] | null,
  next: readonly WorkflowStepState[],
  at: number,
): void {
  const upsert = storage.sqlite.prepare(`
    INSERT INTO workflow_run_steps
      (id, run_id, step_id, ordinal, status, attempt, max_attempts, executor_kind, agent_id, started_at, finished_at, failure_reason, explanation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (run_id, step_id) DO UPDATE SET
      status = excluded.status,
      attempt = excluded.attempt,
      started_at = COALESCE(workflow_run_steps.started_at, excluded.started_at),
      finished_at = excluded.finished_at,
      failure_reason = excluded.failure_reason,
      explanation_json = excluded.explanation_json
  `);
  next.forEach((step, index) => {
    const before = previous?.[index];
    const changed = !before
      || before.status !== step.status
      || before.attempt !== step.attempt
      || before.note !== step.note;
    if (!changed) return;
    const finished = step.status === "done" || step.status === "skipped" || step.status === "failed";
    upsert.run(
      `${runId}:step:${step.stepId}`,
      runId,
      step.stepId,
      step.ordinal,
      step.status,
      step.attempt,
      step.maxAttempts,
      step.executorKind,
      step.agentId ?? null,
      step.status === "pending" ? null : at,
      finished ? at : null,
      step.status === "failed" ? step.note?.what ?? null : null,
      step.note ? JSON.stringify(step.note) : null,
    );
  });
}

export interface CreateWorkflowRunInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly recipe: NovelWorkflowRecipe;
  readonly narratorId: string;
  readonly now?: number;
}

export function createWorkflowRun(storage: StorageDatabase, input: CreateWorkflowRunInput): WorkflowStoreResult<WorkflowRunRecord> {
  ensureWorkflowRunSchema(storage);
  if (!Number.isInteger(input.chapterNumber) || input.chapterNumber < 1) {
    return failure("invalid-chapter", 400, {
      what: `章号「${String(input.chapterNumber)}」不合法`,
      why: "工作流按章推进，必须落在某一章上",
      action: "传入正整数章号",
    });
  }
  const existing = getActiveWorkflowRunForNarrator(storage, input.narratorId);
  if (existing) {
    return failure("active-run-exists", 409, {
      what: `这个叙述者已有进行中的运行（第 ${existing.chapterNumber} 章 · ${existing.recipe.name}）`,
      why: "同一个叙述者同时推进两个运行，工序简报与工具限制会互相打架",
      action: "先在「执行」页完成或取消当前运行，再启动新的",
    });
  }
  const initial = createRunState(input.recipe);
  if (!initial.ok) return failure(initial.code, 400, initial.explanation);

  const now = input.now ?? Date.now();
  const id = `wfrun:${crypto.randomUUID()}`;
  storage.sqlite.transaction(() => {
    storage.sqlite
      .prepare(`
        INSERT INTO workflow_runs
          (id, book_id, chapter_number, recipe_id, recipe_snapshot_json, narrator_id, status, current_step_id, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        id,
        input.bookId,
        input.chapterNumber,
        input.recipe.id,
        JSON.stringify(input.recipe),
        input.narratorId,
        initial.state.status,
        initial.state.currentStepId,
        now,
        now,
      );
    writeSteps(storage, id, null, initial.state.steps, now);
    appendEvents(storage, id, initial.events, now);
  })();
  const created = getWorkflowRun(storage, id);
  if (!created) {
    return failure("create-failed", 409, { what: "运行创建后读不回来", why: "写入未生效", action: "重试启动" });
  }
  return { ok: true, data: created };
}

export interface WorkflowTransitionEffects {
  /** 在同一事务内执行（写候选、提交权威源等）；抛错则整体回滚。 */
  readonly beforeCommit?: (context: { readonly run: WorkflowRunRecord; readonly next: WorkflowRunState }) => void;
  readonly extraEvents?: readonly WorkflowRunEventDraft[];
}

/**
 * 对运行执行一个动作并落库。expectedRevision 与库里不一致时返回 409：
 * 说明别人（作者或模型）刚改过这个运行，调用方应重读后再决定。
 */
export function applyWorkflowAction(
  storage: StorageDatabase,
  runId: string,
  expectedRevision: number | undefined,
  action: WorkflowRunAction,
  effects: WorkflowTransitionEffects = {},
  now: number = Date.now(),
): WorkflowStoreResult<WorkflowRunRecord> {
  ensureWorkflowRunSchema(storage);
  // 用容器承接事务内的早退结果：闭包内赋值不会被 TS 的控制流收窄看到。
  const early: { value: WorkflowStoreResult<WorkflowRunRecord> | null } = { value: null };
  try {
    storage.sqlite.transaction(() => {
      const run = getWorkflowRun(storage, runId);
      if (!run) {
        early.value = failure("run-not-found", 404, {
          what: `找不到运行 ${runId}`,
          why: "运行可能已被删除，或 id 有误",
          action: "刷新「执行」页，按页面上的运行重新操作",
        });
        return;
      }
      if (expectedRevision !== undefined && expectedRevision !== run.state.revision) {
        early.value = failure("revision-conflict", 409, {
          what: `运行已被更新（你看到的是第 ${expectedRevision} 版，现在是第 ${run.state.revision} 版）`,
          why: "作者的操作和叙述者的提交可能同时发生，按旧版本操作会覆盖对方刚做的决定",
          action: "重新读取运行状态后再操作",
        });
        return;
      }
      const result = transition(run.state, action);
      if (!result.ok) {
        early.value = failure(result.code, 409, result.explanation);
        return;
      }
      const next = result.state;
      effects.beforeCommit?.({ run, next });
      const finished = next.status === "done" || next.status === "cancelled";
      const updated = storage.sqlite
        .prepare(`
          UPDATE workflow_runs
          SET status = ?, current_step_id = ?, revision = ?, updated_at = ?, finished_at = ?
          WHERE id = ? AND revision = ?
        `)
        .run(next.status, next.currentStepId, next.revision, now, finished ? now : null, runId, run.state.revision);
      if (Number(updated.changes) !== 1) throw new Error("revision-race");
      writeSteps(storage, runId, run.state.steps, next.steps, now);
      appendEvents(storage, runId, [...(effects.extraEvents ?? []), ...result.events], now);
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure("transition-failed", 409, {
      what: "这次操作没有生效，运行保持原样",
      why: message,
      action: "重新读取运行状态后再试",
    });
  }
  if (early.value) return early.value;
  const reloaded = getWorkflowRun(storage, runId);
  return reloaded
    ? { ok: true, data: reloaded }
    : failure("run-not-found", 404, { what: "运行更新后读不回来", why: "数据不一致", action: "刷新后重试" });
}

// ─── 候选 ────────────────────────────────────────────────────────────────────

export interface InsertCandidateInput {
  readonly runId: string;
  readonly stepId: string;
  readonly kind: WorkflowCandidateKind;
  readonly payload: unknown;
  readonly validation: unknown;
  readonly now?: number;
}

export function insertWorkflowCandidate(storage: StorageDatabase, input: InsertCandidateInput): string {
  ensureWorkflowRunSchema(storage);
  const id = `wfcand:${crypto.randomUUID()}`;
  storage.sqlite
    .prepare(`
      INSERT INTO workflow_run_candidates (id, run_id, step_id, kind, payload_json, submitted_at, validation_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, input.runId, input.stepId, input.kind, JSON.stringify(input.payload ?? null), input.now ?? Date.now(), JSON.stringify(input.validation ?? null));
  return id;
}

export interface DecideCandidateInput {
  readonly candidateId: string;
  readonly decision: "approved" | "rejected";
  readonly note?: string;
  readonly selection?: unknown;
  readonly committedRef?: string;
  readonly now?: number;
}

export function decideWorkflowCandidate(storage: StorageDatabase, input: DecideCandidateInput): void {
  ensureWorkflowRunSchema(storage);
  storage.sqlite
    .prepare(`
      UPDATE workflow_run_candidates
      SET decision = ?, decided_at = ?, reviewer_note = ?, reviewer_selection_json = ?, committed_ref = ?
      WHERE id = ?
    `)
    .run(
      input.decision,
      input.now ?? Date.now(),
      input.note ?? null,
      input.selection === undefined ? null : JSON.stringify(input.selection),
      input.committedRef ?? null,
      input.candidateId,
    );
}
