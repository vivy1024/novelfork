import type { StorageDatabase } from "../../storage/db.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import type {
  CreateStoryJingweiSectionInput,
  JingweiVisibilityRule,
  StoryJingweiEntryRecord,
  StoryJingweiSectionRecord,
} from "../types.js";

interface LegacyCharacterRow {
  id: string;
  book_id: string;
  name: string;
  aliases_json: string;
  role_type: string;
  summary: string;
  traits_json: string;
  visibility_rule_json: string;
  first_chapter: number | null;
  last_chapter: number | null;
  created_at: number;
  updated_at: number;
}

interface LegacyEventRow {
  id: string;
  book_id: string;
  name: string;
  event_type: string;
  chapter_start: number | null;
  chapter_end: number | null;
  summary: string;
  related_character_ids_json: string;
  visibility_rule_json: string;
  foreshadow_state: string | null;
  created_at: number;
  updated_at: number;
}

interface LegacySettingRow {
  id: string;
  book_id: string;
  category: string;
  name: string;
  content: string;
  visibility_rule_json: string;
  nested_refs_json: string;
  created_at: number;
  updated_at: number;
}

interface LegacyChapterSummaryRow {
  id: string;
  book_id: string;
  chapter_number: number;
  title: string;
  summary: string;
  word_count: number;
  key_events_json: string;
  appearing_character_ids_json: string;
  pov: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

const LEGACY_SOURCE_TEMPLATE = "legacy-bible";

const LEGACY_SECTION_DEFINITIONS: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  builtinKind: string;
  defaultVisibility: JingweiVisibilityRule["type"];
}> = [
  {
    key: "people",
    name: "人物",
    description: "由 legacy bible_character 非破坏性映射而来的人物栏目。",
    builtinKind: "people",
    defaultVisibility: "tracked",
  },
  {
    key: "events",
    name: "事件",
    description: "由 legacy bible_event 非破坏性映射而来的事件栏目。",
    builtinKind: "events",
    defaultVisibility: "tracked",
  },
  {
    key: "settings",
    name: "设定",
    description: "由 legacy bible_setting 非破坏性映射而来的设定栏目。",
    builtinKind: "settings",
    defaultVisibility: "global",
  },
  {
    key: "chapter-summary",
    name: "章节摘要",
    description: "由 legacy bible_chapter_summary 非破坏性映射而来的章节摘要栏目。",
    builtinKind: "chapter-summary",
    defaultVisibility: "global",
  },
];

function legacySectionId(bookId: string, key: string): string {
  return `legacy-bible:${bookId}:${key}`;
}

function legacyEntryId(kind: string, id: string): string {
  return `legacy-bible:${kind}:${id}`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function compactNumbers(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number"))];
}

function normalizeVisibilityRule(value: string): JingweiVisibilityRule {
  const parsed = parseJson<Record<string, unknown>>(value, { type: "tracked" });
  const type = parsed.type === "global" || parsed.type === "nested" || parsed.type === "tracked" ? parsed.type : "tracked";
  const rule: JingweiVisibilityRule = { type };
  if (typeof parsed.visibleAfterChapter === "number") rule.visibleAfterChapter = parsed.visibleAfterChapter;
  if (typeof parsed.visibleUntilChapter === "number") rule.visibleUntilChapter = parsed.visibleUntilChapter;
  if (Array.isArray(parsed.keywords)) rule.keywords = parsed.keywords.filter((item): item is string => typeof item === "string");
  if (Array.isArray(parsed.parentEntryIds)) {
    rule.parentEntryIds = parsed.parentEntryIds.filter((item): item is string => typeof item === "string");
  } else if (Array.isArray(parsed.parentIds)) {
    rule.parentEntryIds = parsed.parentIds.filter((item): item is string => typeof item === "string");
  }
  return rule;
}

function createLegacySectionInput(bookId: string, definition: typeof LEGACY_SECTION_DEFINITIONS[number], order: number, now: Date): CreateStoryJingweiSectionInput {
  return {
    id: legacySectionId(bookId, definition.key),
    bookId,
    key: definition.key,
    name: definition.name,
    description: definition.description,
    icon: null,
    order,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: definition.defaultVisibility,
    fieldsJson: [],
    builtinKind: definition.builtinKind,
    sourceTemplate: LEGACY_SOURCE_TEMPLATE,
    createdAt: now,
    updatedAt: now,
  };
}

function hasLegacyRows(storage: StorageDatabase, bookId: string): boolean {
  const row = storage.sqlite.prepare(`
    SELECT 1 AS "exists"
    WHERE EXISTS (SELECT 1 FROM "bible_character" WHERE "book_id" = ? AND "deleted_at" IS NULL)
      OR EXISTS (SELECT 1 FROM "bible_event" WHERE "book_id" = ? AND "deleted_at" IS NULL)
      OR EXISTS (SELECT 1 FROM "bible_setting" WHERE "book_id" = ? AND "deleted_at" IS NULL)
      OR EXISTS (SELECT 1 FROM "bible_chapter_summary" WHERE "book_id" = ? AND "deleted_at" IS NULL)
  `).get(bookId, bookId, bookId, bookId) as { exists: number } | undefined;
  return Boolean(row);
}

function characterToEntry(row: LegacyCharacterRow): StoryJingweiEntryRecord {
  return {
    id: legacyEntryId("character", row.id),
    bookId: row.book_id,
    sectionId: legacySectionId(row.book_id, "people"),
    title: row.name,
    contentMd: row.summary,
    tags: [row.role_type].filter(Boolean),
    aliases: parseJson<string[]>(row.aliases_json, []),
    customFields: {
      roleType: row.role_type,
      traits: parseJson<Record<string, unknown>>(row.traits_json, {}),
      firstChapter: row.first_chapter,
      lastChapter: row.last_chapter,
    },
    relatedChapterNumbers: compactNumbers([row.first_chapter, row.last_chapter]),
    relatedEntryIds: [],
    visibilityRule: normalizeVisibilityRule(row.visibility_rule_json),
    participatesInAi: true,
    tokenBudget: null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: null,
  };
}

function eventToEntry(row: LegacyEventRow): StoryJingweiEntryRecord {
  const relatedCharacterIds = parseJson<string[]>(row.related_character_ids_json, []);
  return {
    id: legacyEntryId("event", row.id),
    bookId: row.book_id,
    sectionId: legacySectionId(row.book_id, "events"),
    title: row.name,
    contentMd: row.summary,
    tags: [row.event_type].filter(Boolean),
    aliases: [],
    customFields: {
      eventType: row.event_type,
      foreshadowState: row.foreshadow_state,
    },
    relatedChapterNumbers: compactNumbers([row.chapter_start, row.chapter_end]),
    relatedEntryIds: relatedCharacterIds.map((id) => legacyEntryId("character", id)),
    visibilityRule: normalizeVisibilityRule(row.visibility_rule_json),
    participatesInAi: true,
    tokenBudget: null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: null,
  };
}

function settingToEntry(row: LegacySettingRow): StoryJingweiEntryRecord {
  const nestedRefs = parseJson<string[]>(row.nested_refs_json, []);
  return {
    id: legacyEntryId("setting", row.id),
    bookId: row.book_id,
    sectionId: legacySectionId(row.book_id, "settings"),
    title: row.name,
    contentMd: row.content,
    tags: [row.category].filter(Boolean),
    aliases: [],
    customFields: { category: row.category },
    relatedChapterNumbers: [],
    relatedEntryIds: nestedRefs.map((id) => legacyEntryId("event", id)),
    visibilityRule: normalizeVisibilityRule(row.visibility_rule_json),
    participatesInAi: true,
    tokenBudget: null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: null,
  };
}

function chapterSummaryToEntry(row: LegacyChapterSummaryRow): StoryJingweiEntryRecord {
  const keyEventIds = parseJson<string[]>(row.key_events_json, []);
  const characterIds = parseJson<string[]>(row.appearing_character_ids_json, []);
  return {
    id: legacyEntryId("chapter-summary", row.id),
    bookId: row.book_id,
    sectionId: legacySectionId(row.book_id, "chapter-summary"),
    title: row.title,
    contentMd: row.summary,
    tags: [],
    aliases: [],
    customFields: {
      wordCount: row.word_count,
      pov: row.pov,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    },
    relatedChapterNumbers: [row.chapter_number],
    relatedEntryIds: [
      ...keyEventIds.map((id) => legacyEntryId("event", id)),
      ...characterIds.map((id) => legacyEntryId("character", id)),
    ],
    visibilityRule: { type: "global", visibleAfterChapter: row.chapter_number },
    participatesInAi: true,
    tokenBudget: null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: null,
  };
}

export function createLegacyBibleJingweiAdapter(storage: StorageDatabase) {
  const sections = createStoryJingweiSectionRepository(storage);

  return {
    async ensureLegacySections(bookId: string, now = new Date()): Promise<StoryJingweiSectionRecord[]> {
      const existing = await sections.listByBook(bookId);
      if (existing.length > 0) return existing;
      if (!hasLegacyRows(storage, bookId)) return [];

      for (const [order, definition] of LEGACY_SECTION_DEFINITIONS.entries()) {
        await sections.create(createLegacySectionInput(bookId, definition, order, now));
      }
      return sections.listByBook(bookId);
    },

    async listLegacyEntries(bookId: string): Promise<StoryJingweiEntryRecord[]> {
      const characters = storage.sqlite.prepare(`
        SELECT "id", "book_id", "name", "aliases_json", "role_type", "summary", "traits_json",
          "visibility_rule_json", "first_chapter", "last_chapter", "created_at", "updated_at"
        FROM "bible_character"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "name" ASC
      `).all(bookId) as LegacyCharacterRow[];
      const events = storage.sqlite.prepare(`
        SELECT "id", "book_id", "name", "event_type", "chapter_start", "chapter_end", "summary",
          "related_character_ids_json", "visibility_rule_json", "foreshadow_state", "created_at", "updated_at"
        FROM "bible_event"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "name" ASC
      `).all(bookId) as LegacyEventRow[];
      const settings = storage.sqlite.prepare(`
        SELECT "id", "book_id", "category", "name", "content", "visibility_rule_json", "nested_refs_json",
          "created_at", "updated_at"
        FROM "bible_setting"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "name" ASC
      `).all(bookId) as LegacySettingRow[];
      const summaries = storage.sqlite.prepare(`
        SELECT "id", "book_id", "chapter_number", "title", "summary", "word_count", "key_events_json",
          "appearing_character_ids_json", "pov", "metadata_json", "created_at", "updated_at"
        FROM "bible_chapter_summary"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "chapter_number" ASC
      `).all(bookId) as LegacyChapterSummaryRow[];

      return [
        ...characters.map(characterToEntry),
        ...events.map(eventToEntry),
        ...settings.map(settingToEntry),
        ...summaries.map(chapterSummaryToEntry),
      ];
    },
  };
}
