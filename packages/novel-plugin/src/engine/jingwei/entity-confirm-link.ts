/**
 * 人物条目确认后接上实体图谱。
 *
 * 待确认的人物条目不进实体字典（见 narrative-memory/entity-dictionary 的 loadEntityRows），
 * 因此作者确认之前，历史出场与事件参与者都挂不到它身上。作者把人物条目从待确认改为其他状态
 * （或反过来）时，这里依次：
 * 1. 用最新字典把出场名单里 entry_id 仍为空的行补挂（只补空的，不改写已有关联）；
 * 2. 调已有的事件身份链回填（backfillNarrativeEventEntityIds）；
 * 3. 调已有的实体索引整本重建（rebuildNarrativeEntityIndex），参与者、关系、状态流水随之重算。
 *
 * 只调用已有的回填与重建函数，不改实体索引的推导逻辑。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { buildEntityDictionary, resolveEntity } from "../narrative-memory/entity-dictionary.js";
import { backfillNarrativeEventEntityIds } from "../narrative-memory/entity-id-backfill.js";
import { rebuildNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { normalizeCategory } from "./unified-categories.js";

export interface EntityConfirmLinkResult {
  readonly ok: boolean;
  readonly mentionsLinked: number;
  readonly eventSubjectsLinked: number;
  readonly eventObjectsLinked: number;
  readonly entities: number;
  readonly participants: number;
  readonly relations: number;
  /** 失败或跳过时的说明（不影响条目本身的保存）。 */
  readonly explanation?: string;
}

/** 人物条目的「待确认」身份变了（确认 / 撤回确认），实体字典随之变化，需要接图谱。 */
export function entityDictionaryMembershipChanged(
  before: { readonly category: string; readonly status: string | null | undefined } | null,
  after: { readonly category: string; readonly status: string | null | undefined } | null,
): boolean {
  if (!before || !after) return false;
  const isCharacter = (category: string) => normalizeCategory(category).category === "characters";
  const excluded = (entry: { readonly category: string; readonly status: string | null | undefined }) =>
    isCharacter(entry.category) && entry.status === "needs-review";
  if (!isCharacter(before.category) && !isCharacter(after.category)) return false;
  return excluded(before) !== excluded(after);
}

function tableExists(storage: StorageDatabase, table: string): boolean {
  return Boolean(storage.sqlite.prepare<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

/** 出场名单里 entry_id 为空的行，按最新字典补挂；伏笔条目不挂（与出场采集同口径）。 */
function backfillMentionEntryIds(storage: StorageDatabase, bookId: string): number {
  if (!tableExists(storage, "narrative_chapter_mention")) return 0;
  const dictionary = buildEntityDictionary(storage, bookId);
  if (dictionary.entries.length === 0) return 0;
  const rows = storage.sqlite.prepare<{ chapter_number: number; entity_name: string }>(`
    SELECT chapter_number, entity_name FROM narrative_chapter_mention
    WHERE book_id = ? AND entry_id IS NULL
  `).all(bookId);
  const update = storage.sqlite.prepare(`
    UPDATE narrative_chapter_mention SET entry_id = ?
    WHERE book_id = ? AND chapter_number = ? AND entity_name = ? AND entry_id IS NULL
  `);
  let linked = 0;
  for (const row of rows) {
    const hit = resolveEntity(dictionary, row.entity_name);
    if (!hit || hit.entry.category === "foreshadowing") continue;
    linked += Number(update.run(hit.entry.entryId, bookId, row.chapter_number, row.entity_name).changes);
  }
  return linked;
}

/** 补出场与事件身份链，再整本重建实体索引。失败不抛，结果里带说明。 */
export function linkConfirmedEntityEntries(storage: StorageDatabase, bookId: string): EntityConfirmLinkResult {
  try {
    const mentionsLinked = storage.sqlite.transaction(() => backfillMentionEntryIds(storage, bookId))();
    const events = tableExists(storage, "narrative_event")
      ? backfillNarrativeEventEntityIds(storage, bookId)
      : { subjectBackfilled: 0, objectBackfilled: 0 };
    const rebuilt = rebuildNarrativeEntityIndex(storage, bookId);
    if (!rebuilt.ok) {
      return {
        ok: false, mentionsLinked, eventSubjectsLinked: events.subjectBackfilled, eventObjectsLinked: events.objectBackfilled,
        entities: 0, participants: 0, relations: 0, explanation: rebuilt.explanation,
      };
    }
    return {
      ok: true,
      mentionsLinked,
      eventSubjectsLinked: events.subjectBackfilled,
      eventObjectsLinked: events.objectBackfilled,
      entities: rebuilt.entities,
      participants: rebuilt.participants,
      relations: rebuilt.relations,
    };
  } catch (error) {
    return {
      ok: false, mentionsLinked: 0, eventSubjectsLinked: 0, eventObjectsLinked: 0, entities: 0, participants: 0, relations: 0,
      explanation: `条目已保存，但实体图谱没能同步（${error instanceof Error ? error.message : String(error)}）；可在「章后事实」里手动重建实体索引。`,
    };
  }
}
