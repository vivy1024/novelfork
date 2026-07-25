/**
 * 经纬结构性账本存储 —— 卷纲 / 伏笔 / 章摘要的唯一权威源。
 *
 * 这三类对象此前散落在 story/*.json 与 md 文件里，导致同一事实有多个权威源。
 * 现在统一以经纬条目（story_jingwei_entry）为权威：
 *   - 结构化数据存 fields_json
 *   - contentMd 作作者可读正文
 *   - story/*.md 降级为导出物，不再被读取
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

export function ensureJingweiLedgerSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_section (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      "order" INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      show_in_sidebar INTEGER DEFAULT 1,
      participates_in_ai INTEGER DEFAULT 1,
      default_visibility TEXT DEFAULT 'tracked',
      fields_json TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(book_id, key)
    );

    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      layer TEXT NOT NULL DEFAULT 'canon',
      status TEXT NOT NULL DEFAULT 'confirmed',
      content_md TEXT,
      fields_json TEXT,
      sort_order INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );
  `);
}

/**
 * 账本可写入的经纬分类。
 * outline / foreshadowing / chapter-summaries 是结构性账本；
 * 其余为拆书产物落地的静态设定分类（一律 needs-review，待作者确认）。
 */
export type LedgerKind =
  | "outline"
  | "foreshadowing"
  | "chapter-summaries"
  | "characters"
  | "relationships"
  | "world-model"
  | "locations"
  | "factions"
  | "power-system"
  | "props"
  | "rules";

/** 账本条目：结构化字段 + 可读正文。 */
export interface LedgerEntry {
  readonly id: string;
  readonly title: string;
  readonly contentMd: string;
  readonly fields: Record<string, unknown>;
  readonly layer: string;
  readonly status: string;
  readonly updatedAt: number;
}

export interface LedgerWriteInput {
  readonly bookId: string;
  readonly category: LedgerKind;
  readonly title: string;
  readonly contentMd: string;
  readonly fields: Record<string, unknown>;
  /** 默认 confirmed；机器抽取的草案传 needs-review。 */
  readonly status?: "draft" | "confirmed" | "needs-review";
  readonly now?: () => Date;
}

const CATEGORY_NAMES: Record<LedgerKind, string> = {
  outline: "卷纲/大纲",
  foreshadowing: "伏笔",
  "chapter-summaries": "章节摘要",
  characters: "角色",
  relationships: "关系",
  "world-model": "世界模型",
  locations: "地点",
  factions: "势力",
  "power-system": "能力体系",
  props: "道具资源",
  rules: "写作规则",
};

function parseFields(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function ensureSection(storage: StorageDatabase, bookId: string, category: LedgerKind): string {
  ensureJingweiLedgerSchema(storage);
  const existing = storage.sqlite.prepare(
    `SELECT id FROM story_jingwei_section WHERE book_id = ? AND key = ?`,
  ).get(bookId, category) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = Date.now();
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_section (
      id, book_id, key, name, description, "order", enabled, show_in_sidebar,
      participates_in_ai, default_visibility, fields_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', 0, 1, 1, 1, 'tracked', '[]', ?, ?)
  `).run(id, bookId, category, CATEGORY_NAMES[category] ?? category, now, now);
  return id;
}

/** 账本条目所在分区是否参与 AI（section 默认 enabled=0 时仍允许条目被工具读取）。 */
function ledgerSummary(title: string, fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).slice(0, 4).join(", ");
  return keys ? `${title}（${keys}）` : title;
}

/** 读取某分类下的全部账本条目（未删除）。 */
export function listLedgerEntries(
  storage: StorageDatabase,
  bookId: string,
  category: LedgerKind,
): LedgerEntry[] {
  try {
    const rows = storage.sqlite.prepare(`
      SELECT id, title, content_md AS contentMd, fields_json AS fieldsJson,
             layer, status, updated_at AS updatedAt
      FROM story_jingwei_entry
      WHERE book_id = ? AND category = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, updated_at DESC
    `).all(bookId, category) as Array<{
      id: string;
      title: string;
      contentMd: string | null;
      fieldsJson: string | null;
      layer: string | null;
      status: string | null;
      updatedAt: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      contentMd: row.contentMd ?? "",
      fields: parseFields(row.fieldsJson),
      layer: row.layer ?? "dynamic",
      status: row.status ?? "confirmed",
      updatedAt: row.updatedAt ?? 0,
    }));
  } catch {
    return [];
  }
}

/** 读取账本单条（按 title 精确匹配，账本条目 title 具唯一语义）。 */
export function findLedgerEntryByTitle(
  storage: StorageDatabase,
  bookId: string,
  category: LedgerKind,
  title: string,
): LedgerEntry | null {
  return listLedgerEntries(storage, bookId, category).find((entry) => entry.title === title) ?? null;
}

/**
 * upsert 账本条目：同 title 更新，否则插入。
 * 账本分类固定 layer=dynamic（分类表态已声明 allowCanon=false）。
 */
export function upsertLedgerEntry(
  storage: StorageDatabase,
  input: LedgerWriteInput,
): LedgerEntry {
  const { bookId, category, title } = input;
  const sectionId = ensureSection(storage, bookId, category);
  const now = (input.now?.() ?? new Date()).getTime();
  const status = input.status ?? "confirmed";
  const fieldsJson = JSON.stringify(input.fields ?? {});
  const existing = findLedgerEntryByTitle(storage, bookId, category, title);

  if (existing) {
    storage.sqlite.prepare(`
      UPDATE story_jingwei_entry
      SET content_md = ?, fields_json = ?, status = ?, layer = 'dynamic', updated_at = ?
      WHERE id = ? AND book_id = ?
    `).run(input.contentMd, fieldsJson, status, now, existing.id, bookId);
    return { ...existing, contentMd: input.contentMd, fields: input.fields, status, updatedAt: now };
  }

  const id = crypto.randomUUID();
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_entry (
      id, book_id, section_id, category, title, content_md, summary_md,
      tags_json, aliases_json, custom_fields_json, fields_json,
      related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json,
      participates_in_ai, token_budget, layer, priority_tier, importance,
      status, lifecycle, sort_order, created_at, updated_at, deleted_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      '[]', '[]', '{}', ?,
      '[]', '[]', '{"type":"tracked"}',
      1, NULL, 'dynamic', 'auto', 40,
      ?, 'active', 0, ?, ?, NULL
    )
  `).run(
    id,
    bookId,
    sectionId,
    category,
    title,
    input.contentMd,
    ledgerSummary(title, input.fields ?? {}),
    fieldsJson,
    status,
    now,
    now,
  );

  return {
    id,
    title,
    contentMd: input.contentMd,
    fields: input.fields,
    layer: "dynamic",
    status,
    updatedAt: now,
  };
}

/** 软删除账本条目。 */
export function softDeleteLedgerEntry(
  storage: StorageDatabase,
  bookId: string,
  entryId: string,
  now = Date.now(),
): boolean {
  const result = storage.sqlite.prepare(`
    UPDATE story_jingwei_entry
    SET deleted_at = ?, lifecycle = 'archived', updated_at = ?
    WHERE id = ? AND book_id = ? AND deleted_at IS NULL
  `).run(now, now, entryId, bookId);
  return result.changes > 0;
}
