import { Hono, type Context } from "hono";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";
import {
  makePreviewSource,
  normalizeStyleDistillationSource,
  listStyleDistillationJobs,
  StyleDistillationError,
  type StyleDistillationJob,
  type StyleDistillationSourceInput,
} from "../engine/writing-layers/style-distillation.js";
import {
  adoptRecommendedStyleDistillation,
  adoptStyleDistillation,
  createStyleDistillationJob,
  readStyleDistillationJob,
  recommendedStyleDistillationRuleIds,
  runStyleDistillationBatches,
  summarizeStyleDistillationBatches,
} from "../engine/writing-layers/style-distillation-runner.js";
import { compareStyleSources, comparisonInputsFromJobs } from "../engine/writing-layers/style-distillation-compare.js";
import { estimateStyleDistillationRun } from "../engine/writing-layers/style-distillation-model.js";
import { ensureStyleDistillationAutoResume } from "../engine/writing-layers/style-distillation-auto-resume.js";
import { loadStylePreset, StylePresetError } from "../engine/writing-layers/style-preset-store.js";
import type { HostTextGenerationAvailability, RouterContext } from "./context.js";

export interface CreateStyleDistillationsRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
  /**
   * 网页入口的模型能力。缺省走宿主按当前登录用户提供的服务端文本生成（ctx.resolveTextGeneration），
   * 拿不到时返回 undefined：任务照常保存基线，模型批次留待配好模型后继续或在叙述者会话继续。
   */
  readonly resolveTextGenerator?: (c: Context) => Promise<RuntimeTextGenerator | undefined>;
}

type Preview = {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly input: StyleDistillationSourceInput;
  readonly preview: ReturnType<typeof makePreviewSource>;
  readonly expiresAt: number;
};

const previews = new Map<string, Preview>();
const PREVIEW_TTL_MS = 30 * 60 * 1000;

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asInput(body: Record<string, unknown>): StyleDistillationSourceInput {
  const chapters = Array.isArray(body.chapters)
    ? body.chapters.filter((item): item is { number: number; title?: string; content: string } => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return typeof value.number === "number" && typeof value.content === "string";
    }).map((item) => ({ number: item.number, title: item.title, content: item.content }))
    : undefined;
  return {
    sourceName: typeof body.sourceName === "string" ? body.sourceName : "",
    ...(typeof body.text === "string" ? { text: body.text } : {}),
    ...(chapters ? { chapters } : {}),
    ...(typeof body.splitPattern === "string" ? { splitPattern: body.splitPattern } : {}),
  };
}

function distillationStatus(code: StyleDistillationError["code"]): 400 | 404 | 409 | 422 {
  if (code === "STYLE_DISTILLATION_NOT_FOUND") return 404;
  if (code === "STYLE_DISTILLATION_BUSY") return 409;
  if (code === "STYLE_DISTILLATION_SOURCE_MISSING" || code === "STYLE_DISTILLATION_MODEL_UNAVAILABLE") return 422;
  return 400;
}

function distillationNext(code: StyleDistillationError["code"]): string {
  if (code === "STYLE_DISTILLATION_BUSY") return "稍后刷新任务查看批次进度。";
  if (code === "STYLE_DISTILLATION_MODEL_UNAVAILABLE") return "在叙述者对话中请叙述者调用 style.distill_start 并带上 jobId 继续模型批次。";
  if (code === "STYLE_DISTILLATION_SOURCE_MISSING") return "重新粘贴参考文本并新建任务。";
  return "修正输入或重新开始预览。";
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof StyleDistillationError) {
    return c.json({ error: error.message, code: error.code, explanation: {
      what: error.message,
      why: "参考文本不会直接写入本书文风，必须先完成范围校验、分批抽取和逐条审阅。",
      next: distillationNext(error.code),
    } }, distillationStatus(error.code));
  }
  if (error instanceof StylePresetError) {
    const status = error.code === "STYLE_PRESET_CONFLICT" ? 409 : error.code === "STYLE_PRESET_INVALID" ? 400 : 422;
    return c.json({ error: error.message, code: error.code, explanation: {
      what: error.message, why: "文风预设不能被静默覆盖或越过审核写入。", next: "重新载入当前预设后再选择需要采纳的项目。",
    } }, status);
  }
  throw error;
}

/**
 * 本次请求的登录用户（宿主写在 c.get("user").sub 上的稳定 id）。蒸馏的后台续跑据此只替发起人续跑。
 * 拿不到时返回 undefined：没有身份就不替任何人续跑。
 */
function requestActorId(c: Context): string | undefined {
  try {
    const user = (c as unknown as { get(key: string): unknown }).get("user") as { sub?: unknown } | undefined;
    const id = typeof user?.sub === "string" ? user.sub.trim() : "";
    return id ? id.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

function cleanupPreviews(): void {
  const cutoff = Date.now();
  for (const [id, preview] of previews) if (preview.expiresAt <= cutoff) previews.delete(id);
}

function previewResponse(preview: Preview["preview"], input: StyleDistillationSourceInput) {
  const normalized = normalizeStyleDistillationSource(input);
  return {
    previewId: preview.sourceId,
    sourceName: normalized.sourceName,
    chapterCount: normalized.chapters.length,
    totalCharacters: normalized.coverage.sourceCharCount,
    chapters: normalized.chapters.map((chapter) => ({
      chapterNumber: chapter.number,
      title: chapter.title,
      characters: chapter.content.length,
    })),
    coverage: normalized.coverage,
    // 开跑前的用量估算：与建任务同一切批，叙述者 style.distill_preview 返回同一份。
    estimate: estimateStyleDistillationRun(normalized.chapters),
    warnings: [
      "预览只读取本次参考文本，不会修改本书文风预设。",
      "蒸馏结果会先进入审阅区；作品专属内容不会进入通用写法指南。",
    ],
  };
}

const MODEL_UNAVAILABLE_EXPLANATION = {
  what: "网页入口当前没有可用的服务端模型，模型批次未执行。",
  why: "确定性基线与统计指纹已可审阅；声音、语言、节奏等规则需要模型阅读原文后才能抽取。",
  next: "在叙述者对话中请叙述者调用 style.distill_start 并带上 jobId，继续同一任务的模型批次。",
};

type UnavailableGeneration = Extract<HostTextGenerationAvailability, { available: false }>;

/** 宿主说明了没有模型的原因时，把原因与配置建议写进说明；叙述者会话仍是可选的另一条路。 */
function modelUnavailableExplanation(unavailable?: UnavailableGeneration) {
  if (!unavailable) return MODEL_UNAVAILABLE_EXPLANATION;
  return {
    what: `${unavailable.message}模型批次未执行。`,
    why: MODEL_UNAVAILABLE_EXPLANATION.why,
    next: `${unavailable.suggestedAction}配好后在该任务上继续模型批次；也可以在叙述者对话中请叙述者调用 style.distill_start 并带上 jobId 继续同一任务。`,
  };
}

/** 任务停着（暂停 / 失败）时说明原因：任务级执行失败优先，其次是自动续跑停下的原因。 */
function pausedExplanation(job: StyleDistillationJob) {
  if (job.status !== "paused" && job.status !== "failed") return undefined;
  if (job.lastError) return { what: job.lastError.what, why: job.lastError.why, next: job.lastError.next };
  return job.autoResume?.explanation;
}

function serializeJob(
  job: StyleDistillationJob,
  expectedRevision: string | null,
  modelAvailable?: boolean,
  unavailable?: UnavailableGeneration,
) {
  return {
    job,
    expectedRevision,
    batches: summarizeStyleDistillationBatches(job),
    ...(modelAvailable === false && job.status === "paused"
      ? { explanation: modelUnavailableExplanation(unavailable) }
      : pausedExplanation(job)
        ? { explanation: pausedExplanation(job) }
        : {}),
    // 一键采纳的候选：可迁移、证据逐字吻合的模型规则（口径见 recommendedStyleDistillationRuleIds）。
    recommendedRuleIds: recommendedStyleDistillationRuleIds(job),
    result: { ...job, expectedRevision },
  };
}

export function createStyleDistillationsRouter(
  ctx: RouterContext,
  options: CreateStyleDistillationsRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot = options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));

  /**
   * 与 writing-modes 同一条服务端模型路径：宿主把生成能力绑定到当前登录用户（用量记在该用户名下）。
   * 后台批次沿用这次请求解析出的生成器，因此请求返回后批次仍按同一用户计量。
   */
  async function resolveGenerator(c: Context): Promise<{ generateText?: RuntimeTextGenerator; unavailable?: UnavailableGeneration; actorId?: string }> {
    if (options.resolveTextGenerator) {
      const actorId = requestActorId(c);
      return { generateText: await options.resolveTextGenerator(c), ...(actorId ? { actorId } : {}) };
    }
    if (!ctx.resolveTextGeneration) return {};
    const generation = await ctx.resolveTextGeneration(c).catch((error): UnavailableGeneration => ({
      available: false,
      code: "MODEL_STATUS_FAILED",
      message: `读取模型配置失败：${error instanceof Error ? error.message : String(error)}。`,
      suggestedAction: "稍后重试；若反复失败，检查设置里的模型与供应商配置。",
    }));
    if (!generation.available) return { unavailable: generation };
    const generate = generation.generateText;
    // 计量用户以宿主给的为准；宿主没给时退回请求上的登录身份。
    const actorId = generation.actorId?.trim() || requestActorId(c);
    // 截断标记与输出用量原样传给批次解析：用满输出上限要报「被截断」，而不是「没有 JSON」。
    return {
      ...(actorId ? { actorId } : {}),
      generateText: async (request) => {
        const result = await generate(request);
        return {
          text: result.text,
          ...(result.outputTruncated ? { outputTruncated: true } : {}),
          ...(typeof result.usage?.completionTokens === "number" ? { usage: { completionTokens: result.usage.completionTokens } } : {}),
        };
      },
    };
  }

  /** 后台跑批次：请求先返回 running，前端轮询任务文件看进度；失败原因写进批次。 */
  function runInBackground(bookRoot: string, jobId: string, generateText: RuntimeTextGenerator, retryFailed: boolean, initiatorId?: string): void {
    void runStyleDistillationBatches({ bookRoot, jobId, generateText, retryFailed, ...(initiatorId ? { initiatorId } : {}) }).catch((error: unknown) => {
      // 顶层不能静默：单批失败已写进批次记录，任务级失败由运行器尽量写进任务的 lastError（界面据此说明停下的原因）；
      // 任务文件本身写不进去时（如 updateJob 落盘失败）只剩日志。按本包 logger 口径（见 narrative-memory
      // 路由的 [narrative-memory] console.error）留下任务 id 与错误，供排查恢复。
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(`[style-distillations] 后台批次执行失败（任务 ${jobId}）：${detail}`);
    });
  }

  /**
   * 进程重启后的自动续跑：本进程第一次访问某本书的蒸馏接口时扫描一次，把上次执行者中途消失
   * （任务文件仍是 running、运行锁无人持有）的任务放回后台续跑。模型按本次请求的用户解析，
   * 与新建 / 手动继续同一口径；没有模型时停下并把原因写进任务。详见 style-distillation-auto-resume.ts。
   */
  app.use("/api/books/:bookId/style/distillations/*", async (c, next) => {
    let bookRoot: string | null = null;
    try {
      bookRoot = resolveBookRoot(c.req.param("bookId") ?? "");
    } catch {
      // 书根解析失败交给具体路由报错。
    }
    if (bookRoot) {
      const actorId = requestActorId(c);
      await ensureStyleDistillationAutoResume({
        bookRoot,
        ...(actorId ? { actorId } : {}),
        resolveGenerator: async () => {
          const { generateText, unavailable } = await resolveGenerator(c);
          return { ...(generateText ? { generateText } : {}), ...(unavailable ? { unavailableMessage: unavailable.message } : {}) };
        },
      });
    }
    await next();
  });

  app.post("/api/books/:bookId/style/distillations/preview", async (c) => {
    try {
      cleanupPreviews();
      const bookId = c.req.param("bookId");
      const body = bodyRecord(await c.req.json().catch(() => null));
      if (!body) return c.json({ error: "请求体必须是对象。", code: "STYLE_DISTILLATION_INVALID_INPUT" }, 400);
      const input = asInput(body);
      const preview = makePreviewSource(input);
      const bookRoot = resolveBookRoot(bookId);
      previews.set(preview.sourceId, { bookId, bookRoot, input, preview, expiresAt: Date.now() + PREVIEW_TTL_MS });
      return c.json(previewResponse(preview, input));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/books/:bookId/style/distillations/jobs", async (c) => {
    try {
      const bookRoot = resolveBookRoot(c.req.param("bookId"));
      const { jobs, corruptedJobIds } = await listStyleDistillationJobs(bookRoot);
      const views = await Promise.all(jobs.map((job) => readStyleDistillationJob(bookRoot, job.jobId)));
      return c.json({
        jobs: views.map((job) => ({
          jobId: job.jobId,
          sourceId: job.sourceId,
          sourceName: job.sourceName,
          status: job.status,
          progress: job.progress,
          ruleCount: job.rules.length,
          sampleCount: job.samples.length,
          batches: summarizeStyleDistillationBatches(job),
          createdAt: job.createdAt,
          ...(job.autoResume?.explanation ? { autoResumeExplanation: job.autoResume.explanation } : {}),
          ...(pausedExplanation(job) ? { explanation: pausedExplanation(job) } : {}),
        })),
        corruptedJobIds,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 多来源比较是派生视图：每个来源取最新任务，结果不落盘。
  app.get("/api/books/:bookId/style/distillations/compare", async (c) => {
    try {
      const bookRoot = resolveBookRoot(c.req.param("bookId"));
      const requested = (c.req.query("jobIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
      const { jobs } = await listStyleDistillationJobs(bookRoot);
      const selected = requested.length > 0 ? jobs.filter((job) => requested.includes(job.jobId)) : jobs;
      const missing = requested.filter((id) => !jobs.some((job) => job.jobId === id));
      if (missing.length > 0) throw new StyleDistillationError(`找不到蒸馏任务：${missing.join("、")}。`, "STYLE_DISTILLATION_NOT_FOUND");
      return c.json(compareStyleSources(comparisonInputsFromJobs(selected)));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/books/:bookId/style/distillations/jobs", async (c) => {
    try {
      cleanupPreviews();
      const bookId = c.req.param("bookId");
      const body = bodyRecord(await c.req.json().catch(() => null));
      if (!body) return c.json({ error: "请求体必须是对象。", code: "STYLE_DISTILLATION_INVALID_INPUT" }, 400);
      const previewId = typeof body.previewId === "string" ? body.previewId : "";
      const cached = previews.get(previewId);
      const input = cached?.bookId === bookId ? cached.input : asInput(body);
      if (!cached && !body.text && !body.chapters) {
        throw new StyleDistillationError("预览已过期，请重新预览参考文本。", "STYLE_DISTILLATION_NOT_FOUND");
      }
      const bookRoot = resolveBookRoot(bookId);
      const { generateText, unavailable, actorId } = await resolveGenerator(c);
      const created = await createStyleDistillationJob({
        bookRoot, bookId, source: input, modelAvailable: Boolean(generateText), ...(actorId ? { initiatorId: actorId } : {}),
      });
      if (generateText) runInBackground(bookRoot, created.jobId, generateText, false, actorId);
      const job = await readStyleDistillationJob(bookRoot, created.jobId);
      const current = await loadStylePreset(bookRoot);
      return c.json(serializeJob(job, current.revision, Boolean(generateText), unavailable), 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/books/:bookId/style/distillations/jobs/:jobId", async (c) => {
    try {
      const bookRoot = resolveBookRoot(c.req.param("bookId"));
      const job = await readStyleDistillationJob(bookRoot, c.req.param("jobId"));
      const current = await loadStylePreset(bookRoot);
      return c.json(serializeJob(job, current.revision));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 继续未完成批次（中断恢复或重试失败批次）；与叙述者 style.distill_start 带 jobId 同一执行函数。
  app.post("/api/books/:bookId/style/distillations/jobs/:jobId/resume", async (c) => {
    try {
      const bookRoot = resolveBookRoot(c.req.param("bookId"));
      const jobId = c.req.param("jobId");
      const body = bodyRecord(await c.req.json().catch(() => ({}))) ?? {};
      const existing = await readStyleDistillationJob(bookRoot, jobId);
      if (existing.status === "running") {
        throw new StyleDistillationError("该文风蒸馏任务正在处理中，请等待当前批次完成。", "STYLE_DISTILLATION_BUSY");
      }
      const { generateText, unavailable, actorId } = await resolveGenerator(c);
      if (!generateText) {
        const message = unavailable
          ? `无法继续模型批次：${unavailable.message}`
          : "网页入口当前没有可用的服务端模型，无法继续模型批次。";
        return c.json({
          error: message,
          code: "STYLE_DISTILLATION_MODEL_UNAVAILABLE",
          explanation: modelUnavailableExplanation(unavailable),
        }, 422);
      }
      // 手动继续的人接手成为发起人：之后的模型批次计到他名下，自动续跑也只替他续跑。
      runInBackground(bookRoot, jobId, generateText, body.retryFailed === true, actorId);
      const read = await readStyleDistillationJob(bookRoot, jobId);
      // 自动续跑达到上限而标 failed 的任务：手动继续会重新开放（执行者首次落盘前文件里还是 failed），
      // 这里按已开始处理返回，避免网页把刚开始的续跑误判为失败。
      const job = read.status === "failed" ? { ...read, status: "running" as const } : read;
      return c.json(serializeJob(job, (await loadStylePreset(bookRoot)).revision, true), 202);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/books/:bookId/style/distillations/jobs/:jobId/adopt", async (c) => {
    try {
      const bookRoot = resolveBookRoot(c.req.param("bookId"));
      const jobId = c.req.param("jobId");
      const body = bodyRecord(await c.req.json().catch(() => null));
      if (!body || !Object.hasOwn(body, "expectedRevision") || (body.expectedRevision !== null && typeof body.expectedRevision !== "string")) {
        return c.json({ error: "采纳必须携带 expectedRevision。", code: "STYLE_PRESET_INVALID", explanation: {
          what: "采纳请求缺少读取预设时的版本号。",
          why: "没有版本号就无法判断预设是否已被别处改过，可能静默覆盖作者的修改。",
          next: "重新载入任务与预设后再采纳。",
        } }, 400);
      }
      const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
      const result = await adoptStyleDistillation({
        bookRoot,
        jobId,
        ruleIds: ids(body.confirmedRuleIds),
        sampleIds: ids(body.confirmedSampleIds),
        expectedRevision: body.expectedRevision as string | null,
      });
      return c.json({ ...result.preset, guideRuleCount: result.guideRuleCount, sourceOnlyCount: result.sourceOnlyCount });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 一键采纳推荐条目（可迁移、证据逐字吻合的模型规则）；与逐条采纳共用同一个采纳函数与版本校验。
  app.post("/api/books/:bookId/style/distillations/jobs/:jobId/adopt-recommended", async (c) => {
    try {
      const bookRoot = resolveBookRoot(c.req.param("bookId"));
      const body = bodyRecord(await c.req.json().catch(() => null));
      if (!body || !Object.hasOwn(body, "expectedRevision") || (body.expectedRevision !== null && typeof body.expectedRevision !== "string")) {
        return c.json({ error: "采纳必须携带 expectedRevision。", code: "STYLE_PRESET_INVALID", explanation: {
          what: "采纳请求缺少读取预设时的版本号。",
          why: "没有版本号就无法判断预设是否已被别处改过，可能静默覆盖作者的修改。",
          next: "重新载入任务与预设后再采纳。",
        } }, 400);
      }
      const result = await adoptRecommendedStyleDistillation({
        bookRoot,
        jobId: c.req.param("jobId"),
        expectedRevision: body.expectedRevision as string | null,
      });
      return c.json({
        ...result.preset,
        guideRuleCount: result.guideRuleCount,
        sourceOnlyCount: result.sourceOnlyCount,
        adoptedRuleIds: result.job.adoption?.ruleIds ?? [],
        recommendedRuleIds: result.recommendedRuleIds,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
