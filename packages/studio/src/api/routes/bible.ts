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

function serializeConflict(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleConflictRepository"]>["create"]>>, currentChapter?: number, stalledWarnings: Array<{ conflictId: string }> = []) {
  return {
    ...row,
    protagonistSide: safeJsonParse(row.protagonistSideJson, [] as string[]),
    antagonistSide: safeJsonParse(row.antagonistSideJson, [] as string[]),
    rootCause: safeJsonParse(row.rootCauseJson, {} as Record<string, unknown>),
    evolutionPath: safeJsonParse(row.evolutionPathJson, [] as Array<Record<string, unknown>>),
    relatedConflictIds: safeJsonParse(row.relatedConflictIdsJson, [] as string[]),
    visibilityRule: safeJsonParse(row.visibilityRuleJson, { type: "tracked" }),
    stalled: currentChapter === undefined ? false : stalledWarnings.some((warning) => warning.conflictId === row.id),
  };
}

function serializeWorldModel(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleWorldModelRepository"]>["create"]>>) {
  return {
    ...row,
    economy: safeJsonParse(row.economyJson, {} as Record<string, unknown>),
    society: safeJsonParse(row.societyJson, {} as Record<string, unknown>),
    geography: safeJsonParse(row.geographyJson, {} as Record<string, unknown>),
    powerSystem: safeJsonParse(row.powerSystemJson, {} as Record<string, unknown>),
    culture: safeJsonParse(row.cultureJson, {} as Record<string, unknown>),
    timeline: safeJsonParse(row.timelineJson, {} as Record<string, unknown>),
  };
}

function serializePremise(row: Awaited<ReturnType<ReturnType<CoreModule["createBiblePremiseRepository"]>["create"]>>) {
  return {
    ...row,
    theme: safeJsonParse(row.themeJson, [] as string[]),
    genreTags: safeJsonParse(row.genreTagsJson, [] as string[]),
  };
}

function serializeCharacterArc(row: Awaited<ReturnType<ReturnType<CoreModule["createBibleCharacterArcRepository"]>["create"]>>) {
  return {
    ...row,
    keyTurningPoints: safeJsonParse(row.keyTurningPointsJson, [] as Array<Record<string, unknown>>),
    visibilityRule: safeJsonParse(row.visibilityRuleJson, { type: "global" }),
  };
}

function serializeQuestionnaireTemplate(row: Awaited<ReturnType<ReturnType<CoreModule["createQuestionnaireTemplateRepository"]>["getById"]>>) {
  if (!row) return null;
  return {
    ...row,
    genreTags: safeJsonParse(row.genreTagsJson, [] as string[]),
    questions: safeJsonParse(row.questionsJson, [] as Array<Record<string, unknown>>),
  };
}

function serializeQuestionnaireResponse(row: Awaited<ReturnType<ReturnType<CoreModule["createQuestionnaireResponseRepository"]>["getById"]>>) {
  if (!row) return null;
  return {
    ...row,
    answers: safeJsonParse(row.answersJson, {} as Record<string, unknown>),
  };
}

function serializeCoreShift(row: Awaited<ReturnType<ReturnType<CoreModule["createCoreShiftRepository"]>["getById"]>>) {
  if (!row) return null;
  return {
    ...row,
    fromSnapshot: safeJsonParse(row.fromSnapshotJson, {} as Record<string, unknown>),
    toSnapshot: safeJsonParse(row.toSnapshotJson, {} as Record<string, unknown>),
    affectedChapters: safeJsonParse(row.affectedChaptersJson, [] as number[]),
    impactAnalysis: safeJsonParse(row.impactAnalysisJson, {} as Record<string, unknown>),
  };
}

async function ensureQuestionnaireSeeds(storage: StorageDatabase): Promise<void> {
  const core = await loadCore();
  await core.seedQuestionnaireTemplates(storage);
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
  registerConflictRoutes(app, options);
  registerWorldModelRoutes(app, options);
  registerPremiseRoutes(app, options);
  registerCharacterArcRoutes(app, options);
  registerQuestionnaireRoutes(app, options);
  registerCoreShiftRoutes(app, options);
  registerPGIRoutes(app, options);

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

function registerConflictRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/conflicts/active", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const chapter = Number(c.req.query("chapter") ?? "0");
    const core = await loadCore();
    const conflicts = await core.createBibleConflictRepository(storage).getActiveConflictsAtChapter(bookId, Number.isFinite(chapter) ? chapter : 0);
    return c.json({ conflicts: conflicts.map((row) => serializeConflict(row)) });
  });

  app.get("/api/books/:bookId/bible/conflicts", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    const book = await ensureBook(storage, bookId);
    const core = await loadCore();
    const warnings = core.detectStalledConflicts(await core.createBibleConflictRepository(storage).listByBook(bookId), book.currentChapter);
    const conflicts = (await core.createBibleConflictRepository(storage).listByBook(bookId)).map((row) => serializeConflict(row, book.currentChapter, warnings));
    return c.json({ conflicts });
  });

  app.post("/api/books/:bookId/bible/conflicts", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    const timestamp = now();
    const core = await loadCore();
    const conflict = await core.createBibleConflictRepository(storage).create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      name: requireName(body),
      type: typeof body.type === "string" ? body.type : "external-character",
      scope: typeof body.scope === "string" ? body.scope : "arc",
      priority: typeof body.priority === "number" ? body.priority : 3,
      protagonistSideJson: jsonStringify(body.protagonistSide, []),
      antagonistSideJson: jsonStringify(body.antagonistSide, []),
      stakes: typeof body.stakes === "string" ? body.stakes : "",
      rootCauseJson: jsonStringify(body.rootCause, {}),
      evolutionPathJson: jsonStringify(body.evolutionPath, []),
      resolutionState: typeof body.resolutionState === "string" ? body.resolutionState : "unborn",
      resolutionChapter: normalizeNullableNumber(body.resolutionChapter),
      relatedConflictIdsJson: jsonStringify(body.relatedConflictIds, []),
      visibilityRuleJson: normalizeVisibilityRule(body, "tracked"),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ conflict: serializeConflict(conflict) }, 201);
  });

  app.get("/api/books/:bookId/bible/conflicts/:id", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const conflict = await core.createBibleConflictRepository(storage).getById(c.req.param("bookId"), c.req.param("id"));
    if (!conflict) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `Conflict not found: ${c.req.param("id")}`);
    return c.json({ conflict: serializeConflict(conflict) });
  });

  app.put("/api/books/:bookId/bible/conflicts/:id", async (c) => {
    const storage = await resolveStorage(options);
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    const conflict = await core.createBibleConflictRepository(storage).update(c.req.param("bookId"), c.req.param("id"), {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.type === "string" ? { type: body.type } : {}),
      ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
      ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
      ...(Array.isArray(body.protagonistSide) ? { protagonistSideJson: jsonStringify(body.protagonistSide, []) } : {}),
      ...(Array.isArray(body.antagonistSide) ? { antagonistSideJson: jsonStringify(body.antagonistSide, []) } : {}),
      ...(typeof body.stakes === "string" ? { stakes: body.stakes } : {}),
      ...(body.rootCause && typeof body.rootCause === "object" ? { rootCauseJson: jsonStringify(body.rootCause, {}) } : {}),
      ...(Array.isArray(body.evolutionPath) ? { evolutionPathJson: jsonStringify(body.evolutionPath, []) } : {}),
      ...(typeof body.resolutionState === "string" ? { resolutionState: body.resolutionState } : {}),
      ...(typeof body.resolutionChapter === "number" || body.resolutionChapter === null ? { resolutionChapter: normalizeNullableNumber(body.resolutionChapter) } : {}),
      ...(Array.isArray(body.relatedConflictIds) ? { relatedConflictIdsJson: jsonStringify(body.relatedConflictIds, []) } : {}),
      ...(body.visibilityRule && typeof body.visibilityRule === "object" ? { visibilityRuleJson: normalizeVisibilityRule(body, "tracked") } : {}),
      updatedAt: now(),
    });
    if (!conflict) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `Conflict not found: ${c.req.param("id")}`);
    return c.json({ conflict: serializeConflict(conflict) });
  });

  app.delete("/api/books/:bookId/bible/conflicts/:id", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const deleted = await core.createBibleConflictRepository(storage).softDelete(c.req.param("bookId"), c.req.param("id"));
    deletedResponse("Conflict", c.req.param("id"), deleted);
    return c.json({ ok: true, id: c.req.param("id") });
  });
}

function registerWorldModelRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/world-model", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const core = await loadCore();
    const worldModel = await core.createBibleWorldModelRepository(storage).getByBook(bookId);
    return c.json({ worldModel: worldModel ? serializeWorldModel(worldModel) : null });
  });

  app.put("/api/books/:bookId/bible/world-model", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    const worldModel = await core.createBibleWorldModelRepository(storage).upsert({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      economyJson: jsonStringify(body.economy, {}),
      societyJson: jsonStringify(body.society, {}),
      geographyJson: jsonStringify(body.geography, {}),
      powerSystemJson: jsonStringify(body.powerSystem, {}),
      cultureJson: jsonStringify(body.culture, {}),
      timelineJson: jsonStringify(body.timeline, {}),
      updatedAt: now(),
    });
    return c.json({ worldModel: serializeWorldModel(worldModel) });
  });
}

function registerPremiseRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/premise", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const core = await loadCore();
    const premise = await core.createBiblePremiseRepository(storage).getByBook(bookId);
    return c.json({ premise: premise ? serializePremise(premise) : null });
  });

  app.put("/api/books/:bookId/bible/premise", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    const timestamp = now();
    const core = await loadCore();
    const current = await core.createBiblePremiseRepository(storage).getByBook(bookId);
    const premise = await core.createBiblePremiseRepository(storage).upsert({
      id: typeof body.id === "string" ? body.id : current?.id ?? crypto.randomUUID(),
      bookId,
      logline: typeof body.logline === "string" ? body.logline : current?.logline ?? "",
      themeJson: jsonStringify(body.theme, current ? safeJsonParse(current.themeJson, [] as string[]) : []),
      tone: typeof body.tone === "string" ? body.tone : current?.tone ?? "",
      targetReaders: typeof body.targetReaders === "string" ? body.targetReaders : current?.targetReaders ?? "",
      uniqueHook: typeof body.uniqueHook === "string" ? body.uniqueHook : current?.uniqueHook ?? "",
      genreTagsJson: jsonStringify(body.genreTags, current ? safeJsonParse(current.genreTagsJson, [] as string[]) : []),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    return c.json({ premise: serializePremise(premise) });
  });
}

function registerCharacterArcRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/bible/character-arcs", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const core = await loadCore();
    return c.json({ characterArcs: (await core.createBibleCharacterArcRepository(storage).listByBook(bookId)).map(serializeCharacterArc) });
  });

  app.get("/api/books/:bookId/bible/character-arcs/:id", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const arc = await core.createBibleCharacterArcRepository(storage).getById(c.req.param("bookId"), c.req.param("id"));
    if (!arc) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `Character arc not found: ${c.req.param("id")}`);
    return c.json({ characterArc: serializeCharacterArc(arc) });
  });

  app.post("/api/books/:bookId/bible/character-arcs", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.characterId !== "string" || body.characterId.trim().length === 0) {
      throw new ApiError(400, "BIBLE_CHARACTER_ID_REQUIRED", "characterId is required.");
    }
    const timestamp = now();
    const core = await loadCore();
    const arc = await core.createBibleCharacterArcRepository(storage).create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      characterId: body.characterId,
      arcType: typeof body.arcType === "string" ? body.arcType : "成长",
      startingState: typeof body.startingState === "string" ? body.startingState : "",
      endingState: typeof body.endingState === "string" ? body.endingState : "",
      keyTurningPointsJson: jsonStringify(body.keyTurningPoints, []),
      currentPosition: typeof body.currentPosition === "string" ? body.currentPosition : "",
      visibilityRuleJson: normalizeVisibilityRule(body, "global"),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ characterArc: serializeCharacterArc(arc) }, 201);
  });

  app.put("/api/books/:bookId/bible/character-arcs/:id", async (c) => {
    const storage = await resolveStorage(options);
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    const arc = await core.createBibleCharacterArcRepository(storage).update(c.req.param("bookId"), c.req.param("id"), {
      ...(typeof body.arcType === "string" ? { arcType: body.arcType } : {}),
      ...(typeof body.startingState === "string" ? { startingState: body.startingState } : {}),
      ...(typeof body.endingState === "string" ? { endingState: body.endingState } : {}),
      ...(Array.isArray(body.keyTurningPoints) ? { keyTurningPointsJson: jsonStringify(body.keyTurningPoints, []) } : {}),
      ...(typeof body.currentPosition === "string" ? { currentPosition: body.currentPosition } : {}),
      ...(body.visibilityRule && typeof body.visibilityRule === "object" ? { visibilityRuleJson: normalizeVisibilityRule(body, "global") } : {}),
      updatedAt: now(),
    });
    if (!arc) throw new ApiError(404, "BIBLE_ENTRY_NOT_FOUND", `Character arc not found: ${c.req.param("id")}`);
    return c.json({ characterArc: serializeCharacterArc(arc) });
  });

  app.delete("/api/books/:bookId/bible/character-arcs/:id", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const deleted = await core.createBibleCharacterArcRepository(storage).softDelete(c.req.param("bookId"), c.req.param("id"));
    deletedResponse("CharacterArc", c.req.param("id"), deleted);
    return c.json({ ok: true, id: c.req.param("id") });
  });
}

function registerPGIRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.post("/api/books/:bookId/chapters/:chapter/pre-generation-questions", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const chapter = Number(c.req.param("chapter"));
    const core = await loadCore();
    const result = await core.generatePGIQuestions(storage, { bookId, chapter: Number.isFinite(chapter) ? chapter : 0 });
    return c.json(result);
  });
}

function registerCoreShiftRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/books/:bookId/core-shifts", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const status = c.req.query("status") as "proposed" | "accepted" | "rejected" | "applied" | undefined;
    const core = await loadCore();
    const coreShifts = await core.createCoreShiftRepository(storage).listByBook(bookId, status);
    return c.json({ coreShifts: coreShifts.map((row) => serializeCoreShift(row)) });
  });

  app.post("/api/books/:bookId/core-shifts", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.targetType !== "string" || typeof body.targetId !== "string") {
      throw new ApiError(400, "CORE_SHIFT_TARGET_REQUIRED", "targetType and targetId are required.");
    }
    const core = await loadCore();
    const shift = await core.proposeCoreShift(storage, {
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      targetType: body.targetType as Parameters<typeof core.proposeCoreShift>[1]["targetType"],
      targetId: body.targetId,
      fromSnapshot: body.fromSnapshot && typeof body.fromSnapshot === "object" ? body.fromSnapshot as Record<string, unknown> : {},
      toSnapshot: body.toSnapshot && typeof body.toSnapshot === "object" ? body.toSnapshot as Record<string, unknown> : {},
      triggeredBy: body.triggeredBy === "data-signal" || body.triggeredBy === "continuity-audit" ? body.triggeredBy : "author",
      chapterAt: typeof body.chapterAt === "number" ? body.chapterAt : 0,
    });
    return c.json({ coreShift: serializeCoreShift(shift) }, 201);
  });

  app.post("/api/books/:bookId/core-shifts/:id/accept", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const core = await loadCore();
    const shift = await core.acceptCoreShift(storage, bookId, c.req.param("id"));
    if (!shift) throw new ApiError(404, "CORE_SHIFT_NOT_FOUND", `CoreShift not found: ${c.req.param("id")}`);
    return c.json({ coreShift: serializeCoreShift(shift) });
  });

  app.post("/api/books/:bookId/core-shifts/:id/reject", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const core = await loadCore();
    const shift = await core.rejectCoreShift(storage, bookId, c.req.param("id"));
    if (!shift) throw new ApiError(404, "CORE_SHIFT_NOT_FOUND", `CoreShift not found: ${c.req.param("id")}`);
    return c.json({ coreShift: serializeCoreShift(shift) });
  });
}

function registerQuestionnaireRoutes(app: Hono, options: CreateBibleRouterOptions): void {
  app.get("/api/questionnaires", async (c) => {
    const storage = await resolveStorage(options);
    await ensureQuestionnaireSeeds(storage);
    const core = await loadCore();
    const tierRaw = c.req.query("tier");
    const tier = tierRaw === "1" || tierRaw === "2" || tierRaw === "3" ? Number(tierRaw) as 1 | 2 | 3 : undefined;
    const templates = await core.createQuestionnaireTemplateRepository(storage).list({
      genre: c.req.query("genre") || undefined,
      tier,
    });
    return c.json({ templates: templates.map((row) => serializeQuestionnaireTemplate(row)) });
  });

  app.post("/api/books/:bookId/questionnaires/:templateId/responses", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    await ensureQuestionnaireSeeds(storage);
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    const result = await core.submitQuestionnaireResponse({
      storage,
      bookId,
      templateId: c.req.param("templateId"),
      responseId: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      answers: body.answers && typeof body.answers === "object" ? body.answers as Record<string, unknown> : {},
      answeredVia: body.answeredVia === "ai-assisted" ? "ai-assisted" : "author",
      status: body.status === "draft" || body.status === "skipped" ? body.status : "submitted",
    });
    return c.json({ response: serializeQuestionnaireResponse(result.response), targetObjectId: result.targetObjectId }, 201);
  });

  app.put("/api/books/:bookId/questionnaires/:templateId/responses/:id", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    await ensureQuestionnaireSeeds(storage);
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    if (body.status === "submitted") {
      const result = await core.submitQuestionnaireResponse({
        storage,
        bookId,
        templateId: c.req.param("templateId"),
        responseId: c.req.param("id"),
        answers: body.answers && typeof body.answers === "object" ? body.answers as Record<string, unknown> : {},
        answeredVia: body.answeredVia === "ai-assisted" ? "ai-assisted" : "author",
        status: "submitted",
      });
      return c.json({ response: serializeQuestionnaireResponse(result.response), targetObjectId: result.targetObjectId });
    }
    const response = await core.createQuestionnaireResponseRepository(storage).update(bookId, c.req.param("id"), {
      ...(body.answers && typeof body.answers === "object" ? { answersJson: jsonStringify(body.answers, {}) } : {}),
      ...(body.status === "draft" || body.status === "skipped" ? { status: body.status } : {}),
      ...(body.answeredVia === "ai-assisted" || body.answeredVia === "author" ? { answeredVia: body.answeredVia } : {}),
      updatedAt: now(),
    });
    if (!response) throw new ApiError(404, "QUESTIONNAIRE_RESPONSE_NOT_FOUND", `Questionnaire response not found: ${c.req.param("id")}`);
    return c.json({ response: serializeQuestionnaireResponse(response) });
  });

  app.post("/api/books/:bookId/questionnaires/:templateId/ai-suggest", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    await ensureQuestionnaireSeeds(storage);
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    const template = await core.createQuestionnaireTemplateRepository(storage).getById(c.req.param("templateId"));
    if (!template) throw new ApiError(404, "QUESTIONNAIRE_TEMPLATE_NOT_FOUND", `Questionnaire template not found: ${c.req.param("templateId")}`);
    const questions = safeJsonParse(template.questionsJson, [] as Array<{ id: string }>);
    const question = questions.find((entry) => entry.id === body.questionId);
    if (!question) throw new ApiError(404, "QUESTIONNAIRE_QUESTION_NOT_FOUND", `Question not found: ${String(body.questionId)}`);
    const suggestion = await core.suggestQuestionnaireAnswer({
      question: question as Parameters<typeof core.suggestQuestionnaireAnswer>[0]["question"],
      existingAnswers: body.existingAnswers && typeof body.existingAnswers === "object" ? body.existingAnswers as Record<string, unknown> : {},
      context: { bookId, templateId: c.req.param("templateId") },
    });
    return c.json({ suggestion });
  });
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
