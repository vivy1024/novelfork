import { Hono, type Context } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import type {
  JingweiFieldDefinition,
  JingweiTemplateSelection,
  JingweiVisibilityRule,
} from "../engine/jingwei/types.js";

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

type EngineModule = typeof import("../engine/index.js");

async function loadEngine(): Promise<EngineModule> {
  return import("../engine/index.js");
}

async function resolveStorage(options: CreateJingweiRouterOptions): Promise<StorageDatabase> {
  if (options.storage) return options.storage;
  return getStorageDatabase();
}

async function ensureBook(storage: StorageDatabase, bookId: string): Promise<void> {
  const { createBookRepository } = await loadEngine();
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
    const { createStoryJingweiSectionRepository } = await loadEngine();
    const sections = await createStoryJingweiSectionRepository(storage).listByBook(bookId);
    return c.json({ sections });
  });

  app.post("/api/books/:bookId/jingwei/sections", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const timestamp = new Date();
    const { createStoryJingweiSectionRepository } = await loadEngine();
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
    const { createStoryJingweiSectionRepository } = await loadEngine();
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
    const { createStoryJingweiSectionRepository } = await loadEngine();
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

    // 直接 SQL 查询，包含 overhaul 字段（category, parent_id, fields_json）
    let sql = `SELECT e.*, e.category, e.parent_id as parentId, e.fields_json as fieldsJson, e.content_md as contentMd FROM story_jingwei_entry e WHERE e.book_id = ? AND e.deleted_at IS NULL`;
    const params: unknown[] = [bookId];

    if (sectionId) {
      sql += ` AND e.section_id = ?`;
      params.push(sectionId);
    }
    if (category) {
      // 兼容旧数据：查询时匹配新分类名 + 所有映射到该分类的旧名
      const { LEGACY_CATEGORY_MAP } = await import("../engine/jingwei/unified-categories.js");
      const legacyAliases = Object.entries(LEGACY_CATEGORY_MAP)
        .filter(([, v]) => v.category === category)
        .map(([k]) => k);
      const allNames = [...new Set([category, ...legacyAliases])];
      sql += ` AND e.category IN (${allNames.map(() => "?").join(",")})`;
      params.push(...allNames);
    }
    if (parentId !== undefined) {
      const targetParent = parentId === "" || parentId === "null" ? null : parentId;
      if (targetParent === null) {
        sql += ` AND (e.parent_id IS NULL OR e.parent_id = '')`;
      } else {
        sql += ` AND e.parent_id = ?`;
        params.push(targetParent);
      }
    }

    sql += ` ORDER BY e.sort_order ASC, e.updated_at DESC`;
    const entries = storage.sqlite.prepare(sql).all(...params);
    return c.json({ entries });
  });

  app.post("/api/books/:bookId/jingwei/entries", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const body = await readJson(c);
    const sectionId = requireText(body.sectionId, "JINGWEI_SECTION_ID_REQUIRED", "Jingwei sectionId is required.");
    const timestamp = new Date();
    const { createStoryJingweiEntryRepository, createStoryJingweiSectionRepository } = await loadEngine();
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
    const { createStoryJingweiEntryRepository } = await loadEngine();
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

    // Also update overhaul columns (fields_json) so frontend reads consistent data
    const entryId = c.req.param("entryId");
    if (body.customFields && typeof body.customFields === "object") {
      storage.sqlite.prepare(`UPDATE "story_jingwei_entry" SET "fields_json" = ? WHERE "id" = ?`).run(JSON.stringify(body.customFields), entryId);
    }

    return c.json({ entry });
  });

  app.delete("/api/books/:bookId/jingwei/entries/:entryId", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);
    const { createStoryJingweiEntryRepository } = await loadEngine();
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
    const { applyJingweiTemplate, createStoryJingweiSectionRepository } = await loadEngine();
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
    const { buildJingweiContext } = await loadEngine();
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
    const { createStoryJingweiEntryRepository } = await loadEngine();
    let entries = await createStoryJingweiEntryRepository(storage).listByBook(bookId);
    if (category) {
      const { LEGACY_CATEGORY_MAP } = await import("../engine/jingwei/unified-categories.js");
      const legacyAliases = Object.entries(LEGACY_CATEGORY_MAP)
        .filter(([, v]) => v.category === category)
        .map(([k]) => k);
      const allNames = new Set([category, ...legacyAliases]);
      entries = entries.filter((e) => allNames.has((e as EntryWithOverhaulFields).category ?? ""));
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

  // --- 从 storyDir md 文件导入经纬条目 ---
  app.post("/api/books/:bookId/jingwei/import-from-files", async (c) => {
    const storage = await resolveStorage(options);
    const bookId = c.req.param("bookId");
    await ensureBook(storage, bookId);

    const { createStoryJingweiSectionRepository, createStoryJingweiEntryRepository } = await loadEngine();
    const sectionRepo = createStoryJingweiSectionRepository(storage);
    const entryRepo = createStoryJingweiEntryRepository(storage);

    // 文件名 → category 映射
    const FILE_CATEGORY_MAP: Record<string, string> = {
      "story_bible.md": "worldview",
      "volume_outline.md": "outline",
      "character_matrix.md": "character",
      "current_state.md": "special",
      "setting_guide.md": "worldview",
      "book_rules.md": "special",
      "pending_hooks.md": "foreshadowing",
      "emotional_arcs.md": "plot",
      "subplot_board.md": "plot",
      "style_guide.md": "special",
    };

    // category → section key 映射（确保 section 存在，key 必须匹配 category-schemas.ts 的 id）
    const CATEGORY_SECTION_MAP: Record<string, { key: string; name: string }> = {
      character: { key: "character", name: "角色管理" },
      event: { key: "event", name: "事件记录" },
      worldview: { key: "worldview", name: "世界观设定" },
      "power-system": { key: "power-system", name: "力量体系" },
      geography: { key: "geography", name: "地理地图" },
      faction: { key: "faction", name: "势力阵营" },
      item: { key: "item", name: "物品列表" },
      skill: { key: "skill", name: "功法体系" },
      currency: { key: "currency", name: "货币体系" },
      special: { key: "special", name: "特殊设定" },
      outline: { key: "outline", name: "大纲设定" },
      relationship: { key: "relationship", name: "人物关系" },
      foreshadowing: { key: "foreshadowing", name: "伏笔管理" },
      plot: { key: "plot", name: "情节脉络" },
      timeline: { key: "timeline", name: "时间线" },
      "chapter-summary": { key: "chapter-summary", name: "章节摘要" },
    };

    // 读取 storyDir 下的 md 文件
    const { readdir, readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // 确定 projectRoot：优先环境变量，其次 ~/.novelfork/
    let projectRoot = process.env.NOVELFORK_PROJECT_ROOT || "";
    if (!projectRoot) {
      const { homedir } = await import("node:os");
      projectRoot = join(homedir(), ".novelfork");
    }
    const storyDir = join(projectRoot, "books", bookId, "story");

    if (!existsSync(storyDir)) {
      return c.json({ ok: true, imported: 0, updated: 0, skipped: 0, message: "story 目录不存在" });
    }

    const allFiles = await readdir(storyDir);
    const mdFiles = allFiles.filter((f) => f.endsWith(".md"));

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    // 确保需要的 section 存在
    const existingSections = await sectionRepo.listByBook(bookId);
    const sectionKeyMap = new Map(existingSections.map((s) => [s.key, s.id]));

    async function ensureSection(category: string): Promise<string> {
      const mapping = CATEGORY_SECTION_MAP[category] ?? CATEGORY_SECTION_MAP.custom;
      if (sectionKeyMap.has(mapping.key)) return sectionKeyMap.get(mapping.key)!;
      const newSection = await sectionRepo.create({
        id: crypto.randomUUID(),
        bookId,
        key: mapping.key,
        name: mapping.name,
        description: "",
        icon: null,
        order: existingSections.length + sectionKeyMap.size,
        enabled: true,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "global",
        fieldsJson: [],
        builtinKind: null,
        sourceTemplate: "import",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      sectionKeyMap.set(mapping.key, newSection.id);
      return newSection.id;
    }

    // 获取已有条目用于去重
    const existingEntries = await entryRepo.listByBook(bookId);
    const existingTitleCategorySet = new Set(
      existingEntries.map((e) => {
        // 从 SQL 获取 category
        const row = storage.sqlite.prepare(
          `SELECT "category" FROM "story_jingwei_entry" WHERE "id" = ?`
        ).get(e.id) as { category: string } | undefined;
        return `${e.title}::${row?.category ?? "setting"}`;
      })
    );

    const timestamp = new Date();

    for (const fileName of mdFiles) {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      // 跳过内容为空或只有标题的文件
      if (content.trim().length < 20) {
        skipped++;
        continue;
      }

      const category = FILE_CATEGORY_MAP[fileName] ?? "custom";
      const title = fileName.replace(/\.md$/, "").replace(/_/g, " ");
      const sectionId = await ensureSection(category);
      const dedupeKey = `${title}::${category}`;

      if (existingTitleCategorySet.has(dedupeKey)) {
        // 更新已有条目
        const existing = existingEntries.find((e) => {
          const row = storage.sqlite.prepare(
            `SELECT "category" FROM "story_jingwei_entry" WHERE "id" = ?`
          ).get(e.id) as { category: string } | undefined;
          return e.title === title && (row?.category ?? "setting") === category;
        });
        if (existing) {
          await entryRepo.update(bookId, existing.id, {
            contentMd: content,
            updatedAt: timestamp,
          });
          updated++;
        }
      } else {
        // 创建新条目
        const entryId = crypto.randomUUID();
        await entryRepo.create({
          id: entryId,
          bookId,
          sectionId,
          title,
          contentMd: content,
          tags: [],
          aliases: [],
          customFields: {},
          relatedChapterNumbers: [],
          relatedEntryIds: [],
          visibilityRule: { type: "global" },
          participatesInAi: true,
          tokenBudget: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        // 写入 category
        storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry" SET "category" = ? WHERE "id" = ?
        `).run(category, entryId);
        imported++;
        existingTitleCategorySet.add(dedupeKey);
      }
    }

    return c.json({ ok: true, imported, updated, skipped });
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

  // --- Jingwei v2: Full-text search ---
  app.get("/api/books/:bookId/jingwei/search", async (c) => {
    const bookId = c.req.param("bookId");
    const q = c.req.query("q") ?? "";
    if (!q.trim()) return c.json({ results: [] });

    const storage = await resolveStorage(options);
    const results = storage.sqlite.prepare(`
      SELECT id, title, category, layer, status, substr(content_md, 1, 200) as preview
      FROM story_jingwei_entry
      WHERE book_id = ? AND deleted_at IS NULL
      AND (title LIKE ? OR content_md LIKE ? OR aliases_json LIKE ?)
      ORDER BY updated_at DESC LIMIT 50
    `).all(bookId, `%${q}%`, `%${q}%`, `%${q}%`);
    return c.json({ results });
  });

  // --- Jingwei v2: Bulk operations ---
  app.post("/api/books/:bookId/jingwei/bulk", async (c) => {
    const bookId = c.req.param("bookId");
    const storage = await resolveStorage(options);
    const body = await c.req.json<{ action: string; entryIds: string[]; target?: string }>();
    const { action, entryIds, target } = body;

    if (!entryIds?.length) return c.json({ error: "No entries specified" }, 400);

    const placeholders = entryIds.map(() => "?").join(",");
    const now = Date.now();

    switch (action) {
      case "move":
        if (!target) return c.json({ error: "target category required" }, 400);
        storage.sqlite.prepare(`UPDATE story_jingwei_entry SET category = ?, updated_at = ? WHERE id IN (${placeholders}) AND book_id = ?`).run(target, now, ...entryIds, bookId);
        break;
      case "delete":
        storage.sqlite.prepare(`UPDATE story_jingwei_entry SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders}) AND book_id = ?`).run(now, now, ...entryIds, bookId);
        break;
      case "set-status":
        if (!target) return c.json({ error: "target status required" }, 400);
        storage.sqlite.prepare(`UPDATE story_jingwei_entry SET status = ?, updated_at = ? WHERE id IN (${placeholders}) AND book_id = ?`).run(target, now, ...entryIds, bookId);
        break;
      default:
        return c.json({ error: `Unknown action: ${action}` }, 400);
    }
    return c.json({ ok: true, affected: entryIds.length });
  });

  // --- Jingwei v2: Revision history ---
  app.get("/api/books/:bookId/jingwei/entries/:entryId/revisions", async (c) => {
    const bookId = c.req.param("bookId");
    const entryId = c.req.param("entryId");
    const storage = await resolveStorage(options);
    const revisions = storage.sqlite.prepare(`
      SELECT id, content_md, category, layer, reason, changed_by, created_at
      FROM jingwei_revision
      WHERE entry_id = ? AND book_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).all(entryId, bookId);
    return c.json({ revisions });
  });

  // --- Jingwei v2: Revert to revision ---
  app.post("/api/books/:bookId/jingwei/entries/:entryId/revert", async (c) => {
    const bookId = c.req.param("bookId");
    const entryId = c.req.param("entryId");
    const storage = await resolveStorage(options);
    const body = await c.req.json<{ revisionId: string }>();

    const revision = storage.sqlite.prepare(`SELECT content_md, category, layer FROM jingwei_revision WHERE id = ? AND entry_id = ? AND book_id = ?`).get(body.revisionId, entryId, bookId) as { content_md: string; category?: string; layer?: string } | undefined;
    if (!revision) return c.json({ error: "Revision not found" }, 404);

    // Save current as new revision before reverting
    const current = storage.sqlite.prepare(`SELECT content_md, category, layer FROM story_jingwei_entry WHERE id = ? AND book_id = ?`).get(entryId, bookId) as { content_md: string; category?: string; layer?: string } | undefined;
    if (current) {
      storage.sqlite.prepare(`INSERT INTO jingwei_revision (id, entry_id, book_id, content_md, category, layer, reason, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), entryId, bookId, current.content_md, current.category, current.layer, "revert", "user", Date.now());
    }

    storage.sqlite.prepare(`UPDATE story_jingwei_entry SET content_md = ?, version = version + 1, updated_at = ? WHERE id = ? AND book_id = ?`).run(revision.content_md, Date.now(), entryId, bookId);
    return c.json({ ok: true });
  });

  // --- Jingwei v2: Custom categories ---
  app.get("/api/books/:bookId/jingwei/categories", async (c) => {
    const bookId = c.req.param("bookId");
    const storage = await resolveStorage(options);

    const { CATEGORY_META } = await import("../engine/jingwei/unified-categories.js");
    const customCats = storage.sqlite.prepare(`SELECT id, name, description, icon, sort_order FROM jingwei_custom_category WHERE book_id = ? ORDER BY sort_order`).all(bookId) as Array<{ id: string; name: string; description?: string; icon?: string; sort_order?: number }>;

    const builtinCategories = CATEGORY_META.map((m: { id: string; name: string; icon: string }) => ({ id: m.id, name: m.name, icon: m.icon, builtin: true }));
    const customCategories = customCats.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon ?? "📁", builtin: false, description: cat.description }));

    return c.json({ categories: [...builtinCategories, ...customCategories] });
  });

  app.post("/api/books/:bookId/jingwei/categories", async (c) => {
    const bookId = c.req.param("bookId");
    const storage = await resolveStorage(options);
    const body = await c.req.json<{ name: string; description?: string; icon?: string }>();

    const id = body.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
    storage.sqlite.prepare(`INSERT OR IGNORE INTO jingwei_custom_category (id, book_id, name, description, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id || crypto.randomUUID(), bookId, body.name, body.description ?? null, body.icon ?? "📁", 99, Date.now());
    return c.json({ ok: true, id });
  });

  // --- Jingwei v2: Injection preview ---
  app.get("/api/books/:bookId/jingwei/injection-preview", async (c) => {
    const bookId = c.req.param("bookId");
    const storage = await resolveStorage(options);
    const chapterNumber = Number(c.req.query("chapterNumber") ?? 1);

    const entries = storage.sqlite.prepare(`
      SELECT id, title, category, layer, priority_tier, importance,
        substr(content_md, 1, 100) as preview,
        length(content_md) as contentLength,
        visibility_rule_json
      FROM story_jingwei_entry
      WHERE book_id = ? AND deleted_at IS NULL AND participates_in_ai = 1
      ORDER BY
        CASE priority_tier WHEN 'core' THEN 0 WHEN 'relevant' THEN 1 WHEN 'reference' THEN 2 ELSE 3 END,
        importance DESC
    `).all(bookId) as Array<{ id: string; title: string; category: string; layer: string; priority_tier: string; importance: number; preview: string; contentLength: number; visibility_rule_json: string }>;

    const injected = entries.filter((e) => {
      const rule = JSON.parse(e.visibility_rule_json || '{"type":"tracked"}');
      if (rule.type === "global") return true;
      if (rule.type === "tracked") {
        const after = rule.visibleAfterChapter ?? 0;
        const until = rule.visibleUntilChapter ?? Infinity;
        return chapterNumber >= after && chapterNumber <= until;
      }
      return false;
    });

    return c.json({
      chapterNumber,
      totalEntries: entries.length,
      injectedCount: injected.length,
      entries: injected.map((e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        layer: e.layer,
        priorityTier: e.priority_tier,
        importance: e.importance,
        preview: e.preview,
        estimatedTokens: Math.ceil(e.contentLength / 1.5),
      })),
    });
  });

  // --- Jingwei v2: Entry Dependencies CRUD ---
  app.get("/api/books/:bookId/jingwei/entries/:entryId/dependencies", async (c) => {
    const bookId = c.req.param("bookId");
    const entryId = c.req.param("entryId");
    const storage = await resolveStorage(options);

    const dependsOn = storage.sqlite.prepare(`
      SELECT d.id as depId, d.relation_type as relationType, d.target_entry_id as targetEntryId,
        e.title, e.category
      FROM jingwei_dependency d
      JOIN story_jingwei_entry e ON e.id = d.target_entry_id
      WHERE d.source_entry_id = ? AND d.book_id = ? AND e.deleted_at IS NULL
    `).all(entryId, bookId);

    const dependedBy = storage.sqlite.prepare(`
      SELECT d.id as depId, d.relation_type as relationType, d.source_entry_id as sourceEntryId,
        e.title, e.category
      FROM jingwei_dependency d
      JOIN story_jingwei_entry e ON e.id = d.source_entry_id
      WHERE d.target_entry_id = ? AND d.book_id = ? AND e.deleted_at IS NULL
    `).all(entryId, bookId);

    return c.json({ dependsOn, dependedBy });
  });

  app.post("/api/books/:bookId/jingwei/dependencies", async (c) => {
    const bookId = c.req.param("bookId");
    const storage = await resolveStorage(options);
    const body = await c.req.json<{ sourceEntryId: string; targetEntryId: string; relationType?: string }>();

    const id = crypto.randomUUID();
    storage.sqlite.prepare(`
      INSERT OR IGNORE INTO jingwei_dependency (id, source_entry_id, target_entry_id, book_id, relation_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, body.sourceEntryId, body.targetEntryId, bookId, body.relationType ?? "references", Date.now());
    return c.json({ ok: true, id });
  });

  app.delete("/api/books/:bookId/jingwei/dependencies/:depId", async (c) => {
    const bookId = c.req.param("bookId");
    const depId = c.req.param("depId");
    const storage = await resolveStorage(options);
    storage.sqlite.prepare(`DELETE FROM jingwei_dependency WHERE id = ? AND book_id = ?`).run(depId, bookId);
    return c.json({ ok: true });
  });

  // --- Jingwei v2: Import from markdown ---
  app.post("/api/books/:bookId/jingwei/import", async (c) => {
    const bookId = c.req.param("bookId");
    const storage = await resolveStorage(options);
    const body = await c.req.json<{ entries: Array<{ title: string; contentMd: string; category: string; layer?: string }> }>();

    const now = Date.now();
    let imported = 0;
    for (const entry of body.entries) {
      const id = crypto.randomUUID();
      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_entry (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json, related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai, layer, priority_tier, importance, category, status, version, created_at, updated_at)
        VALUES (?, ?, '', ?, ?, '[]', '[]', '{}', '[]', '[]', '{"type":"tracked"}', 1, ?, 'auto', 40, ?, 'draft', 1, ?, ?)
      `).run(id, bookId, entry.title, entry.contentMd, entry.layer ?? "dynamic", entry.category, now, now);
      imported++;
    }
    return c.json({ ok: true, imported });
  });

  return app;
}
