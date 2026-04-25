import { Hono } from "hono";
import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { ApiError } from "../errors.js";

export interface CreateBibleRouterOptions {
  storage?: StorageDatabase;
}

type BibleEntityKind = "characters" | "events" | "settings" | "chapter-summaries";

type CoreModule = typeof import("@vivy1024/novelfork-core");

async function loadCore(): Promise<CoreModule> {
  return import("@vivy1024/novelfork-core");
}

async function resolveStorage(options: CreateBibleRouterOptions): Promise<StorageDatabase> {
  if (options.storage) return options.storage;
  const { getStorageDatabase } = await loadCore();
  return getStorageDatabase();
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function jsonStringify(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback);
}

function now(): Date {
  return new Date();
}

function normalizeVisibilityRule(body: Record<string, unknown>, fallbackType: "global" | "tracked" = "global"): string {
  return jsonStringify(body.visibilityRule, { type: fallbackType });
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireName(body: Record<string, unknown>): string {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new ApiError(400, "BIBLE_NAME_REQUIRED", "Bible entry name is required.");
  }
  return body.name.trim();
}

function serializeCharacter(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleCharacterRepository"]>["create"]>>) {
  return {
    ...row,
    aliases: safeJsonParse(row.aliasesJson, [] as string[]),
    traits: safeJsonParse(row.traitsJson, {} as Record<string, unknown>),
    visibilityRule: safeJsonParse(row.visibilityRuleJson, { type: "global" }),
  };
}

function serializeEvent(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleEventRepository"]>["create"]>>) {
  return {
    ...row,
    relatedCharacterIds: safeJsonParse(row.relatedCharacterIdsJson, [] as string[]),
    visibilityRule: safeJsonParse(row.visibilityRuleJson, { type: "tracked" }),
  };
}

function serializeSetting(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleSettingRepository"]>["create"]>>) {
  return {
    ...row,
    nestedRefs: safeJsonParse(row.nestedRefsJson, [] as string[]),
    visibilityRule: safeJsonParse(row.visibilityRuleJson, { type: "global" }),
  };
}

function serializeChapterSummary(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleChapterSummaryRepository"]>["create"]>>) {
  return {
    ...row,
    keyEvents: safeJsonParse(row.keyEventsJson, [] as string[]),
    appearingCharacterIds: safeJsonParse(row.appearingCharacterIdsJson, [] as string[]),
    metadata: safeJsonParse(row.metadataJson, {} as Record<string, unknown>),
  };
}

async function ensureBook(storage: StorageDatabase, bookId: string) {
  const { createBookRepository } = await loadCore();
  const book = await createBookRepository(storage).getById(bookId);
  if (!book) {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${bookId}`);
  }
  return book;
}

function deletedResponse(kind: string, id: string, deleted: boolean): Response | null {
  if (deleted) return null;
  throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `${kind} entry not found: ${id}`);
}

export function createBibleRouter(options: CreateBibleRouterOptions = {}): Hono {
  const app = new Hono();

  app.get("/api/books/:bookId/bible/characters", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createBibleCharacterRepository } = await loadCore();
    const characters = (await createBibleCharacterRepository(storage).listByBook(bookId)).map(serializeCharacter);
    return c.json({ characters });
  });

  app.post("/api/books/:bookId/bible/characters", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    const timestamp = now();
    const { createBibleCharacterRepository } = await loadCore();
    const character = await createBibleCharacterRepository(storage).create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      name: requireName(body),
      aliasesJson: jsonStringify(body.aliases, []),
      roleType: typeof body.roleType === "string" ? body.roleType : "minor",
      summary: typeof body.summary === "string" ? body.summary : "",
      traitsJson: jsonStringify(body.traits, {}),
      visibilityRuleJson: normalizeVisibilityRule(body, "global"),
      firstChapter: normalizeNullableNumber(body.firstChapter),
      lastChapter: normalizeNullableNumber(body.lastChapter),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ character: serializeCharacter(character) }, 201);
  });

  app.get("/api/books/:bookId/bible/characters/:id", async (c) => {
    const storage = await resolveStorage(options);
    const { createBibleCharacterRepository } = await loadCore();
    const character = await createBibleCharacterRepository(storage).getById(c.req.param("bookId"), c.req.param("id"));
    if (!character) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `Character not found: ${c.req.param("id")}`);
    return c.json({ character: serializeCharacter(character) });
  });

  app.put("/api/books/:bookId/bible/characters/:id", async (c) => {
    const storage = await resolveStorage(options);
    const body = await c.req.json<Record<string, unknown>>();
    const { createBibleCharacterRepository } = await loadCore();
    const character = await createBibleCharacterRepository(storage).update(c.req.param("bookId"), c.req.param("id"), {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(Array.isArray(body.aliases) ? { aliasesJson: jsonStringify(body.aliases, []) } : {}),
      ...(typeof body.roleType === "string" ? { roleType: body.roleType } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(body.traits && typeof body.traits === "object" ? { traitsJson: jsonStringify(body.traits, {}) } : {}),
      ...(body.visibilityRule && typeof body.visibilityRule === "object" ? { visibilityRuleJson: normalizeVisibilityRule(body, "global") } : {}),
      ...(typeof body.firstChapter === "number" || body.firstChapter === null ? { firstChapter: normalizeNullableNumber(body.firstChapter) } : {}),
      ...(typeof body.lastChapter === "number" || body.lastChapter === null ? { lastChapter: normalizeNullableNumber(body.lastChapter) } : {}),
      updatedAt: now(),
    });
    if (!character) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `Character not found: ${c.req.param("id")}`);
    return c.json({ character: serializeCharacter(character) });
  });

  app.delete("/api/books/:bookId/bible/characters/:id", async (c) => {
    const storage = await resolveStorage(options);
    const { createBibleCharacterRepository } = await loadCore();
    const deleted = await createBibleCharacterRepository(storage).softDelete(c.req.param("bookId"), c.req.param("id"));
    deletedResponse("Character", c.req.param("id"), deleted);
    return c.json({ ok: true, id: c.req.param("id") });
  });

  registerEventRoutes(app, options);
  registerSettingRoutes(app, options);
  registerChapterSummaryRoutes(app, options);

  app.post("/api/books/:bookId/bible/preview-context", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const { buildBibleContext } = await loadCore();
    const context = await buildBibleContext({
      storage,
      bookId,
      currentChapter: normalizeNullableNumber(body.currentChapter) ?? undefined,
      sceneText: typeof body.sceneText === "string" ? body.sceneText : undefined,
      tokenBudget: normalizeNullableNumber(body.tokenBudget) ?? undefined,
    });
    return c.json({ context });
  });

  app.patch("/api/books/:bookId/settings", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    const body = await c.req.json<Record<string, unknown>>();
    const { createBookRepository } = await loadCore();
    const book = await createBookRepository(storage).update(bookId, {
      ...(body.bibleMode === "static" || body.bibleMode === "dynamic" ? { bibleMode: body.bibleMode } : {}),
      ...(typeof body.currentChapter === "number" ? { currentChapter: body.currentChapter } : {}),
      updatedAt: now(),
    });
    if (!book) throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${bookId}`);
    return c.json({ book });
  });

  return app;
}

function registerEventRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/events", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createBibleEventRepository } = await loadCore();
    return c.json({ events: (await createBibleEventRepository(storage).listByBook(bookId)).map(serializeEvent) });
  });

  app.post("/api/books/:bookId/bible/events", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    const timestamp = now();
    const { createBibleEventRepository } = await loadCore();
    const event = await createBibleEventRepository(storage).create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      name: requireName(body),
      eventType: typeof body.eventType === "string" ? body.eventType : "background",
      chapterStart: normalizeNullableNumber(body.chapterStart),
      chapterEnd: normalizeNullableNumber(body.chapterEnd),
      summary: typeof body.summary === "string" ? body.summary : "",
      relatedCharacterIdsJson: jsonStringify(body.relatedCharacterIds, []),
      visibilityRuleJson: normalizeVisibilityRule(body, "tracked"),
      foreshadowState: typeof body.foreshadowState === "string" ? body.foreshadowState : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ event: serializeEvent(event) }, 201);
  });

  registerSimpleGetPutDelete(app, options, "events");
}

function registerSettingRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/settings", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createBibleSettingRepository } = await loadCore();
    return c.json({ settings: (await createBibleSettingRepository(storage).listByBook(bookId)).map(serializeSetting) });
  });

  app.post("/api/books/:bookId/bible/settings", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    const timestamp = now();
    const { createBibleSettingRepository } = await loadCore();
    const setting = await createBibleSettingRepository(storage).create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      category: typeof body.category === "string" ? body.category : "other",
      name: requireName(body),
      content: typeof body.content === "string" ? body.content : "",
      visibilityRuleJson: normalizeVisibilityRule(body, "global"),
      nestedRefsJson: jsonStringify(body.nestedRefs, []),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ setting: serializeSetting(setting) }, 201);
  });

  registerSimpleGetPutDelete(app, options, "settings");
}

function registerChapterSummaryRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/chapter-summaries", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createBibleChapterSummaryRepository } = await loadCore();
    return c.json({ chapterSummaries: (await createBibleChapterSummaryRepository(storage).listByBook(bookId)).map(serializeChapterSummary) });
  });

  app.post("/api/books/:bookId/bible/chapter-summaries", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.chapterNumber !== "number") {
      throw new ApiError(400, "BIBLE_CHAPTER_NUMBER_REQUIRED", "chapterNumber is required.");
    }
    const timestamp = now();
    const { createBibleChapterSummaryRepository } = await loadCore();
    const chapterSummary = await createBibleChapterSummaryRepository(storage).upsert({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      chapterNumber: body.chapterNumber,
      title: typeof body.title === "string" ? body.title : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      wordCount: typeof body.wordCount === "number" ? body.wordCount : 0,
      keyEventsJson: jsonStringify(body.keyEvents, []),
      appearingCharacterIdsJson: jsonStringify(body.appearingCharacterIds, []),
      pov: typeof body.pov === "string" ? body.pov : "",
      metadataJson: jsonStringify(body.metadata, {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ chapterSummary: serializeChapterSummary(chapterSummary) }, 201);
  });

  registerSimpleGetPutDelete(app, options, "chapter-summaries");
}

function registerSimpleGetPutDelete(app: Hono, options: CreateBibleRouterOptions, kind: BibleEntityKind): void {
  app.get(`/api/books/:bookId/bible/${kind}/:id`, async (c) => {
    const storage = await resolveStorage(options);
    const record = await getEntityById(storage, kind, c.req.param("bookId"), c.req.param("id"));
    if (!record) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `${kind} entry not found: ${c.req.param("id")}`);
    return c.json(wrapEntity(kind, record));
  });

  app.put(`/api/books/:bookId/bible/${kind}/:id`, async (c) => {
    const storage = await resolveStorage(options);
    const body = await c.req.json<Record<string, unknown>>();
    const record = await updateEntity(storage, kind, c.req.param("bookId"), c.req.param("id"), body);
    if (!record) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `${kind} entry not found: ${c.req.param("id")}`);
    return c.json(wrapEntity(kind, record));
  });

  app.delete(`/api/books/:bookId/bible/${kind}/:id`, async (c) => {
    const storage = await resolveStorage(options);
    const deleted = await softDeleteEntity(storage, kind, c.req.param("bookId"), c.req.param("id"));
    deletedResponse(kind, c.req.param("id"), deleted);
    return c.json({ ok: true, id: c.req.param("id") });
  });
}

async function getEntityById(storage: StorageDatabase, kind: BibleEntityKind, bookId: string, id: string) {
  const core = await loadCore();
  if (kind === "events") return core.createBibleEventRepository(storage).getById(bookId, id);
  if (kind === "settings") return core.createBibleSettingRepository(storage).getById(bookId, id);
  return core.createBibleChapterSummaryRepository(storage).getById(bookId, id);
}

async function updateEntity(storage: StorageDatabase, kind: BibleEntityKind, bookId: string, id: string, body: Record<string, unknown>) {
  const core = await loadCore();
  if (kind === "events") {
    return core.createBibleEventRepository(storage).update(bookId, id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.eventType === "string" ? { eventType: body.eventType } : {}),
      ...(typeof body.chapterStart === "number" || body.chapterStart === null ? { chapterStart: normalizeNullableNumber(body.chapterStart) } : {}),
      ...(typeof body.chapterEnd === "number" || body.chapterEnd === null ? { chapterEnd: normalizeNullableNumber(body.chapterEnd) } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(Array.isArray(body.relatedCharacterIds) ? { relatedCharacterIdsJson: jsonStringify(body.relatedCharacterIds, []) } : {}),
      ...(body.visibilityRule && typeof body.visibilityRule === "object" ? { visibilityRuleJson: normalizeVisibilityRule(body, "tracked") } : {}),
      ...(typeof body.foreshadowState === "string" || body.foreshadowState === null ? { foreshadowState: typeof body.foreshadowState === "string" ? body.foreshadowState : null } : {}),
      updatedAt: now(),
    });
  }
  if (kind === "settings") {
    return core.createBibleSettingRepository(storage).update(bookId, id, {
      ...(typeof body.category === "string" ? { category: body.category } : {}),
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.content === "string" ? { content: body.content } : {}),
      ...(body.visibilityRule && typeof body.visibilityRule === "object" ? { visibilityRuleJson: normalizeVisibilityRule(body, "global") } : {}),
      ...(Array.isArray(body.nestedRefs) ? { nestedRefsJson: jsonStringify(body.nestedRefs, []) } : {}),
      updatedAt: now(),
    });
  }
  return core.createBibleChapterSummaryRepository(storage).update(bookId, id, {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
    ...(typeof body.wordCount === "number" ? { wordCount: body.wordCount } : {}),
    ...(Array.isArray(body.keyEvents) ? { keyEventsJson: jsonStringify(body.keyEvents, []) } : {}),
    ...(Array.isArray(body.appearingCharacterIds) ? { appearingCharacterIdsJson: jsonStringify(body.appearingCharacterIds, []) } : {}),
    ...(typeof body.pov === "string" ? { pov: body.pov } : {}),
    ...(body.metadata && typeof body.metadata === "object" ? { metadataJson: jsonStringify(body.metadata, {}) } : {}),
    updatedAt: now(),
  });
}

async function softDeleteEntity(storage: StorageDatabase, kind: BibleEntityKind, bookId: string, id: string): Promise<boolean> {
  const core = await loadCore();
  if (kind === "events") return core.createBibleEventRepository(storage).softDelete(bookId, id);
  if (kind === "settings") return core.createBibleSettingRepository(storage).softDelete(bookId, id);
  return core.createBibleChapterSummaryRepository(storage).softDelete(bookId, id);
}

function wrapEntity(kind: BibleEntityKind, record: Awaited<ReturnType<typeof getEntityById>>) {
  if (!record) return {};
  if (kind === "events") return { event: serializeEvent(record as Parameters<typeof serializeEvent>[0]) };
  if (kind === "settings") return { setting: serializeSetting(record as Parameters<typeof serializeSetting>[0]) };
  return { chapterSummary: serializeChapterSummary(record as Parameters<typeof serializeChapterSummary>[0]) };
}
