import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  buildDissectLibrary,
  deleteDissectBook,
  DissectLibraryError,
  getDissectBookWorkspace,
  getDissectChapterPair,
  getDissectLibraryTree,
  MAX_DISSECT_BYTES,
  previewDissectSource,
  readDissectDocument,
  saveDissectDocument,
  type DissectBuildInput,
  type DissectPreviewInput,
} from "../engine/dissect-library/dissect-library.js";
import type { UploadedSourceInput } from "../engine/dissect-library/source-extractor.js";
import type { HostTextGenerationAvailability } from "./context.js";

export interface CreateDissectLibraryRouterOptions {
  resolveBookRoot: (bookId: string) => string;
  resolveTextGeneration?: (c: Context) => Promise<HostTextGenerationAvailability>;
}

const chapterSelectionSchema = z
  .object({
    preset: z.enum(["first3", "first5", "first10", "all", "range"]).optional(),
    from: z.number().int().positive().optional(),
    to: z.number().int().positive().optional(),
  })
  .strict();

const buildSchema = z
  .object({
    bookTitle: z.string().min(1).max(120),
    category: z.string().max(120).optional(),
    bookKind: z.enum(["novel", "knowledge"]).optional(),
    author: z.string().max(120).optional(),
    filePath: z.string().max(2000).optional(),
    text: z.string().optional(),
    reuseStoredSource: z.boolean().optional(),
    rebuildReports: z.boolean().optional(),
    splitPattern: z.string().max(2000).optional(),
    chapterSelection: chapterSelectionSchema.optional(),
    dissectMode: z.enum(["per-chapter", "merged"]).optional(),
    template: z.enum(["full", "chapter-outline", "opening", "rhythm-hooks"]).optional(),
    useModel: z.boolean().optional(),
  })
  .strict();

const previewSchema = z
  .object({
    filePath: z.string().max(2000).optional(),
    text: z.string().optional(),
    splitPattern: z.string().max(2000).optional(),
  })
  .strict();

const docSchema = z.object({ path: z.string().max(2000), content: z.string() }).strict();

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  // Content-Length 不可信，读取流时同样限额，避免超大 JSON 先占满内存。
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > MAX_DISSECT_BYTES + 1024 * 1024) {
          await reader.cancel();
          throw new DissectLibraryError("请求超过 60MB 上限。", 413);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DissectLibraryError("请求不是合法 JSON。");
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new DissectLibraryError("请求字段不完整或章节范围无效。");
  return result.data;
}

async function extractMultipartFiles(body: Record<string, unknown>): Promise<UploadedSourceInput[]> {
  const candidates: unknown[] = [];
  for (const key of ["files", "files[]"]) {
    const val = body[key];
    if (Array.isArray(val)) candidates.push(...val);
    else if (val !== undefined) candidates.push(val);
  }
  const relPathCandidates: string[] = [];
  for (const key of ["relativePaths", "relativePaths[]"]) {
    const val = body[key];
    if (Array.isArray(val)) {
      for (const item of val) relPathCandidates.push(typeof item === "string" ? item : "");
    } else if (typeof val === "string") {
      relPathCandidates.push(val);
    }
  }
  const list = candidates.filter(
    (item): item is File => typeof item === "object" && item !== null && "arrayBuffer" in item,
  );
  let total = 0;
  const out: UploadedSourceInput[] = [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const file = list[idx]!;
    const buf = new Uint8Array(await file.arrayBuffer());
    total += buf.byteLength;
    if (total > MAX_DISSECT_BYTES) {
      throw new DissectLibraryError("上传文件总大小超过 60MB 上限。", 413);
    }
    const relPath = relPathCandidates[idx]?.trim();
    out.push({ name: relPath || file.name || "source.txt", bytes: buf });
  }
  return out;
}

function parseOptionalJsonField<T>(raw: unknown, schema: z.ZodType<T>): T | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DissectLibraryError("表单 JSON 字段格式错误。");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new DissectLibraryError("章节选区字段无效。");
  return result.data;
}

async function parsePreviewPayload(c: Context): Promise<DissectPreviewInput> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_DISSECT_BYTES + 2 * 1024 * 1024) {
      throw new DissectLibraryError("上传内容超过 60MB 上限。", 413);
    }
    const body = (await c.req.parseBody({ all: true }).catch(() => {
      throw new DissectLibraryError("上传表单无法解析。");
    })) as Record<string, unknown>;
    const uploadedFiles = await extractMultipartFiles(body);
    return {
      ...(uploadedFiles.length > 0 ? { uploadedFiles } : {}),
      ...(typeof body.filePath === "string" && body.filePath.trim() ? { filePath: body.filePath.trim() } : {}),
      ...(typeof body.text === "string" && body.text ? { text: body.text } : {}),
      ...(typeof body.splitPattern === "string" && body.splitPattern.trim() ? { splitPattern: body.splitPattern.trim() } : {}),
    };
  }
  return parseJson(c, previewSchema);
}

async function parseBuildPayload(c: Context): Promise<DissectBuildInput> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_DISSECT_BYTES + 2 * 1024 * 1024) {
      throw new DissectLibraryError("上传内容超过 60MB 上限。", 413);
    }
    const body = (await c.req.parseBody({ all: true }).catch(() => {
      throw new DissectLibraryError("上传表单无法解析。");
    })) as Record<string, unknown>;
    const uploadedFiles = await extractMultipartFiles(body);
    const bookTitle = typeof body.bookTitle === "string" ? body.bookTitle.trim() : "";
    const bookKind = body.bookKind === "knowledge" ? "knowledge" : body.bookKind === "novel" ? "novel" : undefined;
    const author = typeof body.author === "string" && body.author.trim() ? body.author.trim().slice(0, 120) : undefined;
    if (!bookTitle && uploadedFiles.length === 0) {
      throw new DissectLibraryError("请提供 1–120 字的参考书名。");
    }
    if (bookTitle.length > 120) {
      throw new DissectLibraryError("请提供 1–120 字的参考书名。");
    }
    const category = typeof body.category === "string" ? body.category.trim() : undefined;
    const filePath = typeof body.filePath === "string" && body.filePath.trim() ? body.filePath.trim() : undefined;
    const text = typeof body.text === "string" && body.text.length > 0 ? body.text : undefined;
    const splitPattern = typeof body.splitPattern === "string" && body.splitPattern.trim() ? body.splitPattern.trim() : undefined;
    const reuseStoredSource = body.reuseStoredSource === "true" || body.reuseStoredSource === "1";
    const rebuildReports = body.rebuildReports === "true" || body.rebuildReports === "1";
    const useModel = body.useModel === "true" || body.useModel === "1";
    const dissectMode = body.dissectMode === "per-chapter" ? "per-chapter" : body.dissectMode === "merged" ? "merged" : undefined;
    const template =
      body.template === "full" || body.template === "chapter-outline" || body.template === "opening" || body.template === "rhythm-hooks"
        ? body.template
        : undefined;
    const chapterSelection = parseOptionalJsonField(body.chapterSelection, chapterSelectionSchema);
    return {
      bookTitle,
      ...(bookKind ? { bookKind } : {}),
      ...(author ? { author } : {}),
      ...(category ? { category } : {}),
      ...(uploadedFiles.length > 0 ? { uploadedFiles } : {}),
      ...(filePath ? { filePath } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(reuseStoredSource ? { reuseStoredSource } : {}),
      ...(rebuildReports ? { rebuildReports } : {}),
      ...(splitPattern ? { splitPattern } : {}),
      ...(chapterSelection ? { chapterSelection } : {}),
      ...(dissectMode ? { dissectMode } : {}),
      ...(template ? { template } : {}),
      useModel,
    };
  }
  return parseJson(c, buildSchema);
}

export function createDissectLibraryRouter(options: CreateDissectLibraryRouterOptions): Hono {
  const app = new Hono();
  const base = "/api/books/:bookId/dissect-library";
  app.onError((error, c) => {
    if (error instanceof DissectLibraryError) {
      return c.json(
        {
          error: error.message,
          explanation: {
            whatHappened: error.message,
            whyItMatters: "本次操作未能完成，已有拆书文档仍保留。",
            suggestedAction: "检查原文、章节区间与模型设置后重试。",
          },
        },
        error.status,
      );
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "原文或拆书条目不存在。" }, 404);
    }
    console.error("[dissect-library] 操作失败", error);
    return c.json({ error: "拆书库操作失败，请稍后重试。" }, 500);
  });

  const root = (c: Context) => options.resolveBookRoot(c.req.param("bookId")!);

  app.get(`${base}/tree`, async (c) => c.json(await getDissectLibraryTree(root(c))));
  app.get(`${base}/doc`, async (c) => c.json(await readDissectDocument(root(c), c.req.query("path") ?? "")));
  app.put(`${base}/doc`, async (c) => {
    const body = await parseJson(c, docSchema);
    return c.json(await saveDissectDocument(root(c), body.path, body.content));
  });

  app.post(`${base}/preview`, async (c) => {
    const body = await parsePreviewPayload(c);
    return c.json(await previewDissectSource(root(c), body));
  });

  app.post(`${base}/build`, async (c) => {
    const body = await parseBuildPayload(c);
    const generation = body.useModel ? await options.resolveTextGeneration?.(c) : undefined;
    if (body.useModel && !generation?.available) {
      throw new DissectLibraryError(
        generation && !generation.available ? generation.message : "当前未配置模型，可关闭深度精炼先秒建扫描库。",
        422,
      );
    }
    return c.json(await buildDissectLibrary(root(c), body, generation?.available ? generation.generateText : undefined));
  });

  app.get(`${base}/books/:targetSlug/workspace`, async (c) => {
    return c.json(await getDissectBookWorkspace(root(c), decodeURIComponent(c.req.param("targetSlug")!)));
  });

  app.get(`${base}/books/:targetSlug/chapters/:chapterNumber`, async (c) => {
    const ch = Number.parseInt(c.req.param("chapterNumber")!, 10);
    return c.json(await getDissectChapterPair(root(c), decodeURIComponent(c.req.param("targetSlug")!), ch));
  });

  app.delete(`${base}/books/:targetSlug`, async (c) => {
    return c.json(await deleteDissectBook(root(c), decodeURIComponent(c.req.param("targetSlug")!)));
  });

  return app;
}
