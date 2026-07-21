import { mergeDuplicateCardReasons, narrativeCardDedupeKeys, preferNarrativeCard } from "./dedupe.js";
import { scoreNarrativeContextCard, type NarrativeScoringContext } from "./scoring.js";
import type { NarrativeContextCard } from "./types.js";

export function mergeNarrativeContextCards(
  cards: readonly NarrativeContextCard[],
  context: NarrativeScoringContext = {},
): NarrativeContextCard[] {
  const scored = cards.map((card) => scoreNarrativeContextCard(card, context));
  const byId = new Map<string, NarrativeContextCard>();
  const duplicateReasons = new Map<string, NarrativeContextCard[]>();
  const keyToId = new Map<string, string>();

  for (const card of scored) {
    const cardKeys = narrativeCardDedupeKeys(card);
    const duplicateIds = new Set(cardKeys.map((key) => keyToId.get(key)).filter((id): id is string => Boolean(id)));

    if (duplicateIds.size === 0) {
      byId.set(card.id, card);
      for (const key of cardKeys) keyToId.set(key, card.id);
      continue;
    }

    const group = [...duplicateIds].map((id) => byId.get(id)).filter((item): item is NarrativeContextCard => Boolean(item));
    group.push(card);
    const winner = group.reduce(preferNarrativeCard);
    const losers = group.filter((item) => item.id !== winner.id);

    for (const item of group) byId.delete(item.id);
    byId.set(winner.id, winner);
    duplicateReasons.set(winner.id, [...(duplicateReasons.get(winner.id) ?? []), ...losers]);
    for (const item of group) {
      for (const key of narrativeCardDedupeKeys(item)) keyToId.set(key, winner.id);
    }
  }

  const merged = [...byId.values()].map((card) => mergeDuplicateCardReasons(card, duplicateReasons.get(card.id) ?? []));
  return merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.priority - a.priority || a.id.localeCompare(b.id));
}
