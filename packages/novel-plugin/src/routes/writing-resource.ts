import { Hono } from "hono";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import {
  createWritingResourceService,
  type CreateServiceInput,
} from "../engine/writing-resource/service.js";
import type { ChapterStoreErrorCode, ChapterStoreExplanation } from "../engine/writing-resource/chapter-layout.js";
import { resolveChapterVolumeDirectory } from "../handlers/outline-volume.js";
import type {
  ListWritingResourcesFilter,
  WritingResourceStatus,
  WritingResourceType,
} from "../engine/writing-resource/types.js";

export interface WritingResourceRouterOptions {
  resolveBookDir?: (bookId: string) => string;
}

const CHAPTER_STORE_ERROR_CODES: ReadonlySet<string> = new Set<ChapterStoreErrorCode>([
  "CHAPTER_INDEX_UNREADABLE",
  "CHAPTER_INDEX_CORRUPT",
  "CHAPTER_FILE_DELETE_FAILED",
]);

/**
 * 章节存储拒绝继续时（索引读不到 / 已损坏 / 正文删不掉）返回带 explanation 的错误体，
 * 结构与 routes/jingwei.ts 一致：{ error: { code, message }, explanation }。
 * 按 code 识别而非 instanceof，不依赖模块同一性；其它错误原样抛给父应用。
 */
function chapterStoreErrorResponse(error: unknown): {
  status: 409 | 503;
  body: { error: { code: string; message: string }; explanation: ChapterStoreExplanation };
} | null {
  if (!(error instanceof Error)) return null;
  const { code, explanation, statusCode } = error as { code?: unknown; explanation?: unknown; statusCode?: unknown };
  if (typeof code !== "string" || !CHAPTER_STORE_ERROR_CODES.has(code)) return null;
  if (!explanation || typeof explanation !== "object") return null;
  return {
    status: statusCode === 503 ? 503 : 409,
    body: { error: { code, message: error.message }, explanation: explanation as ChapterStoreExplanation },
  };
}

export function createWritingResourceRouter(options: WritingResourceRouterOptions = {}): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    const chapterStore = chapterStoreErrorResponse(error);
    if (chapterStore) return c.json(chapterStore.body, chapterStore.status);
    throw error;
  });

  function serviceForRequest() {
    const storage = getStorageDatabase();
    return createWritingResourceService({
      storage,
      ...(options.resolveBookDir ? {
        resolveBookDir: options.resolveBookDir,
        resolveChapterVolumeDirectory: (bookId, chapterNumber) => resolveChapterVolumeDirectory(
          storage,
          bookId,
          chapterNumber,
        ),
      } : {}),
    });
  }

  app.get("/api/books/:bookId/resources", async (c) => {
    const bookId = c.req.param("bookId");
    const filter = parseFilter(c.req.query());
    const resources = await serviceForRequest().list(bookId, filter);
    return c.json({ resources });
  });

  app.get("/api/books/:bookId/resources/:resourceId", async (c) => {
    const bookId = c.req.param("bookId");
    const resource = await serviceForRequest().getById(bookId, c.req.param("resourceId"));
    if (!resource || resource.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    return c.json({ resource });
  });

  app.post("/api/books/:bookId/resources", async (c) => {
    const bookId = c.req.param("bookId");
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    try {
      const resource = await serviceForRequest().create(bookId, parseCreateInput(body));
      return c.json({ resource }, 201);
    } catch (cause) {
      const chapterStore = chapterStoreErrorResponse(cause);
      if (chapterStore) return c.json(chapterStore.body, chapterStore.status);
      return c.json({ error: cause instanceof Error ? cause.message : "Writing resource create failed" }, 400);
    }
  });

  app.put("/api/books/:bookId/resources/:resourceId", async (c) => {
    const bookId = c.req.param("bookId");
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const service = serviceForRequest();
    const resourceId = c.req.param("resourceId");
    const current = await service.getById(bookId, resourceId);
    if (!current || current.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    const resource = await service.update(bookId, current.id, {
      ...(isType(body.type) ? { type: body.type } : {}),
      ...(isStatus(body.status) ? { status: body.status } : {}),
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.content === "string" ? { content: body.content } : {}),
      ...(numberBody(body.chapterNumber) !== undefined ? { chapterNumber: numberBody(body.chapterNumber)! } : {}),
      ...(isRecord(body.metadata) ? { metadata: body.metadata } : {}),
    });
    return c.json({ resource });
  });

  app.post("/api/books/:bookId/resources/:resourceId/transition", (c) => c.json({
    error: "WRITING_RESOURCE_TRANSITION_REMOVED",
    code: "WRITING_RESOURCE_TRANSITION_REMOVED",
    summary: "候选稿与草稿机制已下线，不再有状态流转。请直接写入正式章节。",
  }, 410));

  app.delete("/api/books/:bookId/resources/:resourceId", async (c) => {
    const bookId = c.req.param("bookId");
    const service = serviceForRequest();
    const resourceId = c.req.param("resourceId");
    const current = await service.getById(bookId, resourceId);
    if (!current || current.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    const resource = await service.softDelete(bookId, current.id);
    return c.json({ ok: true, resourceId: resource.id });
  });

  app.get("/api/books/:bookId/resources/:resourceId/history", async (c) => {
    const bookId = c.req.param("bookId");
    const service = serviceForRequest();
    const resourceId = c.req.param("resourceId");
    const current = await service.getById(bookId, resourceId);
    if (!current) return c.json({ error: "Writing resource not found" }, 404);
    return c.json({ history: await service.getHistory(bookId, current.id) });
  });

  return app;
}

function parseFilter(query: Record<string, string>): ListWritingResourcesFilter {
  return {
    ...(isType(query.type) ? { type: query.type } : {}),
    ...(isStatus(query.status) ? { status: query.status } : {}),
    ...(query.chapter && Number.isFinite(Number(query.chapter)) ? { chapterNumber: Number(query.chapter) } : {}),
    ...(query.includeDeleted === "true" ? { includeDeleted: true } : {}),
  };
}

function parseCreateInput(body: Record<string, unknown>): CreateServiceInput {
  // 只支持正式章节：候选稿/草稿类型已下线。
  return {
    ...(typeof body.id === "string" && body.id.trim() ? { id: body.id.trim() } : {}),
    type: "chapter",
    status: "accepted",
    title: stringBody(body.title, "title"),
    content: typeof body.content === "string" ? body.content : "",
    chapterNumber: numberBody(body.chapterNumber) ?? numberBody(body.chapter_number),
    parentId: typeof body.parentId === "string" ? body.parentId : null,
    source: typeof body.source === "string" ? body.source : "api:writing-resource",
    metadata: isRecord(body.metadata) ? body.metadata : {},
  };
}

function stringBody(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function numberBody(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function isType(value: unknown): value is WritingResourceType {
  return value === "chapter";
}

function isStatus(value: unknown): value is WritingResourceStatus {
  return value === "accepted" || value === "archived";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
