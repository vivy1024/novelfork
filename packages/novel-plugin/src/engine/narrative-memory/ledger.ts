import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { narrativeFactSlotKey } from "./slot-key.js";
import { ensureNarrativeMemorySchema, queryNarrativeFacts, queryNarrativeFactSlotHeads } from "./storage.js";
import type { NarrativeFact } from "./types.js";

export { narrativeFactSlotKey } from "./slot-key.js";

export type CurrentLedgerQuery = Readonly<{
  bookId: string;
  asOfChapter?: number;
  limit?: number;
  categories?: readonly string[];
  /** 经纬条目 id：只返回挂在这些条目上的 open fact。 */
  entryIds?: readonly string[];
  /** 实体名：只折叠 subject 或 object 命中这些实体的历史，避免无关事实挤掉目标。 */
  entities?: readonly string[];
  predicates?: readonly string[];
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
  const items = queryNarrativeFactSlotHeads(storage, {
    bookId: input.bookId,
    categories: input.categories ? [...input.categories] : undefined,
    entryIds: input.entryIds ? [...input.entryIds] : undefined,
    entities: input.entities ? [...input.entities] : undefined,
    predicates: input.predicates ? [...input.predicates] : undefined,
    asOfChapter: input.asOfChapter,
  })
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
    openOnly: true,
    slotKey: slot,
    limit: 0,
  }).filter((fact) => fact.id !== next.id);

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
