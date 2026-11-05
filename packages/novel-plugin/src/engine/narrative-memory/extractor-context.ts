/**
 * 章后结算抽取的台账上下文：按本章相关度挑 open fact，而不是只取最近更新的若干条。
 *
 * 长书的 open fact 成千上万，旧做法取「最近更新的 120 条」，本章出场的老角色只要最近没动过就看不到，
 * 抽取器便不知道他已有「所在 / 境界」，只能另起一个说法，台账越记越碎。这里：
 *   1. 找本章相关实体：实体字典扫正文 + 本章已记的出场（重结算时有）+ 台账里主体名直接出现在正文中的；
 *   2. 取这些实体（作主体或对象）的当前值，主体命中的排前；
 *   3. 再补一小段最近更新的尾巴，兜住字典与正文都没认出的新近状态；
 *   4. 总量硬上限。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { CurrentLedgerFactSnapshot } from "./chapter-event-extractor.js";
import { scanDictionaryMentions } from "./chapter-mention.js";
import type { EntityDictionary } from "./entity-dictionary.js";
import { queryCurrentNarrativeLedger } from "./ledger.js";
import { normalizeSlotPart } from "./slot-key.js";
import { canonicalFactPredicate } from "./state-predicate.js";
import { ensureNarrativeMemorySchema, queryChapterMentions, queryNarrativeFactSlotHeads } from "./storage.js";
import type { NarrativeFact } from "./types.js";

export const DEFAULT_EXTRACTOR_LEDGER_LIMIT = 120;
export const DEFAULT_EXTRACTOR_LEDGER_RECENT_TAIL = 20;
/** 主体名至少两个字才拿去正文里找，避免单字名误命中。 */
const MIN_SUBJECT_SCAN_LENGTH = 2;

export interface ChapterRelevantEntities {
  /** 本章相关实体的全部称呼（canonical 名 + 字典别名 + 正文直接出现的主体名）。 */
  readonly names: readonly string[];
  readonly entryIds: readonly string[];
}

/** 本章相关实体：字典扫正文 + 已记出场 + 台账主体名出现在正文里。 */
export function collectChapterRelevantEntities(
  storage: StorageDatabase,
  input: Readonly<{ bookId: string; chapterNumber: number; content: string; entityDictionary?: EntityDictionary }>,
): ChapterRelevantEntities {
  ensureNarrativeMemorySchema(storage);
  const names = new Set<string>();
  const entryIds = new Set<string>();
  const addEntry = (entryId: string | undefined) => {
    if (!entryId) return;
    entryIds.add(entryId);
    const entry = input.entityDictionary?.entries.find((item) => item.entryId === entryId);
    if (!entry) return;
    names.add(entry.canonicalName);
    for (const key of entry.lookupKeys) if (key.trim()) names.add(key.trim());
  };

  for (const mention of scanDictionaryMentions(input.content, input.entityDictionary)) {
    names.add(mention.name);
    addEntry(mention.entryId);
  }
  for (const mention of queryChapterMentions(storage, input.bookId, input.chapterNumber)) {
    names.add(mention.name);
    addEntry(mention.entryId);
  }
  // 没进经纬的角色（或书还没有实体条目）：台账主体名直接出现在正文里也算。
  const subjects = storage.sqlite.prepare<{ subject: string }>(`
    SELECT DISTINCT subject FROM narrative_fact
    WHERE book_id = ? AND valid_until_chapter IS NULL AND category <> 'hook'
  `).all(input.bookId);
  for (const { subject } of subjects) {
    const name = subject.trim();
    if (name.length >= MIN_SUBJECT_SCAN_LENGTH && input.content.includes(name)) names.add(name);
  }
  return { names: [...names], entryIds: [...entryIds] };
}

function byRecency(a: NarrativeFact, b: NarrativeFact): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

/** 旧数据的谓词可能还是「本章所在位置」这类写法：给抽取器看规范写法，让它沿用同一槽位。 */
function toSnapshot(fact: NarrativeFact): CurrentLedgerFactSnapshot {
  return { category: fact.category, subject: fact.subject, predicate: canonicalFactPredicate(fact), object: fact.object };
}

/**
 * 抽取 prompt 用的台账快照：本章相关实体的当前值优先，最近更新的尾巴兜底，总量不超过 limit。
 * 纯读，不写库。
 */
export function selectExtractorLedgerContext(
  storage: StorageDatabase,
  input: Readonly<{
    bookId: string;
    chapterNumber: number;
    content: string;
    entityDictionary?: EntityDictionary;
    limit?: number;
    recentTail?: number;
  }>,
): CurrentLedgerFactSnapshot[] {
  ensureNarrativeMemorySchema(storage);
  const limit = Math.max(1, input.limit ?? DEFAULT_EXTRACTOR_LEDGER_LIMIT);
  const tail = Math.min(limit, Math.max(0, input.recentTail ?? DEFAULT_EXTRACTOR_LEDGER_RECENT_TAIL));
  const relevant = collectChapterRelevantEntities(storage, input);

  const byId = new Map<string, NarrativeFact>();
  if (relevant.names.length > 0) {
    for (const fact of queryNarrativeFactSlotHeads(storage, { bookId: input.bookId, entities: relevant.names })) byId.set(fact.id, fact);
  }
  if (relevant.entryIds.length > 0) {
    for (const fact of queryNarrativeFactSlotHeads(storage, { bookId: input.bookId, entryIds: relevant.entryIds })) byId.set(fact.id, fact);
  }
  const nameKeys = new Set(relevant.names.map(normalizeSlotPart));
  const entryIds = new Set(relevant.entryIds);
  const subjectHit = (fact: NarrativeFact) =>
    nameKeys.has(normalizeSlotPart(fact.subject)) || (fact.subjectEntryId !== undefined && entryIds.has(fact.subjectEntryId));
  const matched = [...byId.values()].sort((a, b) => Number(subjectHit(b)) - Number(subjectHit(a)) || byRecency(a, b));

  const recent = queryCurrentNarrativeLedger(storage, { bookId: input.bookId, limit: Math.min(500, limit + tail) }).items;
  const recentTail = recent.filter((fact) => !byId.has(fact.id)).slice(0, tail);

  const head = matched.slice(0, Math.max(0, limit - recentTail.length));
  const picked = [...head, ...recentTail];
  // 相关实体不够填满时，用更多最近值补到上限（与旧行为一致）。
  if (picked.length < limit) {
    const pickedIds = new Set(picked.map((fact) => fact.id));
    for (const fact of recent) {
      if (picked.length >= limit) break;
      if (!pickedIds.has(fact.id)) picked.push(fact);
    }
  }
  return picked.slice(0, limit).map(toSnapshot);
}
