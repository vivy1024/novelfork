import type { NarrativeFact } from "./types.js";
import { normalizeStateFact } from "./state-predicate.js";

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
 * - 生死 / 去向 / 所在 三类硬状态先做谓词归一（state-predicate.ts）：
 *   「身亡」「阵亡」「复活」落在同一个「生死」槽，后来的值才能覆盖先前的值；
 *   人物状态里写的「到达 / 抵达」与位置类的「所在」共用 location 类下的「所在」槽。
 * Length-prefixed so the key is unambiguous for any part and survives text round-trips.
 */
export function narrativeFactSlotKey(fact: Pick<NarrativeFact, "bookId" | "category" | "subject" | "predicate" | "object">): string {
  const category = normalizeSlotPart(fact.category);
  const subject = normalizeSlotPart(fact.subject);
  if (category === "relationship" || category === "hook") {
    return encodeSlotParts([fact.bookId, category, subject, normalizeSlotPart(fact.predicate), normalizeSlotPart(fact.object)]);
  }
  const state = normalizeStateFact(fact);
  if (state) return encodeSlotParts([fact.bookId, state.category, subject, state.slot]);
  return encodeSlotParts([fact.bookId, category, subject, normalizeSlotPart(fact.predicate)]);
}
