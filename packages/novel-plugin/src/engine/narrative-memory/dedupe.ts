import type { NarrativeContextCard } from "./types.js";

function normalizeKeyPart(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/gu, " ").toLowerCase();
}

function factTupleKey(card: NarrativeContextCard): string | undefined {
  if (card.sourceType !== "fact") return undefined;
  const tuple = normalizeKeyPart(card.title || card.brief || card.content);
  if (!tuple) return undefined;
  return `fact-tuple:${card.bookId}:${tuple}:${card.validFromChapter ?? ""}`;
}

function jingweiTitleKey(card: NarrativeContextCard): string | undefined {
  if (card.sourceType !== "jingwei") return undefined;
  const title = normalizeKeyPart(card.title);
  return title ? `jingwei-title:${card.bookId}:${title}` : undefined;
}

export function narrativeCardDedupeKeys(card: NarrativeContextCard): readonly string[] {
  return [
    `${card.sourceType}:${card.sourceId}`,
    factTupleKey(card),
    jingweiTitleKey(card),
  ].filter((key): key is string => Boolean(key));
}

function uniqueReasons(cards: readonly NarrativeContextCard[]): string {
  const reasons = cards.map((card) => card.reason.trim()).filter(Boolean);
  return [...new Set(reasons)].join("；");
}

export function mergeDuplicateCardReasons(card: NarrativeContextCard, duplicates: readonly NarrativeContextCard[]): NarrativeContextCard {
  const reason = uniqueReasons([card, ...duplicates]);
  return reason && reason !== card.reason ? { ...card, reason } : card;
}
