/**
 * lore.relate / lore.progress —— agent 侧经纬剧情工具。
 *
 * 目的：让 agent 写的剧情进结构化字段，而不是只沉淀在叙事记忆的自然语言里。
 *
 * - lore.relate：把角色/势力之间的关系变化写入经纬 relationships 分类
 *   （layer=dynamic、status=needs-review，作者确认后生效）。
 *   条目 title 是稳定关联键「A × B」，同一对关系的多次变化会 upsert 同一条，
 *   不会每次剧情点都新建一条。
 *
 * - lore.progress：对 dynamic 分类条目做字段级演变（如伏笔 status 推进、
 *   冲突阶段变化），每次演变写入 jingwei_progressions 台账（旧值/新值/章号/依据），
 *   可完整回溯「谁在什么时候把什么字段从什么推进到什么」。
 *
 * 单一权威源纪律：
 * - 只允许推进 defaultLayer=dynamic 的分类（outline / relationships / conflicts /
 *   foreshadowing / timeline / chapter-summaries）。canon 分类（角色人设、世界规则等）
 *   的字段变化必须走 lore.write 并注明理由，经作者确认——机器不能代写 canon。
 * - 机器写入一律 status=needs-review（lore.relate）；lore.progress 保留条目原状态，
 *   但每次演变都在 jingwei_progressions 留痕，作者可在经纬条目页查看。
 */

import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import { getCategoryDefaultLayer } from "../engine/jingwei/unified-categories.js";
import { upsertLedgerEntry } from "./jingwei-ledger-store.js";

export type LoreRelateResult = Readonly<{
  ok: boolean;
  summary: string;
  error?: string;
  entryId?: string;
  title?: string;
  category?: string;
  layer?: string;
  status?: string;
}>;

export interface LoreRelateInput {
  readonly bookId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly relationType: string;
  readonly description?: string;
  readonly chapterNumber?: number;
  readonly reason?: string;
  readonly storage?: StorageDatabase;
}

/** 稳定关联键：同一对关系永远落到同一条目。 */
function relationEntryTitle(sourceName: string, targetName: string): string {
  return `${sourceName.trim()} × ${targetName.trim()}`;
}

/**
 * lore.relate —— 写入/更新一条角色（势力）关系。
 *
 * 与 lore.write 的区别：这里写的是动态关系状态（每章可变），条目固定在
 * relationships 分类 + dynamic 层，机器写入 needs-review 待作者确认；
 * 不碰 canon 设定。
 */
export function handleLoreRelate(input: LoreRelateInput): LoreRelateResult {
  const bookId = String(input.bookId ?? "").trim();
  const sourceName = String(input.sourceName ?? "").trim();
  const targetName = String(input.targetName ?? "").trim();
  const relationType = String(input.relationType ?? "").trim();

  if (!bookId) return { ok: false, error: "missing-book-id", summary: "bookId 必填。" };
  if (!sourceName || !targetName) return { ok: false, error: "invalid-input", summary: "sourceName 与 targetName 必填。" };
  if (!relationType) return { ok: false, error: "invalid-input", summary: "relationType 必填（如 结盟 / 敌对 / 师徒）。" };

  const storage = input.storage ?? getStorageDatabase();
  const bookExists = storage.sqlite.prepare("SELECT id FROM book WHERE id = ?").get(bookId);
  if (!bookExists) return { ok: false, error: "book-not-found", summary: `bookId "${bookId}" 在数据库中不存在。` };

  const title = relationEntryTitle(sourceName, targetName);
  const description = String(input.description ?? "").trim();
  const contentMd = [
    `# ${title}`,
    "",
    `关系类型：${relationType}`,
    ...(description ? ["", description] : []),
    ...(typeof input.chapterNumber === "number" ? ["", `最近变化章节：第 ${input.chapterNumber} 章`] : []),
  ].join("\n");

  const entry = upsertLedgerEntry(storage, {
    bookId,
    category: "relationships",
    title,
    contentMd,
    fields: {
      sourceName,
      targetName,
      relationType,
      description,
      ...(typeof input.chapterNumber === "number" ? { lastChangedChapter: input.chapterNumber } : {}),
    },
    status: "needs-review",
    reason: input.reason?.trim() || "lore.relate 关系写入",
    changedBy: "lore.relate",
  });

  return {
    ok: true,
    summary: `已写入关系「${title}」（${relationType}），待作者在经纬确认。`,
    entryId: entry.id,
    title: entry.title,
    category: "relationships",
    layer: "dynamic",
    status: "needs-review",
  };
}

export interface LoreProgressInput {
  readonly bookId: string;
  readonly entryId?: string;
  readonly title?: string;
  readonly fieldKey: string;
  readonly oldValue?: string;
  readonly newValue: string;
  readonly chapterNumber?: number;
  readonly description?: string;
  readonly reason: string;
  readonly storage?: StorageDatabase;
}

export type LoreProgressResult = Readonly<{
  ok: boolean;
  summary: string;
  error?: string;
  entryId?: string;
  fieldKey?: string;
  oldValue?: string;
  newValue?: string;
  progressionId?: string;
}>;

function ensureProgressionsSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "jingwei_progressions" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "book_id" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "field_key" TEXT NOT NULL,
      "old_value" TEXT,
      "new_value" TEXT,
      "chapter_number" INTEGER,
      "description" TEXT,
      "created_at" TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jingwei_progressions_book_entry ON "jingwei_progressions" ("book_id", "entry_id");
  `);
}

/**
 * lore.progress —— 对 dynamic 分类条目做字段级演变。
 *
 * 只允许推进 defaultLayer=dynamic 的分类；canon/reference 分类拒绝并指路 lore.write。
 * 每次演变写入 jingwei_progressions 台账，字段更新保留条目原 status。
 */
export function handleLoreProgress(input: LoreProgressInput): LoreProgressResult {
  const bookId = String(input.bookId ?? "").trim();
  const fieldKey = String(input.fieldKey ?? "").trim();
  const newValue = String(input.newValue ?? "").trim();
  const reason = String(input.reason ?? "").trim();

  if (!bookId) return { ok: false, error: "missing-book-id", summary: "bookId 必填。" };
  if (!fieldKey || !newValue) return { ok: false, error: "invalid-input", summary: "fieldKey 与 newValue 必填。" };
  if (!reason) return { ok: false, error: "invalid-input", summary: "reason 必填（推进依据）。" };
  if (!input.entryId && !input.title) return { ok: false, error: "invalid-input", summary: "entryId 与 title 至少提供一个。" };

  const storage = input.storage ?? getStorageDatabase();
  ensureProgressionsSchema(storage);

  type EntryRow = { id: string; title: string; category: string; layer: string; fieldsJson: string | null };
  const entry = input.entryId
    ? storage.sqlite.prepare(`
        SELECT id, title, category, layer, fields_json AS fieldsJson
        FROM story_jingwei_entry
        WHERE book_id = ? AND id = ? AND deleted_at IS NULL
      `).get(bookId, input.entryId) as EntryRow | undefined
    : storage.sqlite.prepare(`
        SELECT id, title, category, layer, fields_json AS fieldsJson
        FROM story_jingwei_entry
        WHERE book_id = ? AND title = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC LIMIT 1
      `).get(bookId, String(input.title ?? "").trim()) as EntryRow | undefined;

  if (!entry) {
    return { ok: false, error: "entry-not-found", summary: `经纬条目不存在：${input.entryId ?? input.title ?? "(空)"}。` };
  }

  const category = String(entry.category ?? "");
  const defaultLayer = getCategoryDefaultLayer(category);
  if (defaultLayer !== "dynamic") {
    return {
      ok: false,
      error: "canon-entry-protected",
      summary: [
        `条目「${String(entry.title)}」属于 ${category} 分类（${defaultLayer} 层），不允许机器直接推进字段。`,
        "canon/reference 设定的变化必须走 lore.write 并注明 reason/source，经作者确认后修改。",
      ].join(""),
    };
  }

  let fields: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(entry.fieldsJson ?? "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
  } catch {
    fields = {};
  }

  const oldValue = input.oldValue?.trim()
    ?? (typeof fields[fieldKey] === "string" ? fields[fieldKey] as string : String(fields[fieldKey] ?? ""));
  const nextFields = { ...fields, [fieldKey]: newValue };
  const now = new Date().toISOString();
  const progressionId = crypto.randomUUID();

  const write = storage.sqlite.transaction(() => {
    storage.sqlite.prepare(`
      UPDATE story_jingwei_entry
      SET fields_json = ?, updated_at = ?
      WHERE id = ? AND book_id = ?
    `).run(JSON.stringify(nextFields), Date.now(), entry.id, bookId);
    storage.sqlite.prepare(`
      INSERT INTO "jingwei_progressions" (
        "id", "book_id", "entry_id", "field_key", "old_value", "new_value", "chapter_number", "description", "created_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      progressionId,
      bookId,
      String(entry.id),
      fieldKey,
      oldValue,
      newValue,
      typeof input.chapterNumber === "number" ? input.chapterNumber : null,
      input.description?.trim() || null,
      now,
    );
  });
  write();

  return {
    ok: true,
    summary: `已推进「${String(entry.title)}」的 ${fieldKey}：${oldValue || "(空)"} → ${newValue}（第 ${input.chapterNumber ?? "—"} 章）。`,
    entryId: String(entry.id),
    fieldKey,
    oldValue,
    newValue,
    progressionId,
  };
}
