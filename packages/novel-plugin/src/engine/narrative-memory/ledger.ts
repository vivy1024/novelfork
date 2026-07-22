import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { ensureNarrativeMemorySchema, queryNarrativeFacts } from "./storage.js";
import type { NarrativeFact } from "./types.js";

function normalizePart(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Slot key for the current-state ledger.
 * - relationship / hook: subject+predicate+object
 * - character_state / location / default: subject+predicate (object is the value)
 */
export function narrativeFactSlotKey(fact: Pick<NarrativeFact, "bookId" | "category" | "subject" | "predicate" | "object">): string {
  const category = normalizePart(fact.category);
  const subject = normalizePart(fact.subject);
  const predicate = normalizePart(fact.predicate);
  if (category === "relationship" || category === "hook") {
    return `${fact.bookId}\u0000${category}\u0000${subject}\u0000${predicate}\u0000${normalizePart(fact.object)}`;
  }
  return `${fact.bookId}\u0000${category}\u0000${subject}\u0000${predicate}`;
}

function isOpenFact(fact: NarrativeFact, asOfChapter?: number): boolean {
  if (asOfChapter === undefined) {
    return fact.validUntilChapter === undefined || fact.validUntilChapter === null;
  }
  const fromOk = fact.validFromChapter === undefined || fact.validFromChapter <= asOfChapter;
  const untilOk =
    fact.validUntilChapter === undefined ||
    fact.validUntilChapter === null ||
    fact.validUntilChapter >= asOfChapter;
  return fromOk && untilOk;
}

function preferCurrentFact(a: NarrativeFact, b: NarrativeFact): NarrativeFact {
  const aFrom = a.validFromChapter ?? a.sourceChapter ?? -1;
  const bFrom = b.validFromChapter ?? b.sourceChapter ?? -1;
  if (aFrom !== bFrom) return aFrom > bFrom ? a : b;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

export type CurrentLedgerQuery = Readonly<{
  bookId: string;
  asOfChapter?: number;
  limit?: number;
  categories?: readonly string[];
}>;

export type CurrentLedgerResult = Readonly<{
  bookId: string;
  asOfChapter?: number;
  items: readonly NarrativeFact[];
  counts: Readonly<{ byCategory: Readonly<Record<string, number>> }>;
}>;

/**
 * Current-state view: one open fact per slot key (or as-of chapter visibility).
 */
export function queryCurrentNarrativeLedger(
  storage: StorageDatabase,
  input: CurrentLedgerQuery,
): CurrentLedgerResult {
  ensureNarrativeMemorySchema(storage);
  const limit = Math.max(1, Math.min(input.limit ?? 80, 500));
  const facts = queryNarrativeFacts(storage, {
    bookId: input.bookId,
    categories: input.categories ? [...input.categories] : undefined,
    // Pull a wider set then collapse to current slots.
    limit: 500,
    ...(input.asOfChapter !== undefined ? { currentChapter: input.asOfChapter + 1 } : {}),
  });

  const open = facts.filter((fact) => isOpenFact(fact, input.asOfChapter));
  const bySlot = new Map<string, NarrativeFact>();
  for (const fact of open) {
    // When asking for absolute current (no asOf), only never-closed rows.
    if (input.asOfChapter === undefined && fact.validUntilChapter != null) continue;
    const key = narrativeFactSlotKey(fact);
    const existing = bySlot.get(key);
    if (!existing) bySlot.set(key, fact);
    else bySlot.set(key, preferCurrentFact(existing, fact));
  }

  const items = [...bySlot.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, limit);

  const byCategory: Record<string, number> = {};
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  }

  return {
    bookId: input.bookId,
    asOfChapter: input.asOfChapter,
    items,
    counts: { byCategory },
  };
}

/**
 * Close open facts that occupy the same ledger slot as `next`, ending at `closedAtChapter`.
 * Returns number of rows closed.
 */
export function closeSupersededNarrativeFacts(
  storage: StorageDatabase,
  next: NarrativeFact,
  closedAtChapter: number,
): number {
  ensureNarrativeMemorySchema(storage);
  const slot = narrativeFactSlotKey(next);
  const candidates = queryNarrativeFacts(storage, {
    bookId: next.bookId,
    categories: [next.category],
    limit: 200,
  }).filter(
    (fact) =>
      fact.id !== next.id &&
      (fact.validUntilChapter === undefined || fact.validUntilChapter === null) &&
      narrativeFactSlotKey(fact) === slot,
  );

  if (candidates.length === 0) return 0;
  const now = new Date().toISOString();
  const stmt = storage.sqlite.prepare(`
    UPDATE narrative_fact
    SET valid_until_chapter = ?, updated_at = ?
    WHERE id = ?
  `);
  let closed = 0;
  for (const fact of candidates) {
    // End the previous value on the superseding chapter (current view uses valid_until IS NULL).
    stmt.run(closedAtChapter, now, fact.id);
    closed += 1;
  }
  return closed;
}
