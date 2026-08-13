import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { closeSupersededNarrativeFacts, narrativeFactSlotKey, queryCurrentNarrativeLedger } from "./ledger.js";
import { ensureNarrativeMemorySchema, getNarrativeFactById, queryNarrativeFacts } from "./storage.js";
import { upsertNarrativeFact } from "./facts.js";
import type { NarrativeFact } from "./types.js";

export { getNarrativeFactById };

/**
 * 叙事事实的作者变更操作。
 *
 * 叙事记忆是带章节区间的时序数据，作者编辑一律走「关闭旧值 + 写入新值」的
 * 替代语义，绝不在原地改 object——这样 asOfChapter 历史查询始终可回溯。
 * 作者写入的 fact 固定 sourceType: "manual"，在结算管线中享有最高优先级
 * （见 reducer 的 manual 槽位保护）。
 */

export type NarrativeFactMutationResult = Readonly<{
  ok: boolean;
  summary: string;
  error?: string;
  fact?: NarrativeFact;
  /** correct 时被关闭的旧 fact。 */
  superseded?: NarrativeFact;
}>;

export type CreateManualFactInput = Readonly<{
  bookId: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  confidence?: number;
  evidenceText?: string;
  /** 新值生效的起始章节；缺省为当前最新章节（即“从现在开始”）。 */
  validFromChapter?: number;
  /** 是否关闭同 slot 的旧 open fact；默认 true。 */
  closeSuperseded?: boolean;
}>;

export type CorrectFactInput = Readonly<{
  bookId: string;
  factId: string;
  /** 纠正后的新值；缺省字段沿用旧 fact。 */
  object?: string;
  predicate?: string;
  category?: string;
  confidence?: number;
  evidenceText?: string;
  reason?: string;
}>;

export type RetireFactInput = Readonly<{
  bookId: string;
  factId: string;
  reason?: string;
}>;

function nowIso(): string {
  return new Date().toISOString();
}

function manualFactId(bookId: string): string {
  return `manual-fact:${bookId}:${crypto.randomUUID()}`;
}

function fail(error: string, summary: string): NarrativeFactMutationResult {
  return { ok: false, error, summary };
}

/** 当前最新章节（open fact 的最大 validFromChapter / sourceChapter），用于默认生效区间。 */
function latestChapter(storage: StorageDatabase, bookId: string): number {
  const row = storage.sqlite.prepare<{ latest: number | null }>(`
    SELECT MAX(COALESCE(valid_from_chapter, source_chapter, 0)) AS latest
    FROM narrative_fact WHERE book_id = ?
  `).get(bookId);
  return row?.latest ?? 0;
}

/** 作者手动新增一条 fact。 */
export function createManualNarrativeFact(storage: StorageDatabase, input: CreateManualFactInput): NarrativeFactMutationResult {
  ensureNarrativeMemorySchema(storage);
  if (!input.subject.trim() || !input.predicate.trim() || !input.object.trim()) {
    return fail("invalid-input", "subject / predicate / object 不能为空。");
  }
  if (!input.category.trim()) {
    return fail("invalid-input", "category 不能为空。");
  }
  const now = nowIso();
  const fact: NarrativeFact = {
    id: manualFactId(input.bookId),
    bookId: input.bookId,
    subject: input.subject.trim(),
    predicate: input.predicate.trim(),
    object: input.object.trim(),
    category: input.category.trim(),
    layer: "dynamic",
    confidence: input.confidence ?? 1,
    sourceType: "manual",
    evidenceText: input.evidenceText?.trim() || undefined,
    validFromChapter: input.validFromChapter ?? latestChapter(storage, input.bookId),
    createdAt: now,
    updatedAt: now,
  };
  if (input.closeSuperseded !== false) {
    closeSupersededNarrativeFacts(storage, fact, fact.validFromChapter ?? 0);
  }
  return { ok: true, summary: `已新增叙事事实：${fact.subject} / ${fact.predicate} / ${fact.object}`, fact: upsertNarrativeFact(storage, fact) };
}

/** 作者纠正一条 fact：关闭旧值，写入 manual 新值。 */
export function correctNarrativeFact(storage: StorageDatabase, input: CorrectFactInput): NarrativeFactMutationResult {
  ensureNarrativeMemorySchema(storage);
  const existing = getNarrativeFactById(storage, input.bookId, input.factId);
  if (!existing) return fail("not-found", `找不到叙事事实 ${input.factId}。`);
  if (existing.validUntilChapter !== undefined && existing.validUntilChapter !== null) {
    return fail("already-closed", "该事实已被关闭，不能纠正历史值；如需改历史请手动新增并指定生效章节。");
  }

  const nextObject = input.object?.trim() || existing.object;
  const nextPredicate = input.predicate?.trim() || existing.predicate;
  const nextCategory = input.category?.trim() || existing.category;
  if (nextObject === existing.object && nextPredicate === existing.predicate && nextCategory === existing.category) {
    return fail("no-change", "新值与当前值一致，无需纠正。");
  }

  const closeAt = latestChapter(storage, input.bookId);
  const now = nowIso();
  // 先关闭旧值，再写新值；新值继承旧值的生效起点语义，从当前章节起生效。
  const closed: NarrativeFact = { ...existing, validUntilChapter: closeAt, updatedAt: now };
  upsertNarrativeFact(storage, closed);

  const next: NarrativeFact = {
    ...existing,
    id: manualFactId(input.bookId),
    predicate: nextPredicate,
    object: nextObject,
    category: nextCategory,
    confidence: input.confidence ?? 1,
    sourceType: "manual",
    sourceId: undefined,
    evidenceText: input.evidenceText?.trim() || existing.evidenceText,
    validFromChapter: closeAt,
    validUntilChapter: undefined,
    createdAt: now,
    updatedAt: now,
  };
  const saved = upsertNarrativeFact(storage, next);
  return {
    ok: true,
    summary: `已纠正：${next.subject} / ${next.predicate}：${existing.object} → ${next.object}`,
    fact: saved,
    superseded: closed,
  };
}

/** 作者作废一条 open fact（关闭，不进当前视图，历史保留）。 */
export function retireNarrativeFact(storage: StorageDatabase, input: RetireFactInput): NarrativeFactMutationResult {
  ensureNarrativeMemorySchema(storage);
  const existing = getNarrativeFactById(storage, input.bookId, input.factId);
  if (!existing) return fail("not-found", `找不到叙事事实 ${input.factId}。`);
  if (existing.validUntilChapter !== undefined && existing.validUntilChapter !== null) {
    return fail("already-closed", "该事实已是关闭状态。");
  }
  const closed: NarrativeFact = {
    ...existing,
    validUntilChapter: latestChapter(storage, input.bookId),
    updatedAt: nowIso(),
  };
  return { ok: true, summary: `已作废：${existing.subject} / ${existing.predicate} / ${existing.object}`, fact: upsertNarrativeFact(storage, closed) };
}

/** 某 slot 的完整变迁史（含已关闭值），按生效章节升序。 */
export function queryNarrativeFactHistory(storage: StorageDatabase, input: { bookId: string; factId: string }): NarrativeFact[] {
  ensureNarrativeMemorySchema(storage);
  const anchor = getNarrativeFactById(storage, input.bookId, input.factId);
  if (!anchor) return [];
  const slot = narrativeFactSlotKey(anchor);
  return queryNarrativeFacts(storage, { bookId: input.bookId, categories: [anchor.category], limit: 500 })
    .filter((fact) => narrativeFactSlotKey(fact) === slot)
    .sort((a, b) => (a.validFromChapter ?? a.sourceChapter ?? 0) - (b.validFromChapter ?? b.sourceChapter ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

export type EntityFactsGroup = Readonly<{
  entity: string;
  facts: readonly NarrativeFact[];
}>;

/** 按实体（subject）聚合当前 open fact，供人物状态板使用。 */
export function queryFactsByEntity(storage: StorageDatabase, input: {
  bookId: string;
  asOfChapter?: number;
  categories?: readonly string[];
  limit?: number;
}): EntityFactsGroup[] {
  const ledger = queryCurrentNarrativeLedger(storage, {
    bookId: input.bookId,
    asOfChapter: input.asOfChapter,
    categories: input.categories,
    limit: input.limit ?? 500,
  });
  const byEntity = new Map<string, NarrativeFact[]>();
  for (const fact of ledger.items) {
    const list = byEntity.get(fact.subject) ?? [];
    list.push(fact);
    byEntity.set(fact.subject, list);
  }
  return [...byEntity.entries()]
    .map(([entity, facts]) => ({
      entity,
      facts: facts.sort((a, b) => a.predicate.localeCompare(b.predicate)),
    }))
    .sort((a, b) => b.facts.length - a.facts.length || a.entity.localeCompare(b.entity));
}
