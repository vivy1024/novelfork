import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { estimateTokens } from "../jingwei/context/token-budget.js";
import { queryCurrentNarrativeLedger } from "./ledger.js";
import { ensureNarrativeMemorySchema, type QueryNarrativeFactsInput } from "./storage.js";
import { NarrativeContextCardSchema, NarrativeFactSchema, type NarrativeContextCard, type NarrativeFact } from "./types.js";

export interface SearchFactsByEntitiesInput extends QueryNarrativeFactsInput {
  readonly entities: readonly string[];
}

export interface ExpandFactsOneHopInput {
  readonly bookId: string;
  readonly entities: readonly string[];
  readonly currentChapter?: number;
  readonly categories?: readonly string[];
  readonly predicates?: readonly string[];
  readonly layer?: NarrativeFact["layer"];
  readonly maxPerEntity?: number;
  readonly limit?: number;
}

function tupleKey(fact: NarrativeFact): string {
  return `${fact.bookId}\u0000${fact.subject}\u0000${fact.predicate}\u0000${fact.object}\u0000${fact.category}\u0000${fact.layer}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compareFact(a: NarrativeFact, b: NarrativeFact): number {
  return b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function dedupeFacts(facts: readonly NarrativeFact[]): NarrativeFact[] {
  const byTuple = new Map<string, NarrativeFact>();
  for (const fact of facts) {
    const key = tupleKey(fact);
    const current = byTuple.get(key);
    if (!current || compareFact(fact, current) < 0) {
      byTuple.set(key, fact);
    }
  }
  return [...byTuple.values()].sort(compareFact);
}

function insertOrUpdateFact(storage: StorageDatabase, fact: NarrativeFact): void {
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (
      id,
      book_id,
      subject,
      predicate,
      object,
      category,
      layer,
      confidence,
      source_type,
      source_id,
      source_chapter,
      evidence_text,
      valid_from_chapter,
      valid_until_chapter,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      book_id = excluded.book_id,
      subject = excluded.subject,
      predicate = excluded.predicate,
      object = excluded.object,
      category = excluded.category,
      layer = excluded.layer,
      confidence = excluded.confidence,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      source_chapter = excluded.source_chapter,
      evidence_text = excluded.evidence_text,
      valid_from_chapter = excluded.valid_from_chapter,
      valid_until_chapter = excluded.valid_until_chapter,
      updated_at = excluded.updated_at
  `).run(
    fact.id,
    fact.bookId,
    fact.subject,
    fact.predicate,
    fact.object,
    fact.category,
    fact.layer,
    fact.confidence,
    fact.sourceType,
    fact.sourceId ?? null,
    fact.sourceChapter ?? null,
    fact.evidenceText ?? null,
    fact.validFromChapter ?? null,
    fact.validUntilChapter ?? null,
    fact.createdAt,
    fact.updatedAt,
  );
}

export function upsertNarrativeFact(storage: StorageDatabase, fact: NarrativeFact): NarrativeFact {
  ensureNarrativeMemorySchema(storage);
  const parsed = NarrativeFactSchema.parse(fact);
  insertOrUpdateFact(storage, parsed);
  return parsed;
}

/**
 * Resolve facts from the same current-state ledger exposed by the story-status
 * panel and `/current`. For a pre-write `currentChapter`, the visible state is
 * the end of the preceding chapter, matching the existing temporal semantics.
 */
export function searchFactsByEntities(storage: StorageDatabase, input: SearchFactsByEntitiesInput): NarrativeFact[] {
  const entities = uniqueStrings(input.entities);
  if (entities.length === 0) return [];

  const asOfChapter = input.currentChapter === undefined
    ? undefined
    : Math.max(0, input.currentChapter - 1);
  const ledger = queryCurrentNarrativeLedger(storage, {
    bookId: input.bookId,
    asOfChapter,
    categories: input.categories,
    // Filter after slot collapse so unrelated high-confidence facts cannot
    // crowd out relevant entity facts before the ledger chooses its truth.
    limit: 500,
  });
  const entitySet = new Set(entities);
  const facts = ledger.items.filter((fact) => (
    (entitySet.has(fact.subject) || entitySet.has(fact.object))
    && (!input.predicates?.length || input.predicates.includes(fact.predicate))
    && (!input.layer || input.layer === fact.layer)
  ));
  return dedupeFacts(facts).slice(0, input.limit ?? 100);
}

export function expandFactsOneHop(storage: StorageDatabase, input: ExpandFactsOneHopInput): NarrativeFact[] {
  const entities = uniqueStrings(input.entities);
  if (entities.length === 0) return [];

  const limit = Math.max(1, input.limit ?? 50);
  const maxPerEntity = Math.max(1, input.maxPerEntity ?? 3);
  const direct = searchFactsByEntities(storage, {
    bookId: input.bookId,
    entities,
    categories: input.categories,
    predicates: input.predicates,
    layer: input.layer,
    currentChapter: input.currentChapter,
    limit,
  });

  const result: NarrativeFact[] = [];
  const seenKeys = new Set<string>();
  const addFact = (fact: NarrativeFact): boolean => {
    const key = tupleKey(fact);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    result.push(fact);
    return result.length >= limit;
  };

  for (const fact of direct) {
    if (addFact(fact)) return result;
  }

  const seedEntities = uniqueStrings(direct.flatMap((fact) => [fact.subject, fact.object]).filter((entity) => !entities.includes(entity)));
  for (const seed of seedEntities) {
    const related = searchFactsByEntities(storage, {
      bookId: input.bookId,
      entities: [seed],
      categories: input.categories,
      predicates: input.predicates,
      layer: input.layer,
      currentChapter: input.currentChapter,
      limit: maxPerEntity + direct.length,
    }).filter((fact) => !direct.some((directFact) => tupleKey(directFact) === tupleKey(fact)));

    let addedForSeed = 0;
    for (const fact of related) {
      if (addedForSeed >= maxPerEntity) break;
      const before = result.length;
      if (addFact(fact)) return result;
      if (result.length > before) addedForSeed += 1;
    }
  }

  return result;
}

export function factToContextCard(fact: NarrativeFact, reason?: string): NarrativeContextCard {
  const parsed = NarrativeFactSchema.parse(fact);
  const tuple = `${parsed.subject} ${parsed.predicate} ${parsed.object}`;
  const content = [
    tuple,
    `分类：${parsed.category}`,
    `层级：${parsed.layer}`,
    `置信度 confidence：${parsed.confidence}`,
    parsed.validFromChapter !== undefined || parsed.validUntilChapter !== undefined ? `有效章节：${parsed.validFromChapter ?? "?"}-${parsed.validUntilChapter ?? "ongoing"}` : "",
    parsed.sourceChapter !== undefined ? `来源章节：${parsed.sourceChapter}` : "",
    parsed.evidenceText ? `证据：${parsed.evidenceText}` : "",
  ].filter(Boolean).join("\n");

  return NarrativeContextCardSchema.parse({
    id: `fact:${parsed.id}`,
    bookId: parsed.bookId,
    sourceType: "fact",
    sourceId: parsed.id,
    channel: "facts",
    title: tuple,
    content,
    summary: tuple,
    brief: tuple,
    tags: ["fact", parsed.category, parsed.layer],
    entities: uniqueStrings([parsed.subject, parsed.object]),
    priority: Math.round(50 + parsed.confidence * 40),
    importance: Math.round(40 + parsed.confidence * 50),
    accessCount: 0,
    validFromChapter: parsed.validFromChapter,
    validUntilChapter: parsed.validUntilChapter,
    reason: reason ?? `叙事事实命中：${tuple}`,
    estimatedTokens: Math.max(1, estimateTokens(content)),
    score: parsed.confidence,
    scoreBreakdown: { factConfidenceBoost: parsed.confidence },
  });
}
