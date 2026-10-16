/**
 * 章后结算发现的新伏笔 → 经纬伏笔草稿条目。
 *
 * 伏笔的唯一权威源是经纬 foreshadowing 条目。正文里新埋的伏笔（hook_planted 事件）若在经纬里
 * 找不到对应条目，就只停留在事件流里，伏笔看板、债务判定与写前注入都看不见它。这里把它写成一条
 * 待审草稿：layer=dynamic、status=needs-review，带来源章节与正文证据。作者确认前它只是待审条目，
 * 不参与 AI 注入，也不进伏笔阶段派生（见 foreshadow-states）。
 *
 * 幂等：按经纬条目身份键（entry_key）与标题去重，连已删除的条目也算——作者删掉的草稿，
 * 重结算同一章不会再冒出来。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "../engine/jingwei/category-compat.js";
import { generateEntryKey, normalizeText } from "../engine/jingwei/entry-identity.js";
import { recordLedgerConflict } from "../engine/jingwei/ledger-conflict-store.js";
import { resolveEntity, stripParentheticalSuffix, type EntityDictionary } from "../engine/narrative-memory/entity-dictionary.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";
import { upsertLedgerEntry } from "./jingwei-ledger-store.js";

export interface StagedForeshadowDraft {
  readonly entryId: string;
  readonly title: string;
  readonly eventId: string;
  readonly chapterNumber: number;
}

interface ForeshadowRow {
  id: string;
  title: string;
  entryKey: string | null;
  deletedAt: number | null;
  version?: number | null;
}

function loadAllForeshadowRows(storage: StorageDatabase, bookId: string): ForeshadowRow[] | null {
  const categories = getJingweiCategoryAliases("foreshadowing");
  const table = storage.sqlite.prepare<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_jingwei_entry'",
  ).get();
  if (!table) return null;
  try {
    return storage.sqlite.prepare<ForeshadowRow>(`
      SELECT id, title, entry_key AS entryKey, deleted_at AS deletedAt, COALESCE(version, 1) AS version
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)})
    `).all(bookId, ...categories);
  } catch {
    // 旧库没有 entry_key/version 列时退回只按标题去重
    return storage.sqlite.prepare<Omit<ForeshadowRow, "entryKey" | "version">>(`
      SELECT id, title, deleted_at AS deletedAt
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)})
    `).all(bookId, ...categories).map((row) => ({ ...row, entryKey: null, version: 1 }));
  }
}

function identityKeys(title: string): string[] {
  const trimmed = title.trim();
  const stripped = stripParentheticalSuffix(trimmed);
  return [...new Set([
    generateEntryKey("foreshadowing", trimmed),
    generateEntryKey("foreshadowing", stripped),
    `title:${normalizeText(trimmed)}`,
    `title:${normalizeText(stripped)}`,
  ])];
}

/**
 * 为本次结算里没有对应经纬条目的新埋伏笔写待审草稿，返回新建的草稿。
 * 已驳回的事件不建草稿；与现有（含已删除）伏笔条目同名或同身份键的跳过。
 */
export function stageForeshadowDrafts(
  storage: StorageDatabase,
  bookId: string,
  events: readonly NarrativeEvent[],
  dictionary?: EntityDictionary,
): StagedForeshadowDraft[] {
  const planted = events.filter((event) => event.eventType === "hook_planted" && event.status !== "rejected" && event.subject.trim());
  if (planted.length === 0) return [];

  const rows = loadAllForeshadowRows(storage, bookId);
  // 经纬表还没建好（旧书首次结算）时无处可写，跳过
  if (!rows) return [];
  // 本函数在结算事务里跑，读到的快照就是「结算开始时的版本」：
  // 只要作者在这之后动过同名条目，下面的 expectedVersion 就会把它判成冲突（T-24）。
  const liveIds = new Map(rows.filter((row) => row.deletedAt === null).map((row) => [row.id, row.version ?? 1]));
  const knownKeys = new Set<string>();
  for (const row of rows) {
    if (row.entryKey) knownKeys.add(row.entryKey);
    for (const key of identityKeys(row.title)) knownKeys.add(key);
  }

  const staged: StagedForeshadowDraft[] = [];
  for (const event of planted) {
    const title = event.subject.trim().slice(0, 200);
    if (event.subjectEntryId && liveIds.has(event.subjectEntryId)) continue;
    const hit = resolveEntity(dictionary, title);
    if (hit && liveIds.has(hit.entry.entryId)) continue;
    const keys = identityKeys(title);
    if (keys.some((key) => knownKeys.has(key))) continue;

    const evidence = event.evidenceText.trim().slice(0, 400);
    const description = event.object.trim().slice(0, 400);
    // 结算开始时这条还不存在（expectedVersion=0）：若作者在结算跑的过程中抢先建了同名条目，
    // 结算这一版不覆盖作者那一条，冲突交待处理。
    const entry = upsertLedgerEntry(storage, {
      bookId,
      category: "foreshadowing",
      title,
      contentMd: [
        description || title,
        evidence ? `\n正文依据（第 ${event.chapterNumber} 章）：${evidence}` : "",
        "\n章后结算从正文里发现的新伏笔，待作者确认；确认前不参与写作注入。",
      ].filter(Boolean).join("\n"),
      fields: {
        status: "已埋设",
        plantedChapter: event.chapterNumber,
        ...(description ? { description } : {}),
      },
      status: "needs-review",
      reason: `第${event.chapterNumber}章结算发现新埋伏笔`,
      changedBy: "chapter-settlement",
      entryKey: keys[0]!,
      sourceRefs: [{ chapterNumber: event.chapterNumber, excerpt: evidence || description || title }],
      expectedVersion: 0,
      onStaleWrite: (conflict) => { recordLedgerConflict(storage, bookId, conflict); },
    });
    for (const key of keys) knownKeys.add(key);
    liveIds.set(entry.id, entry.version);
    // 事件挂上草稿条目，作者确认后阶段派生可直接按 id 关联
    storage.sqlite.prepare(`
      UPDATE narrative_event SET subject_entry_id = ?
      WHERE id = ? AND book_id = ? AND subject_entry_id IS NULL
    `).run(entry.id, event.id, bookId);
    staged.push({ entryId: entry.id, title, eventId: event.id, chapterNumber: event.chapterNumber });
  }
  return staged;
}
