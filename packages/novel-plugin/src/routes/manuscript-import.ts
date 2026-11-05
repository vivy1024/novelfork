/**
 * 旧稿导入 HTTP 接口（T4.2）。挂在 Runtime 已认证、已校验书籍归属的 /api/books/:bookId/* 之下；
 * 书根只经可信绑定解析，前端从不提交路径。原文由浏览器读取后上传，服务端只存快照、不碰作者原文件。
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  listManuscriptImportJobs,
  ManuscriptImportError,
  MAX_MANUSCRIPT_BYTES,
  type PlanEdit,
} from "../engine/manuscript-import/manuscript-import.js";
import {
  blockManuscriptSettlement,
  confirmManuscriptImport,
  editManuscriptImportPlan,
  isManuscriptSettlementRunning,
  publishManuscriptImport,
  readManuscriptImport,
  readManuscriptPlanChapter,
  resplitManuscriptImport,
  runManuscriptSettlement,
  startManuscriptImport,
  synthesizeManuscriptImport,
  type ManuscriptImportContext,
} from "../handlers/manuscript-import-service.js";
import type { HostTextGenerationAvailability } from "./context.js";

export interface CreateManuscriptImportRouterOptions {
  readonly resolveBookRoot: (bookId: string) => string;
  readonly resolveTextGeneration?: (c: Context) => Promise<HostTextGenerationAvailability>;
  readonly storage?: StorageDatabase;
}

type Unavailable = Extract<HostTextGenerationAvailability, { available: false }>;

function statusFor(code: ManuscriptImportError["code"]): 400 | 404 | 409 | 413 | 422 {
  switch (code) {
    case "MANUSCRIPT_IMPORT_NOT_FOUND": return 404;
    case "MANUSCRIPT_IMPORT_CONFLICT":
    case "MANUSCRIPT_IMPORT_BUSY":
    case "MANUSCRIPT_IMPORT_WRONG_PHASE": return 409;
    case "MANUSCRIPT_IMPORT_TOO_LARGE": return 413;
    case "MANUSCRIPT_IMPORT_SNAPSHOT_MISMATCH":
    case "MANUSCRIPT_IMPORT_CORRUPTED":
    case "MANUSCRIPT_IMPORT_MODEL_UNAVAILABLE": return 422;
    default: return 400;
  }
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof ManuscriptImportError) {
    return c.json({ error: { code: error.code, message: error.message }, explanation: error.explanation }, statusFor(error.code));
  }
  throw error;
}

function invalid(message: string): ManuscriptImportError {
  return new ManuscriptImportError(message, "MANUSCRIPT_IMPORT_INVALID_INPUT", {
    whatHappened: message,
    whyItMatters: "请求内容不完整，无法确定要做什么。",
    suggestedAction: "刷新导入页后重试。",
  });
}

// 请求体一律 strict：多余字段、类型不对、超长都拒绝，不按缺省值猜。长度上限与引擎层一致
// （标题 120 字由 cleanTitle 给出带原因的拒绝，这里只挡住明显的滥用）。
const positiveIndex = z.number().int().positive().max(100_000);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const planEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), index: positiveIndex, title: z.string().max(400) }).strict(),
  z.object({ op: z.literal("merge"), index: positiveIndex }).strict(),
  z.object({ op: z.literal("split"), index: positiveIndex, atLine: positiveIndex, title: z.string().max(400).optional() }).strict(),
]);
const resplitSchema = z.object({ mode: z.enum(["rule", "by-file"]).default("rule"), pattern: z.string().max(2_000).optional() }).strict();
const planEditBodySchema = z.object({ expectedRevision: revision, edit: planEditSchema }).strict();
const confirmSchema = z.object({ expectedRevision: revision }).strict();
const settleSchema = z.object({ retryFailed: z.boolean().optional() }).strict();
const emptySchema = z.object({}).strict();

async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>, message: string): Promise<T> {
  const raw = await c.req.text();
  let value: unknown = {};
  if (raw.trim()) {
    try {
      value = JSON.parse(raw);
    } catch {
      throw invalid("请求内容不是合法的 JSON。");
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid(message);
  return parsed.data;
}

function toPlanEdit(edit: z.infer<typeof planEditSchema>): PlanEdit {
  if (edit.op === "split") {
    return { op: "split", index: edit.index, atLine: edit.atLine, ...(edit.title?.trim() ? { title: edit.title } : {}) };
  }
  return edit;
}

export function createManuscriptImportRouter(options: CreateManuscriptImportRouterOptions): Hono {
  const app = new Hono();
  const base = "/api/books/:bookId/manuscript-import";
  const contextFor = (c: Context): ManuscriptImportContext => {
    const bookId = c.req.param("bookId")!;
    return { bookId, bookRoot: options.resolveBookRoot(bookId), storage: options.storage ?? getStorageDatabase() };
  };

  /** 与蒸馏、重新结算同一条服务端模型路径：Runtime 默认模型，按当前登录用户计量。 */
  async function resolveGenerator(c: Context): Promise<{ generateText: RuntimeTextGenerator } | { unavailable: Unavailable }> {
    if (!options.resolveTextGeneration) {
      return { unavailable: { available: false, code: "MODEL_NOT_CONFIGURED", message: "当前宿主没有提供服务端模型能力。", suggestedAction: "在设置里配置默认模型。" } };
    }
    const generation = await options.resolveTextGeneration(c).catch((error): Unavailable => {
      // 原始异常可能带供应商地址、内部路径；只进服务端日志，对外与任务文件里用固定文案。
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(`[manuscript-import] 读取模型配置失败：${detail}`);
      return {
        available: false,
        code: "MODEL_STATUS_FAILED",
        message: "读取模型配置失败。",
        suggestedAction: "稍后重试；若反复失败，检查设置里的模型与供应商配置。",
      };
    });
    if (!generation.available) return { unavailable: generation };
    const generate = generation.generateText;
    return {
      generateText: async (request) => {
        const result = await generate(request);
        return { text: result.text, ...(result.outputTruncated ? { outputTruncated: true } : {}) };
      },
    };
  }

  /** 有模型就后台跑逐章事实（请求先返回，前端轮询任务）；没有就停在这一步并写明原因。 */
  async function startSettlement(c: Context, context: ManuscriptImportContext, jobId: string, retryFailed: boolean) {
    const resolved = await resolveGenerator(c);
    if ("unavailable" in resolved) {
      return { started: false as const, view: await blockManuscriptSettlement(context, jobId, resolved.unavailable) };
    }
    void runManuscriptSettlement(context, jobId, { generateText: resolved.generateText, retryFailed }).catch((error: unknown) => {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(`[manuscript-import] 逐章事实执行失败（任务 ${jobId}）：${detail}`);
    });
    return { started: true as const, view: await readManuscriptImport(context, jobId) };
  }

  app.get(`${base}/jobs`, async (c) => {
    try {
      const context = contextFor(c);
      const jobs = await listManuscriptImportJobs(context.bookRoot);
      return c.json({
        // 只列本书的任务：书根可能被多本书共用，任务归属以 job.bookId 为准。
        jobs: jobs.filter((job) => job.bookId === context.bookId).map((job) => ({
          jobId: job.jobId,
          sourceName: job.sourceName,
          phase: job.phase,
          chapterCount: job.chapters.length,
          createdAt: job.createdAt,
          running: isManuscriptSettlementRunning(context, job.jobId),
        })),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 新建任务：multipart，字段 sourceName、splitPattern（可选）、files（一个文本文件，或文件夹里的多个章节文件）。
  app.post(`${base}/jobs`, async (c) => {
    try {
      const declared = Number(c.req.header("content-length") ?? "0");
      if (declared > MAX_MANUSCRIPT_BYTES + 1024 * 1024) {
        throw new ManuscriptImportError("旧稿太大。", "MANUSCRIPT_IMPORT_TOO_LARGE", {
          whatHappened: `上传内容约 ${(declared / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_MANUSCRIPT_BYTES / 1024 / 1024} MB 上限。`,
          whyItMatters: "过大的正文会占满内存，切章也可能超时。",
          suggestedAction: "按卷拆成几份分别导入。",
        });
      }
      const body = await c.req.parseBody({ all: true }).catch(() => {
        throw invalid("上传内容无法解析，需要以表单方式提交文件。");
      });
      const rawFiles = body.files;
      const list = (Array.isArray(rawFiles) ? rawFiles : rawFiles === undefined ? [] : [rawFiles])
        .filter((item): item is File => typeof item === "object" && item !== null && "arrayBuffer" in item);
      const files = await Promise.all(list.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
      const sourceName = typeof body.sourceName === "string" ? body.sourceName : files[0]?.name ?? "";
      const splitPattern = typeof body.splitPattern === "string" ? body.splitPattern : undefined;
      const view = await startManuscriptImport(contextFor(c), { sourceName, files, ...(splitPattern ? { splitPattern } : {}) });
      return c.json(view, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get(`${base}/jobs/:jobId`, async (c) => {
    try {
      return c.json(await readManuscriptImport(contextFor(c), c.req.param("jobId")));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get(`${base}/jobs/:jobId/plan/chapters/:index`, async (c) => {
    try {
      return c.json(await readManuscriptPlanChapter(contextFor(c), c.req.param("jobId"), Number(c.req.param("index"))));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post(`${base}/jobs/:jobId/resplit`, async (c) => {
    try {
      const { mode, pattern } = await parseJsonBody(c, resplitSchema, "切分方式只能是按规则（可带分章规则，最多 2000 字）或按文件。");
      return c.json(await resplitManuscriptImport(contextFor(c), c.req.param("jobId"), { mode, ...(pattern ? { pattern } : {}) }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post(`${base}/jobs/:jobId/plan-edits`, async (c) => {
    try {
      const body = await parseJsonBody(c, planEditBodySchema, "需要切分版本号，调整操作只能是改标题、与下一章合并或从某一行拆开。");
      return c.json(await editManuscriptImportPlan(contextFor(c), c.req.param("jobId"), {
        expectedRevision: body.expectedRevision,
        edit: toPlanEdit(body.edit),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 确认：写章，然后尝试开始逐章事实（无模型时停在这一步并说明）。
  app.post(`${base}/jobs/:jobId/confirm`, async (c) => {
    try {
      const { expectedRevision } = await parseJsonBody(c, confirmSchema, "缺少切分版本号。");
      const context = contextFor(c);
      const jobId = c.req.param("jobId");
      await confirmManuscriptImport(context, jobId, { expectedRevision });
      const { view } = await startSettlement(c, context, jobId, false);
      return c.json(view);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 继续逐章事实：中断续跑，或带 retryFailed 重跑失败的章。
  app.post(`${base}/jobs/:jobId/settle`, async (c) => {
    try {
      const body = await parseJsonBody(c, settleSchema, "继续逐章事实只接受 retryFailed（是否重跑失败的章）。");
      const context = contextFor(c);
      const jobId = c.req.param("jobId");
      // 先读一次：任务归属与阶段在这里同步校验，错了直接返回错误。
      // 否则后台运行一启动就因阶段不对抛错，接口却已回了 202，前端会轮询一个从未开始的任务。
      const current = await readManuscriptImport(context, jobId);
      if (current.running) return c.json(current, 202);
      if (current.job.phase !== "written" && current.job.phase !== "published") {
        throw new ManuscriptImportError("还不能开始逐章事实。", "MANUSCRIPT_IMPORT_WRONG_PHASE", {
          whatHappened: current.job.phase === "preview"
            ? "这个导入任务还在切分预览，章节还没写入。"
            : "这个导入任务正在写入章节。",
          whyItMatters: "逐章事实只结算已经写进书里的章节。",
          suggestedAction: current.job.phase === "preview" ? "先确认切分写入章节。" : "等章节写完，或回导入页点「确认」继续写入。",
        });
      }
      const { started, view } = await startSettlement(c, context, jobId, body.retryFailed === true);
      return c.json(view, started ? 202 : 422);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post(`${base}/jobs/:jobId/synthesize`, async (c) => {
    try {
      await parseJsonBody(c, emptySchema, "全书综合不需要请求参数。");
      const context = contextFor(c);
      const jobId = c.req.param("jobId");
      if (isManuscriptSettlementRunning(context, jobId)) {
        throw new ManuscriptImportError("逐章事实还在进行中。", "MANUSCRIPT_IMPORT_BUSY", {
          whatHappened: "逐章事实还在进行中。",
          whyItMatters: "现在综合，报告里的数字会是半途的；跑完后会自动综合。",
          suggestedAction: "等进度跑完。",
        });
      }
      return c.json(await synthesizeManuscriptImport(context, jobId));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post(`${base}/jobs/:jobId/publish`, async (c) => {
    try {
      await parseJsonBody(c, emptySchema, "完成导入不需要请求参数。");
      return c.json(await publishManuscriptImport(contextFor(c), c.req.param("jobId")));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
