import { Hono } from "hono";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceService, type CreateServiceInput, type WritingResourceTransitionAction } from "../engine/writing-resource/service.js";
import type { ListWritingResourcesFilter, WritingResourceStatus, WritingResourceType } from "../engine/writing-resource/types.js";

export function createWritingResourceRouter(): Hono {
  const app = new Hono();

  app.get("/api/books/:bookId/resources", (c) => {
    const bookId = c.req.param("bookId");
    const filter = parseFilter(c.req.query());
    const service = serviceForRequest();
    return c.json({ resources: service.list(bookId, filter) });
  });

  app.get("/api/books/:bookId/resources/:resourceId", (c) => {
    const service = serviceForRequest();
    const resource = service.getById(c.req.param("resourceId"));
    if (!resource || resource.bookId !== c.req.param("bookId") || resource.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    return c.json({ resource });
  });

  app.post("/api/books/:bookId/resources", async (c) => {
    const bookId = c.req.param("bookId");
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const service = serviceForRequest();
    const input = parseCreateInput(bookId, body);
    const resource = service.create(input);
    return c.json({ resource }, 201);
  });

  app.put("/api/books/:bookId/resources/:resourceId", async (c) => {
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const service = serviceForRequest();
    const current = service.getById(c.req.param("resourceId"));
    if (!current || current.bookId !== c.req.param("bookId") || current.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    const resource = service.update(current.id, {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.content === "string" ? { content: body.content } : {}),
      ...(isRecord(body.metadata) ? { metadata: body.metadata } : {}),
    });
    return c.json({ resource });
  });

  app.post("/api/books/:bookId/resources/:resourceId/transition", async (c) => {
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const service = serviceForRequest();
    const current = service.getById(c.req.param("resourceId"));
    if (!current || current.bookId !== c.req.param("bookId") || current.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    const action = parseTransition(body);
    try {
      const resource = service.transition(current.id, action);
      return c.json({ resource });
    } catch (cause) {
      return c.json({ error: cause instanceof Error ? cause.message : "Transition failed" }, 400);
    }
  });

  app.delete("/api/books/:bookId/resources/:resourceId", (c) => {
    const service = serviceForRequest();
    const current = service.getById(c.req.param("resourceId"));
    if (!current || current.bookId !== c.req.param("bookId") || current.deletedAt !== null) return c.json({ error: "Writing resource not found" }, 404);
    const resource = service.softDelete(current.id);
    return c.json({ ok: true, resourceId: resource.id });
  });

  app.get("/api/books/:bookId/resources/:resourceId/history", (c) => {
    const service = serviceForRequest();
    const current = service.getById(c.req.param("resourceId"));
    if (!current || current.bookId !== c.req.param("bookId")) return c.json({ error: "Writing resource not found" }, 404);
    return c.json({ history: service.getHistory(current.id) });
  });

  return app;
}

function serviceForRequest() {
  return createWritingResourceService({ storage: getStorageDatabase() });
}

function parseFilter(query: Record<string, string>): ListWritingResourcesFilter {
  return {
    ...(isType(query.type) ? { type: query.type } : {}),
    ...(isStatus(query.status) ? { status: query.status } : {}),
    ...(query.chapter && Number.isFinite(Number(query.chapter)) ? { chapterNumber: Number(query.chapter) } : {}),
    ...(query.includeDeleted === "true" ? { includeDeleted: true } : {}),
  };
}

function parseCreateInput(bookId: string, body: Record<string, unknown>): CreateServiceInput {
  const type = isType(body.type) ? body.type : "candidate";
  const status = isStatus(body.status) ? body.status : (type === "draft" ? "draft" : type === "chapter" ? "accepted" : "candidate");
  const title = stringBody(body.title, "title");
  const content = typeof body.content === "string" ? body.content : "";
  return {
    bookId,
    type,
    status,
    title,
    content,
    chapterNumber: numberBody(body.chapterNumber) ?? numberBody(body.chapter_number),
    parentId: typeof body.parentId === "string" ? body.parentId : null,
    source: typeof body.source === "string" ? body.source : "api:writing-resource",
    metadata: isRecord(body.metadata) ? body.metadata : {},
  };
}

function parseTransition(body: Record<string, unknown>): WritingResourceTransitionAction {
  const action = body.action;
  if (action === "accept") {
    const chapterNumber = numberBody(body.chapterNumber);
    if (!chapterNumber) throw new Error("Accept action requires chapterNumber.");
    const mode = body.mode === "merge" || body.mode === "new" ? body.mode : "replace";
    return { action, chapterNumber, mode };
  }
  if (action === "reject" || action === "archive" || action === "to-draft" || action === "to-candidate" || action === "restore") return { action };
  throw new Error("Invalid transition action.");
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
  return value === "chapter" || value === "candidate" || value === "draft";
}

function isStatus(value: unknown): value is WritingResourceStatus {
  return value === "draft" || value === "candidate" || value === "accepted" || value === "rejected" || value === "archived";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
