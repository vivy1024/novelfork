import type { NarrativeContextCard } from "./types.js";

export interface NarrativeScoringContext {
  readonly currentChapter?: number;
  readonly queryEntities?: readonly string[];
  readonly now?: Date;
}

const CHANNEL_BOOST: Record<string, number> = {
  hard: 100,
  state: 70,
  timeline: 55,
  hooks: 65,
  facts: 60,
  relationship: 55,
  style: 20,
  semantic: 35,
};

function entityMatchBoost(card: NarrativeContextCard, queryEntities: readonly string[]): number {
  if (queryEntities.length === 0) return 0;
  const haystack = [card.title, card.content, card.brief, ...(card.entities ?? []), ...(card.tags ?? [])].join("\n");
  return queryEntities.reduce((sum, entity) => sum + (entity && haystack.includes(entity) ? 12 : 0), 0);
}

function layerBoost(card: NarrativeContextCard): number {
  if (card.channel === "hard") return 20;
  if (card.tags.includes("canon")) return 16;
  if (card.tags.includes("dynamic")) return 10;
  if (card.tags.includes("reference")) return 3;
  return 6;
}

function chapterProximityBoost(card: NarrativeContextCard, currentChapter?: number): number {
  if (currentChapter === undefined) return 0;
  const chapter = card.validUntilChapter ?? card.validFromChapter;
  if (chapter === undefined) return 0;
  const distance = Math.abs(currentChapter - chapter);
  return Math.max(0, 24 - distance * 3);
}

function recencyBoost(card: NarrativeContextCard, now: Date): number {
  if (!card.lastAccessedAt) return 0;
  const ageMs = now.getTime() - new Date(card.lastAccessedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const ageDays = ageMs / 86_400_000;
  return Math.max(0, 12 - ageDays);
}

export function scoreNarrativeContextCard(card: NarrativeContextCard, context: NarrativeScoringContext = {}): NarrativeContextCard {
  const existing = card.scoreBreakdown ?? {};
  const breakdown = {
    channelBoost: CHANNEL_BOOST[card.channel] ?? 0,
    entityMatchBoost: entityMatchBoost(card, context.queryEntities ?? []),
    layerBoost: layerBoost(card),
    chapterProximityBoost: chapterProximityBoost(card, context.currentChapter),
    importanceBoost: card.importance / 2 + card.priority / 5,
    ftsBoost: existing.ftsBoost ?? 0,
    factConfidenceBoost: existing.factConfidenceBoost ?? (card.sourceType === "fact" ? (card.score ?? 0) * 10 : 0),
    recencyBoost: recencyBoost(card, context.now ?? new Date()),
    tokenCostPenalty: -Math.min(30, card.estimatedTokens / 80),
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    ...card,
    score,
    scoreBreakdown: breakdown,
  };
}
