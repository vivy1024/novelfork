/**
 * 创作工作流运行的作者侧接口：启动、查看、批准、打回、重试、跳过、取消。
 *
 * 叙述者侧只经工具（workflow.*）交互；这里只服务「写作 › 工作流」页。
 * 叙述者归属必须由宿主校验（authorizeNarrator），不接受任意 narratorId；
 * 运行必须属于路径上的书，否则一律 404，不泄露别的书的运行。
 * 所有变更都要带 expectedRevision：作者与叙述者会并发操作同一个运行，错配返回 409。
 */

import { Hono, type Context } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import {
  approveWorkflowStep,
  cancelWorkflowRun,
  getWorkflowRunDetail,
  rejectWorkflowStep,
  retryWorkflowStep,
  skipWorkflowStep,
  startWorkflowRun,
  type WorkflowRunDetail,
} from "../engine/workflows/run-service.js";
import {
  getActiveWorkflowRunForNarrator,
  getWorkflowRun,
  listWorkflowRunsForBook,
  type WorkflowRunRecord,
  type WorkflowStoreResult,
} from "../engine/workflows/run-store.js";
import type { WorkflowExplanation } from "../engine/workflows/run-state-machine.js";

export interface CreateWorkflowRunsRouterOptions {
  readonly storage?: () => StorageDatabase;
  readonly resolveBookRoot: (bookId: string) => string;
  /**
   * 叙述者是否属于这本书且当前用户有权操作。返回布尔值而不是抛错：本路由与宿主各持一份 Hono，
   * 子应用里抛出的错误不会交给宿主的错误处理，只会变成 500。
   */
  readonly authorizeNarrator: (c: Context, bookId: string, narratorId: string) => Promise<boolean>;
}

function errorBody(code: string, explanation: WorkflowExplanation) {
  return { error: code, summary: `${explanation.what}。${explanation.why}。${explanation.action}。`, explanation };
}

function runSummary(run: WorkflowRunRecord) {
  return {
    id: run.id,
    chapterNumber: run.chapterNumber,
    recipeId: run.recipeId,
    recipeName: run.recipe.name,
    narratorId: run.narratorId,
    status: run.state.status,
    currentStepId: run.state.currentStepId,
    revision: run.state.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
  };
}

export function serializeWorkflowRunDetail(detail: WorkflowRunDetail) {
  const { run } = detail;
  return {
    run: {
      ...runSummary(run),
      steps: run.state.steps.map((step) => {
        const recipeStep = run.recipe.nodes.find((node) => node.type === "step" && node.id === step.stepId) as { customPrompt?: string } | undefined;
        return {
          ...step,
          ...(recipeStep?.customPrompt ? { customPrompt: recipeStep.customPrompt } : {}),
        };
      }),
    },
    // 运行所用方案的快照结构：画布据此叠加各工序状态（方案之后再改也不影响这次运行）。
    graph: {
      nodes: run.recipe.nodes,
      edges: run.recipe.edges,
      ...(run.recipe.layout ? { layout: run.recipe.layout } : {}),
    },
    brief: detail.brief,
    candidates: detail.candidates,
    events: detail.events,
  };
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function expectedRevisionOf(body: Record<string, unknown>): number | null {
  return typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision) ? body.expectedRevision : null;
}

export function createWorkflowRunsRouter(options: CreateWorkflowRunsRouterOptions): Hono {
  const app = new Hono();
  const storage = options.storage ?? (() => getStorageDatabase());

  function respond(c: Context, result: WorkflowStoreResult<WorkflowRunRecord>, successStatus: 200 | 201 = 200) {
    if (!result.ok) return c.json(errorBody(result.code, result.explanation), result.status);
    const detail = getWorkflowRunDetail(storage(), result.data.id);
    return c.json(detail ? serializeWorkflowRunDetail(detail) : { run: runSummary(result.data) }, successStatus);
  }

  /** 运行必须属于路径上的书。 */
  function runOfBook(c: Context): WorkflowRunRecord | null {
    const run = getWorkflowRun(storage(), c.req.param("runId") ?? "");
    return run && run.bookId === c.req.param("bookId") ? run : null;
  }

  function notFound(c: Context) {
    return c.json(errorBody("run-not-found", {
      what: "找不到这个运行",
      why: "运行不存在，或不属于这本书",
      action: "刷新「工作流」页后重试",
    }), 404);
  }

  function narratorNotFound(c: Context) {
    return c.json(errorBody("narrator-not-found", {
      what: "这个叙述者不属于这本书，或你无权操作它",
      why: "工作流会约束叙述者能用的工具，只能作用在本书自己的叙述者上",
      action: "在写作页打开本书的叙述者会话后再启动",
    }), 404);
  }

  function missingRevision(c: Context) {
    return c.json(errorBody("expected-revision-required", {
      what: "缺少 expectedRevision",
      why: "作者与叙述者可能同时操作同一个运行，必须声明你看到的是哪一版",
      action: "带上页面上显示的运行版本号重试",
    }), 400);
  }

  app.get("/api/books/:bookId/workflow-runs", async (c) => {
    const bookId = c.req.param("bookId");
    const narratorId = c.req.query("narratorId")?.trim();
    let active: ReturnType<typeof serializeWorkflowRunDetail> | null = null;
    if (narratorId) {
      if (!(await options.authorizeNarrator(c, bookId, narratorId))) return narratorNotFound(c);
      const run = getActiveWorkflowRunForNarrator(storage(), narratorId);
      const detail = run && run.bookId === bookId ? getWorkflowRunDetail(storage(), run.id) : null;
      active = detail ? serializeWorkflowRunDetail(detail) : null;
    }
    return c.json({ active, recent: listWorkflowRunsForBook(storage(), bookId, 10).map(runSummary) });
  });

  app.post("/api/books/:bookId/workflow-runs", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await readJson(c);
    const recipeId = typeof body.recipeId === "string" ? body.recipeId.trim() : "";
    const narratorId = typeof body.narratorId === "string" ? body.narratorId.trim() : "";
    const chapterNumber = typeof body.chapterNumber === "number" ? body.chapterNumber : Number.NaN;
    if (!recipeId || !narratorId) {
      return c.json(errorBody("invalid-request", {
        what: "缺少方案或叙述者",
        why: "启动运行要知道按哪个方案、由哪个叙述者执行",
        action: "选择方案并确认已打开本书的叙述者会话后再启动",
      }), 400);
    }
    if (!(await options.authorizeNarrator(c, bookId, narratorId))) return narratorNotFound(c);
    const result = await startWorkflowRun({
      storage: storage(),
      bookId,
      bookRoot: options.resolveBookRoot(bookId),
      recipeId,
      chapterNumber,
      narratorId,
    });
    return respond(c, result, 201);
  });

  app.get("/api/books/:bookId/workflow-runs/:runId", (c) => {
    const run = runOfBook(c);
    if (!run) return notFound(c);
    const since = Number(c.req.query("since") ?? "0");
    const detail = getWorkflowRunDetail(storage(), run.id, Number.isInteger(since) && since > 0 ? since : 0);
    return detail ? c.json(serializeWorkflowRunDetail(detail)) : notFound(c);
  });

  app.post("/api/books/:bookId/workflow-runs/:runId/steps/:stepId/approve", async (c) => {
    const run = runOfBook(c);
    if (!run) return notFound(c);
    const body = await readJson(c);
    const expectedRevision = expectedRevisionOf(body);
    if (expectedRevision === null) return missingRevision(c);
    return respond(c, approveWorkflowStep({
      storage: storage(),
      runId: run.id,
      stepId: c.req.param("stepId"),
      expectedRevision,
      ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim() } : {}),
    }));
  });

  app.post("/api/books/:bookId/workflow-runs/:runId/steps/:stepId/reject", async (c) => {
    const run = runOfBook(c);
    if (!run) return notFound(c);
    const body = await readJson(c);
    const expectedRevision = expectedRevisionOf(body);
    if (expectedRevision === null) return missingRevision(c);
    return respond(c, rejectWorkflowStep({
      storage: storage(),
      runId: run.id,
      stepId: c.req.param("stepId"),
      expectedRevision,
      note: typeof body.note === "string" ? body.note : "",
      ...(body.selection !== undefined ? { selection: body.selection } : {}),
    }));
  });

  for (const [action, handler] of [
    ["retry", retryWorkflowStep],
    ["skip", skipWorkflowStep],
    ["cancel", cancelWorkflowRun],
  ] as const) {
    app.post(`/api/books/:bookId/workflow-runs/:runId/${action}`, async (c) => {
      const run = runOfBook(c);
      if (!run) return notFound(c);
      const body = await readJson(c);
      const expectedRevision = expectedRevisionOf(body);
      if (expectedRevision === null) return missingRevision(c);
      // 并行时有多道工序可能同时受阻：重试 / 跳过要指明是哪一道。
      const stepId = typeof body.stepId === "string" && body.stepId.trim() ? body.stepId.trim() : undefined;
      return respond(c, handler({ storage: storage(), runId: run.id, expectedRevision, ...(stepId ? { stepId } : {}) }));
    });
  }

  return app;
}
