import type { NarrativeContextCard } from "../types.js";

export type GeodesicRerankResult = Readonly<{
  cards: readonly NarrativeContextCard[];
  fallbackLevel: "L0" | "L1" | "L2";
}>;

function tagKeys(card: NarrativeContextCard): string[] {
  return [...card.tags, ...card.entities].map((value) => value.trim()).filter(Boolean);
}

function graphEnergyFor(card: NarrativeContextCard, energyByTag: Readonly<Record<string, number>>): number {
  let energy = 0;
  for (const key of tagKeys(card)) {
    energy = Math.max(energy, energyByTag[key] ?? energyByTag[key.toLowerCase()] ?? 0);
  }
  return energy;
}

export function rerankByGeodesicEnergy(
  cards: readonly NarrativeContextCard[],
  energyByTag: Readonly<Record<string, number>>,
  options: Readonly<{ alpha?: number }> = {},
): GeodesicRerankResult {
  const alpha = options.alpha ?? 0.25;
  if (cards.length === 0) return { cards: [], fallbackLevel: "L2" };
  const hasEnergy = Object.keys(energyByTag).length > 0;
  if (!hasEnergy) return { cards: [...cards], fallbackLevel: "L2" };

  let touched = 0;
  const reranked = cards.map((card) => {
    const graphEnergy = graphEnergyFor(card, energyByTag);
    if (graphEnergy > 0) touched += 1;
    if (card.channel === "hard") return { card, sortScore: Number.POSITIVE_INFINITY };
    const score = card.score ?? 0;
    return {
      card: {
        ...card,
        score: score + graphEnergy * alpha,
        scoreBreakdown: {
          ...(card.scoreBreakdown ?? {}),
          graphEnergy,
          geodesicBoost: graphEnergy * alpha,
        },
      },
      sortScore: score + graphEnergy * alpha,
    };
  });

  return {
    cards: reranked
      .sort((a, b) => b.sortScore - a.sortScore || b.card.priority - a.card.priority || a.card.id.localeCompare(b.card.id))
      .map((item) => item.card),
    fallbackLevel: touched > 0 ? "L0" : "L1",
  };
}
