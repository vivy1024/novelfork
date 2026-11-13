import { Hono, type Context } from "hono";
import { z } from "zod";
import { buildDissectLibrary, deleteDissectBook, DissectLibraryError, getDissectLibraryTree, MAX_DISSECT_BYTES, readDissectDocument, saveDissectDocument } from "../engine/dissect-library/dissect-library.js";
import type { HostTextGenerationAvailability } from "./context.js";

export interface CreateDissectLibraryRouterOptions {
  resolveBookRoot: (bookId: string) => string;
  resolveTextGeneration?: (c: Context) => Promise<HostTextGenerationAvailability>;
}
const buildSchema = z.object({
  bookTitle: z.string().min(1).max(120), category: z.string().max(120).optional(),
  filePath: z.string().max(2000).optional(), text: z.string().optional(),
  chapterSelection: z.object({ preset: z.enum(["first5", "first10", "all", "range"]).optional(), from: z.number().int().positive().optional(), to: z.number().int().positive().optional() }).strict().optional(),
  dissectMode: z.enum(["per-chapter", "merged"]).optional(), template: z.enum(["full", "chapter-outline", "opening", "rhythm-hooks"]).optional(), useModel: z.boolean().optional(),
}).strict();
const docSchema = z.object({ path: z.string().max(2000), content: z.string() }).strict();
async function parse<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  // Content-Length 不可信，读取流时同样限额，避免超大 JSON 先占满内存。
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  if (reader) { try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > MAX_DISSECT_BYTES + 1024 * 1024) { await reader.cancel(); throw new DissectLibraryError("请求超过 60MB 上限。", 413); } chunks.push(next.value); } } finally { reader.releaseLock(); } }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new DissectLibraryError("请求不是合法 JSON。"); }
  const result = schema.safeParse(value);
  if (!result.success) throw new DissectLibraryError("请求字段不完整或章节范围无效。");
  return result.data;
}
export function createDissectLibraryRouter(options: CreateDissectLibraryRouterOptions): Hono {
  const app = new Hono(); const base = "/api/books/:bookId/dissect-library";
  app.onError((error, c) => {
    if (error instanceof DissectLibraryError) return c.json({ error: error.message, explanation: { whatHappened: error.message, whyItMatters: "本次操作未能完成，已有拆书文档仍保留。", suggestedAction: "检查原文、章节区间与模型设置后重试。" } }, error.status);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return c.json({ error: "原文或拆书条目不存在。" }, 404);
    console.error("[dissect-library] 操作失败", error);
    return c.json({ error: "拆书库操作失败，请稍后重试。" }, 500);
  });
  const root = (c: Context) => options.resolveBookRoot(c.req.param("bookId")!);
  app.get(`${base}/tree`, async (c) => c.json(await getDissectLibraryTree(root(c))));
  app.get(`${base}/doc`, async (c) => c.json(await readDissectDocument(root(c), c.req.query("path") ?? "")));
  app.put(`${base}/doc`, async (c) => { const body = await parse(c, docSchema); return c.json(await saveDissectDocument(root(c), body.path, body.content)); });
  app.post(`${base}/build`, async (c) => {
    const body = await parse(c, buildSchema);
    const generation = body.useModel ? await options.resolveTextGeneration?.(c) : undefined;
    if (body.useModel && !generation?.available) throw new DissectLibraryError(generation && !generation.available ? generation.message : "当前未配置模型，可关闭深度精炼先秒建扫描库。", 422);
    return c.json(await buildDissectLibrary(root(c), body, generation?.available ? generation.generateText : undefined));
  });
  app.delete(`${base}/books/:targetSlug`, async (c) => c.json(await deleteDissectBook(root(c), c.req.param("targetSlug"))));
  return app;
}
