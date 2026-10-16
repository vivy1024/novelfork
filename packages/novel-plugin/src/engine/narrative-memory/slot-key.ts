import type { NarrativeFact } from "./types.js";

export function normalizeSlotPart(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function encodeSlotParts(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

/**
 * Slot key for the current-state ledger.
 * - relationship / hook: subject+predicate+object
 * - character_state / location / default: subject+predicate (object is the value)
 * Length-prefixed so the key is unambiguous for any part and survives text round-trips.
 */
export function narrativeFactSlotKey(fact: Pick<NarrativeFact, "bookId" | "category" | "subject" | "predicate" | "object">): string {
  const category = normalizeSlotPart(fact.category);
  const subject = normalizeSlotPart(fact.subject);
  const predicate = normalizeSlotPart(fact.predicate);
  if (category === "relationship" || category === "hook") {
    return encodeSlotParts([fact.bookId, category, subject, predicate, normalizeSlotPart(fact.object)]);
  }
  return encodeSlotParts([fact.bookId, category, subject, predicate]);
}
