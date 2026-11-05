import type { NarrativeFact } from "./types.js";
import { canonicalizeStatePredicate } from "./state-predicate.js";

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
 * - 状态类谓词先按受控词表归一（state-predicate.ts）：
 *   「身亡」「阵亡」「复活」落在同一个「生死」槽，「本章所在位置」「位于」落在 location 类下的「所在」槽，
 *   「修为」「当前境界」落在「境界」槽……后来的值才能覆盖先前的值；
 *   持有类（获得 / 失去）按物品分槽，一件物品一个槽。
 *   词表认不出的谓词原样作槽位。
 * Length-prefixed so the key is unambiguous for any part and survives text round-trips.
 */
export function narrativeFactSlotKey(fact: Pick<NarrativeFact, "bookId" | "category" | "subject" | "predicate" | "object">): string {
  const category = normalizeSlotPart(fact.category);
  const subject = normalizeSlotPart(fact.subject);
  if (category === "relationship" || category === "hook") {
    return encodeSlotParts([fact.bookId, category, subject, normalizeSlotPart(fact.predicate), normalizeSlotPart(fact.object)]);
  }
  const state = canonicalizeStatePredicate(fact);
  if (state) {
    const slot = normalizeSlotPart(state.slot);
    return state.multiValued
      ? encodeSlotParts([fact.bookId, state.category, subject, slot, normalizeSlotPart(fact.object)])
      : encodeSlotParts([fact.bookId, state.category, subject, slot]);
  }
  return encodeSlotParts([fact.bookId, category, subject, normalizeSlotPart(fact.predicate)]);
}
