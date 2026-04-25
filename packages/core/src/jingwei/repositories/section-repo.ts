import type { StorageDatabase } from "../../storage/db.js";
import type {
  CreateStoryJingweiSectionInput,
  JingweiFieldDefinition,
  JingweiVisibilityRuleType,
  StoryJingweiSectionRecord,
  UpdateStoryJingweiSectionInput,
} from "../types.js";

interface StoryJingweiSectionRow {
  id: string;
  book_id: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  order: number;
  enabled: number;
  show_in_sidebar: number;
  participates_in_ai: number;
  default_visibility: string;
  fields_json: string;
  builtin_kind: string | null;
  source_template: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const selectColumns = `
  "id", "book_id", "key", "name", "description", "icon", "order", "enabled",
  "show_in_sidebar", "participates_in_ai", "default_visibility", "fields_json",
  "builtin_kind", "source_template", "created_at", "updated_at", "deleted_at"
`;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function toSection(row: StoryJingweiSectionRow): StoryJingweiSectionRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    order: row.order,
    enabled: Boolean(row.enabled),
    showInSidebar: Boolean(row.show_in_sidebar),
    participatesInAi: Boolean(row.participates_in_ai),
    defaultVisibility: row.default_visibility as JingweiVisibilityRuleType,
    fieldsJson: parseJson<JingweiFieldDefinition[]>(row.fields_json, []),
    builtinKind: row.builtin_kind,
    sourceTemplate: row.source_template,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

export function createStoryJingweiSectionRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateStoryJingweiSectionInput): Promise<StoryJingweiSectionRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "story_jingwei_section" (
          "id", "book_id", "key", "name", "description", "icon", "order", "enabled",
          "show_in_sidebar", "participates_in_ai", "default_visibility", "fields_json",
          "builtin_kind", "source_template", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.key,
        input.name,
        input.description,
        input.icon,
        input.order,
        input.enabled ? 1 : 0,
        input.showInSidebar ? 1 : 0,
        input.participatesInAi ? 1 : 0,
        input.defaultVisibility,
        serializeJson(input.fieldsJson),
        input.builtinKind,
        input.sourceTemplate,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted story jingwei section could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<StoryJingweiSectionRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_section"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as StoryJingweiSectionRow | undefined;
      return row ? toSection(row) : null;
    },

    async listByBook(bookId: string): Promise<StoryJingweiSectionRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_section"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "order" ASC, "name" ASC
      `).all(bookId) as StoryJingweiSectionRow[];
      return rows.map(toSection);
    },

    async listEnabledForAi(bookId: string): Promise<StoryJingweiSectionRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_section"
        WHERE "book_id" = ? AND "deleted_at" IS NULL AND "enabled" = 1 AND "participates_in_ai" = 1
        ORDER BY "order" ASC, "name" ASC
      `).all(bookId) as StoryJingweiSectionRow[];
      return rows.map(toSection);
    },

    async update(bookId: string, id: string, updates: UpdateStoryJingweiSectionInput): Promise<StoryJingweiSectionRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "story_jingwei_section"
        SET "key" = ?, "name" = ?, "description" = ?, "icon" = ?, "order" = ?, "enabled" = ?,
          "show_in_sidebar" = ?, "participates_in_ai" = ?, "default_visibility" = ?, "fields_json" = ?,
          "builtin_kind" = ?, "source_template" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.key ?? current.key,
        updates.name ?? current.name,
        updates.description ?? current.description,
        updates.icon ?? current.icon,
        updates.order ?? current.order,
        (updates.enabled ?? current.enabled) ? 1 : 0,
        (updates.showInSidebar ?? current.showInSidebar) ? 1 : 0,
        (updates.participatesInAi ?? current.participatesInAi) ? 1 : 0,
        updates.defaultVisibility ?? current.defaultVisibility,
        serializeJson(updates.fieldsJson ?? current.fieldsJson),
        updates.builtinKind ?? current.builtinKind,
        updates.sourceTemplate ?? current.sourceTemplate,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "story_jingwei_section"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
