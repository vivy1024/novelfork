import { Hono, type Context } from "hono";
import type {
  JingweiFieldDefinition,
  JingweiTemplateSelection,
  JingweiVisibilityRule,
  StorageDatabase,
} from "@vivy1024/novelfork-core";

import { ApiError } from "@vivy1024/novelfork-studio/api/errors";
import { isSafeBookId } from "@vivy1024/novelfork-studio/api/safety";

/** Extended entry fields from 0012_jingwei_overhaul migration */
interface EntryWithOverhaulFields {
  category?: string;
  parentId?: string | null;
  fieldsJson?: string;
  sortOrder?: number;
  lifecycle?: string;
}

export interface CreateJingweiRouterOptions {
  storage?: StorageDatabase;
}

type CoreModule = typeof import("@vivy1024/novelfork-core");

async function loadCore(): Promise<CoreModule> {
  return import("@vivy1024/novelfork-core");
}

async function resolveStorage(options: CreateJingweiRouterOptions): Promise<StorageDatabase> {
  if (options.storage) return options.storage;
  const { getStorageDatabase } = await loadCore();
  return getStorageDatabase();
}

async function ensureBook(storage: StorageDatabase, bookId: string): Promise<void> {
  const { createBookRepository } = await loadCore();
  const book = await createBookRepository(storage).getById(bookId);
  if (!book) {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${bookId}`);
  }
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json<unknown>();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function requireText(value: unknown, code: string, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, code, message);
  }
  return value.trim();
}

function optionalText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalNullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function optionalNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNullableNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeVisibilityType(value: unknown): JingweiVisibilityRule["type"] {
  return value === "global" || value === "nested" || value === "tracked" ? value : "tracked";
}

function normalizeVisibilityRule(value: unknown, fallbackType: JingweiVisibilityRule["type"] = "tracked"): JingweiVisibilityRule {
  const raw = objectRecord(value);
  const type = raw.type === "global" || raw.type === "nested" || raw.type === "tracked" ? raw.type : fallbackType;
  const rule: JingweiVisibilityRule = { type };
  if (typeof raw.visibleAfterChapter === "number") rule.visibleAfterChapter = raw.visibleAfterChapter;
  if (typeof raw.visibleUntilChapter === "number") rule.visibleUntilChapter = raw.visibleUntilChapter;
  const keywords = stringArray(raw.keywords);
  if (keywords.length > 0) rule.keywords = keywords;
  const parentEntryIds = stringArray(raw.parentEntryIds);
  if (parentEntryIds.length > 0) rule.parentEntryIds = parentEntryIds;
  return rule;
}

function normalizeFieldsJson(value: unknown): JingweiFieldDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JingweiFieldDefinition => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const field = item as Record<string, unknown>;
    return typeof field.id === "string"
      && typeof field.key === "string"
      && typeof field.label === "string"
      && typeof field.type === "string"
      && typeof field.required === "boolean";
  });
}

function normalizeTemplateSelection(body: Record<string, unknown>): JingweiTemplateSelection {
  switch (body.templateId) {
    case "blank":
    case "basic":
    case "enhanced":
      return { templateId: body.templateId };
    case "genre-recommended":
      return {
        templateId: "genre-recommended",
        ...(typeof body.genre === "string" ? { genre: body.genre } : {}),
        selectedSectionKeys: stringArray(body.selectedSectionKeys),
      };
    default:
      throw new ApiError(400, "JINGWEI_TEMPLATE_INVALID", "Invalid jingwei templateId.");
  }
}

function validateBookId(bookId: string): void {
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
  }
}

function jsonError(error: Error) {
  if (error instanceof ApiError) {
    return { error: { code: error.code, message: error.message } };
  }
  return { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } };
}

export function createJingweiRouter(options: CreateJingweiRouterOptions = {}): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(jsonError(error), error.status as 400);
    }
    return c.json(jsonError(error instanceof Error ? error : new Error(String(error))), 500);
  });

  app.use("/api/books/:bookId/jingwei/*", async (c, next) => {
    validateBookId(c.req.param("bookId"));
    await next();
  });

  app.get("/api/books/:bookId/jingwei/sections", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createStoryJingweiSectionRepository } = await loadCore();
    const sections = await createStoryJingweiSectionRepository(storage).listByBook(bookId);
    return c.json({ sections });
  });

  app.post("/api/books/:bookId/jingwei/sections", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const timestamp = new Date();
    const { createStoryJingweiSectionRepository } = await loadCore();
    const repo = createStoryJingweiSectionRepository(storage);
    const section = await repo.create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      key: requireText(body.key, "JINGWEI_SECTION_KEY_REQUIRED", "Jingwei section key is required."),
      name: requireText(body.name, "JINGWEI_SECTION_NAME_REQUIRED", "Jingwei section name is required."),
      description: optionalText(body.description),
      icon: optionalNullableText(body.icon),
      order: optionalNumber(body.order, (await repo.listByBook(bookId)).length),
      enabled: optionalBoolean(body.enabled, true),
      showInSidebar: optionalBoolean(body.showInSidebar, true),
      participatesInAi: optionalBoolean(body.participatesInAi, true),
      defaultVisibility: normalizeVisibilityType(body.defaultVisibility),
      fieldsJson: normalizeFieldsJson(body.fieldsJson),
      builtinKind: optionalNullableText(body.builtinKind),
      sourceTemplate: optionalNullableText(body.sourceTemplate),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({ section }, 201);
  });

  app.put("/api/books/:bookId/jingwei/sections/:sectionId", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const { createStoryJingweiSectionRepository } = await loadCore();
    const section = await createStoryJingweiSectionRepository(storage).update(bookId, c.req.param("sectionId"), {
      ...(typeof body.key === "string" ? { key: body.key } : {}),
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.icon === "string" || body.icon === null ? { icon: optionalNullableText(body.icon) } : {}),
      ...(typeof body.order === "number" ? { order: body.order } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.showInSidebar === "boolean" ? { showInSidebar: body.showInSidebar } : {}),
      ...(typeof body.participatesInAi === "boolean" ? { participatesInAi: body.participatesInAi } : {}),
      ...(body.defaultVisibility ? { defaultVisibility: normalizeVisibilityType(body.defaultVisibility) } : {}),
      ...(Array.isArray(body.fieldsJson) ? { fieldsJson: normalizeFieldsJson(body.fieldsJson) } : {}),
      ...(typeof body.builtinKind === "string" || body.builtinKind === null ? { builtinKind: optionalNullableText(body.builtinKind) } : {}),
      ...(typeof body.sourceTemplate === "string" || body.sourceTemplate === null ? { sourceTemplate: optionalNullableText(body.sourceTemplate) } : {}),
      updatedAt: new Date(),
    });
    if (!section) throw new ApiError(404, "JINGWEI_SECTION_NOT_FOUND", `Jingwei section not found: ${c.req.param("sectionId")}`);
    return c.json({ section });
  });

  app.delete("/api/books/:bookId/jingwei/sections/:sectionId", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createStoryJingweiSectionRepository } = await loadCore();
    const deleted = await createStoryJingweiSectionRepository(storage).softDelete(bookId, c.req.param("sectionId"));
    if (!deleted) throw new ApiError(404, "JINGWEI_SECTION_NOT_FOUND", `Jingwei section not found: ${c.req.param("sectionId")}`);
    return c.json({ ok: true, id: c.req.param("sectionId") });
  });

  app.get("/api/books/:bookId/jingwei/entries", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const sectionId = c.req.query("sectionId");
    const category = c.req.query("category");
    const parentId = c.req.query("parentId");
    const { createStoryJingweiEntryRepository } = await loadCore();
    const repo = createStoryJingweiEntryRepository(storage);
    let entries = sectionId ? await repo.listBySection(bookId, sectionId) : await repo.listByBook(bookId);
    if (category) {
      entries = entries.filter((e) => (e as EntryWithOverhaulFields).category === category);
    }
    if (parentId !== undefined) {
      const targetParent = parentId === "" || parentId === "null" ? null : parentId;
      entries = entries.filter((e) => (e as EntryWithOverhaulFields).parentId === targetParent);
    }
    return c.json({ entries });
  });

  app.post("/api/books/:bookId/jingwei/entries", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const sectionId = requireText(body.sectionId, "JINGWEI_SECTION_ID_REQUIRED", "Jingwei sectionId is required.");
    const timestamp = new Date();
    const { createStoryJingweiEntryRepository, createStoryJingweiSectionRepository } = await loadCore();
    const section = await createStoryJingweiSectionRepository(storage).getById(bookId, sectionId);
    if (!section) throw new ApiError(404, "JINGWEI_SECTION_NOT_FOUND", `Jingwei section not found: ${sectionId}`);
    const entry = await createStoryJingweiEntryRepository(storage).create({
      id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
      bookId,
      sectionId,
      title: requireText(body.title, "JINGWEI_ENTRY_TITLE_REQUIRED", "Jingwei entry title is required."),
      contentMd: optionalText(body.contentMd),
      tags: stringArray(body.tags),
      aliases: stringArray(body.aliases),
      customFields: objectRecord(body.customFields),
      relatedChapterNumbers: numberArray(body.relatedChapterNumbers),
      relatedEntryIds: stringArray(body.relatedEntryIds),
      visibilityRule: normalizeVisibilityRule(body.visibilityRule, section.defaultVisibility),
      participatesInAi: optionalBoolean(body.participatesInAi, true),
      tokenBudget: optionalNullableNumber(body.tokenBudget),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    // Write overhaul fields directly via SQL if provided
    const overhaulCategory = optionalText(body.category, "setting");
    const overhaulParentId = optionalNullableText(body.parentId);
    const overhaulFieldsJson = typeof body.fieldsJson === "object" ? JSON.stringify(body.fieldsJson) : "{}";
    const overhaulAliasesJson = Array.isArray(body.aliasesJson) ? JSON.stringify(stringArray(body.aliasesJson)) : "[]";
    const overhaulVisibilityRuleJson = typeof body.visibilityRuleJson === "object" ? JSON.stringify(body.visibilityRuleJson) : '{"type":"tracked"}';
    storage.sqlite.prepare(`
      UPDATE "story_jingwei_entry"
      SET "category" = ?, "parent_id" = ?, "fields_json" = ?, "aliases_json" = ?, "visibility_rule_json" = ?
      WHERE "id" = ?
    `).run(overhaulCategory, overhaulParentId, overhaulFieldsJson, overhaulAliasesJson, overhaulVisibilityRuleJson, entry.id);
    return c.json({ entry: { ...entry, category: overhaulCategory, parentId: overhaulParentId, fieldsJson: overhaulFieldsJson } }, 201);
  });

  app.put("/api/books/:bookId/jingwei/entries/:entryId", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const { createStoryJingweiEntryRepository } = await loadCore();
    const entry = await createStoryJingweiEntryRepository(storage).update(bookId, c.req.param("entryId"), {
      ...(typeof body.sectionId === "string" ? { sectionId: body.sectionId } : {}),
      ...(typeof body.title === "string" ? { title: body.title.trim() } : {}),
      ...(typeof body.contentMd === "string" ? { contentMd: body.contentMd } : {}),
      ...(Array.isArray(body.tags) ? { tags: stringArray(body.tags) } : {}),
      ...(Array.isArray(body.aliases) ? { aliases: stringArray(body.aliases) } : {}),
      ...(body.customFields && typeof body.customFields === "object" ? { customFields: objectRecord(body.customFields) } : {}),
      ...(Array.isArray(body.relatedChapterNumbers) ? { relatedChapterNumbers: numberArray(body.relatedChapterNumbers) } : {}),
      ...(Array.isArray(body.relatedEntryIds) ? { relatedEntryIds: stringArray(body.relatedEntryIds) } : {}),
      ...(body.visibilityRule && typeof body.visibilityRule === "object" ? { visibilityRule: normalizeVisibilityRule(body.visibilityRule) } : {}),
      ...(typeof body.participatesInAi === "boolean" ? { participatesInAi: body.participatesInAi } : {}),
      ...(typeof body.tokenBudget === "number" || body.tokenBudget === null ? { tokenBudget: optionalNullableNumber(body.tokenBudget) } : {}),
      updatedAt: new Date(),
    });
    if (!entry) throw new ApiError(404, "JINGWEI_ENTRY_NOT_FOUND", `Jingwei entry not found: ${c.req.param("entryId")}`);
    return c.json({ entry });
  });

  app.delete("/api/books/:bookId/jingwei/entries/:entryId", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createStoryJingweiEntryRepository } = await loadCore();
    const deleted = await createStoryJingweiEntryRepository(storage).softDelete(bookId, c.req.param("entryId"));
    if (!deleted) throw new ApiError(404, "JINGWEI_ENTRY_NOT_FOUND", `Jingwei entry not found: ${c.req.param("entryId")}`);
    return c.json({ ok: true, id: c.req.param("entryId") });
  });

  app.post("/api/books/:bookId/jingwei/templates/apply", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const selection = normalizeTemplateSelection(body);
    const { applyJingweiTemplate, createStoryJingweiSectionRepository } = await loadCore();
    const repo = createStoryJingweiSectionRepository(storage);
    const existing = await repo.listByBook(bookId);
    const existingKeys = new Set(existing.map((section) => section.key));
    const timestamp = new Date();
    let createdCount = 0;
    for (const section of applyJingweiTemplate(selection).sections) {
      if (existingKeys.has(section.key)) continue;
      await repo.create({
        id: crypto.randomUUID(),
        bookId,
        key: section.key,
        name: section.name,
        description: section.description,
        icon: null,
        order: section.order,
        enabled: section.enabled,
        showInSidebar: section.showInSidebar,
        participatesInAi: section.participatesInAi,
        defaultVisibility: section.defaultVisibility,
        fieldsJson: section.fieldsJson,
        builtinKind: section.builtinKind ?? null,
        sourceTemplate: section.sourceTemplate ?? selection.templateId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      existingKeys.add(section.key);
      createdCount += 1;
    }
    return c.json({ templateId: selection.templateId, sections: await repo.listByBook(bookId) }, createdCount > 0 ? 201 : 200);
  });

  app.post("/api/books/:bookId/jingwei/preview-context", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const { buildJingweiContext } = await loadCore();
    const tokenBudget = optionalNullableNumber(body.tokenBudget);
    const context = await buildJingweiContext({
      storage,
      bookId,
      currentChapter: optionalNumber(body.currentChapter, 1),
      sceneText: typeof body.sceneText === "string" ? body.sceneText : undefined,
      ...(tokenBudget === null ? {} : { tokenBudget }),
    });
    return c.json(context);
  });

  // --- Jingwei Overhaul: Move entry ---
  app.patch("/api/books/:bookId/jingwei/entries/:entryId/move", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    const entryId = c.req.param("entryId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const newParentId = body.parentId === null || body.parentId === "" ? null : optionalNullableText(body.parentId);
    const result = storage.sqlite.prepare(`
      UPDATE "story_jingwei_entry"
      SET "parent_id" = ?, "updated_at" = ?
      WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
    `).run(newParentId, Date.now(), bookId, entryId);
    if (result.changes === 0) {
      throw new ApiError(404, "JINGWEI_ENTRY_NOT_FOUND", `Jingwei entry not found: ${entryId}`);
    }
    return c.json({ ok: true, entryId, parentId: newParentId });
  });

  // --- Jingwei Overhaul: Tree endpoint ---
  app.get("/api/books/:bookId/jingwei/tree", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const category = c.req.query("category");
    const { createStoryJingweiEntryRepository } = await loadCore();
    let entries = await createStoryJingweiEntryRepository(storage).listByBook(bookId);
    if (category) {
      entries = entries.filter((e) => (e as EntryWithOverhaulFields).category === category);
    }
    // Fetch overhaul fields for tree building
    const rows = storage.sqlite.prepare(`
      SELECT "id", "parent_id", "category", "sort_order"
      FROM "story_jingwei_entry"
      WHERE "book_id" = ? AND "deleted_at" IS NULL
    `).all(bookId) as Array<{ id: string; parent_id: string | null; category: string; sort_order: number }>;
    const overhaulMap = new Map(rows.map((r) => [r.id, r]));
    interface TreeNode {
      id: string;
      parentId: string | null;
      category: string;
      sortOrder: number;
      entry: unknown;
      children: TreeNode[];
    }
    const nodeMap = new Map<string, TreeNode>();
    for (const entry of entries) {
      const overhaul = overhaulMap.get(entry.id);
      nodeMap.set(entry.id, {
        id: entry.id,
        parentId: overhaul?.parent_id ?? null,
        category: overhaul?.category ?? "setting",
        sortOrder: overhaul?.sort_order ?? 0,
        entry,
        children: [],
      });
    }
    const roots: TreeNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    roots.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const node of nodeMap.values()) {
      node.children.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return c.json({ tree: roots });
  });

  // --- Jingwei Overhaul: Relations ---
  app.get("/api/books/:bookId/jingwei/relations", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const entryId = c.req.query("entryId");
    let relations: unknown[];
    if (entryId) {
      relations = storage.sqlite.prepare(`
        SELECT * FROM "jingwei_relations"
        WHERE "book_id" = ? AND ("source_entry_id" = ? OR "target_entry_id" = ?)
      `).all(bookId, entryId, entryId);
    } else {
      relations = storage.sqlite.prepare(`
        SELECT * FROM "jingwei_relations"
        WHERE "book_id" = ?
      `).all(bookId);
    }
    return c.json({ relations });
  });

  app.post("/api/books/:bookId/jingwei/relations", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const sourceEntryId = requireText(body.sourceEntryId, "JINGWEI_SOURCE_ENTRY_REQUIRED", "sourceEntryId is required.");
    const targetEntryId = requireText(body.targetEntryId, "JINGWEI_TARGET_ENTRY_REQUIRED", "targetEntryId is required.");
    const relationType = requireText(body.relationType, "JINGWEI_RELATION_TYPE_REQUIRED", "relationType is required.");
    const label = optionalNullableText(body.label);
    const id = crypto.randomUUID();
    const now = Date.now();
    storage.sqlite.prepare(`
      INSERT INTO "jingwei_relations" ("id", "book_id", "source_entry_id", "target_entry_id", "relation_type", "label", "metadata_json", "created_at")
      VALUES (?, ?, ?, ?, ?, ?, '{}', ?)
    `).run(id, bookId, sourceEntryId, targetEntryId, relationType, label, now);
    return c.json({ relation: { id, bookId, sourceEntryId, targetEntryId, relationType, label, metadataJson: "{}", createdAt: now } }, 201);
  });

  app.delete("/api/books/:bookId/jingwei/relations/:relationId", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    const relationId = c.req.param("relationId");
    await ensureBook(storage, bookId);
    const result = storage.sqlite.prepare(`
      DELETE FROM "jingwei_relations" WHERE "id" = ? AND "book_id" = ?
    `).run(relationId, bookId);
    if (result.changes === 0) {
      throw new ApiError(404, "JINGWEI_RELATION_NOT_FOUND", `Relation not found: ${relationId}`);
    }
    return c.json({ ok: true, id: relationId });
  });

  // --- Jingwei Overhaul: Progressions ---
  app.get("/api/books/:bookId/jingwei/entries/:entryId/progressions", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    const entryId = c.req.param("entryId");
    await ensureBook(storage, bookId);
    const progressions = storage.sqlite.prepare(`
      SELECT * FROM "jingwei_progressions"
      WHERE "book_id" = ? AND "entry_id" = ?
      ORDER BY "chapter_number" DESC, "created_at" DESC
    `).all(bookId, entryId);
    return c.json({ progressions });
  });

  app.post("/api/books/:bookId/jingwei/entries/:entryId/progressions", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    const entryId = c.req.param("entryId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const fieldKey = requireText(body.fieldKey, "PROGRESSION_FIELD_KEY_REQUIRED", "fieldKey is required.");
    const newValue = requireText(body.newValue, "PROGRESSION_NEW_VALUE_REQUIRED", "newValue is required.");
    const oldValue = optionalNullableText(body.oldValue);
    const chapterNumber = optionalNullableNumber(body.chapterNumber);
    const description = optionalNullableText(body.description);
    const id = crypto.randomUUID();
    const now = Date.now();
    storage.sqlite.prepare(`
      INSERT INTO "jingwei_progressions" ("id", "book_id", "entry_id", "field_key", "old_value", "new_value", "chapter_number", "description", "created_at")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, bookId, entryId, fieldKey, oldValue, newValue, chapterNumber, description, now);
    return c.json({
      progression: { id, bookId, entryId, fieldKey, oldValue, newValue, chapterNumber, description, createdAt: now },
    }, 201);
  });

  return app;
}
