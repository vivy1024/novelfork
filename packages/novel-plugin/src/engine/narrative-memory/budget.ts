import type { JingweiBudgetDetailLevel } from "../jingwei/read-model/token-budget.js";
import { applyTokenBudgetWithDegradation } from "../jingwei/read-model/token-budget.js";
import { estimateTokens } from "../jingwei/context/token-budget.js";
import type { NarrativeContextCard, NarrativeContextChannel } from "./types.js";

const DETAIL_LEVELS: readonly JingweiBudgetDetailLevel[] = ["full", "normal", "summary", "brief"];

export const DEFAULT_NARRATIVE_CHANNEL_BUDGETS: Readonly<Record<NarrativeContextChannel, number>> = {
  hard: 4000,
  state: 4000,
  timeline: 3000,
  hooks: 2000,
  facts: 2000,
  style: 1000,
  semantic: 2000,
  relationship: 1000,
};

export type NarrativeBudgetPolicy = Readonly<{
  maxTokens?: number;
  channelBudgets?: Partial<Record<NarrativeContextChannel, number>>;
}>;

export type PackedNarrativeContextCard = Readonly<{
  card: NarrativeContextCard;
  detailLevel: JingweiBudgetDetailLevel;
  content: string;
  estimatedTokens: number;
}>;

export type DegradedNarrativeCard = Readonly<{
  id: string;
  from: JingweiBudgetDetailLevel;
  to: JingweiBudgetDetailLevel;
}>;

export type NarrativeBudgetResult = Readonly<{
  cards: readonly PackedNarrativeContextCard[];
  droppedCards: readonly NarrativeContextCard[];
  degradedCards: readonly DegradedNarrativeCard[];
  totalEstimatedTokens: number;
  injectedTokensByChannel: Readonly<Partial<Record<NarrativeContextChannel, number>>>;
  channelBudgets: Readonly<Record<NarrativeContextChannel, number>>;
  warnings: readonly string[];
}>;

function detailIndex(level: JingweiBudgetDetailLevel): number {
  return DETAIL_LEVELS.indexOf(level);
}

function uniqueChannels(cards: readonly NarrativeContextCard[]): NarrativeContextChannel[] {
  return [...new Set(cards.map((card) => card.channel))];
}

function normalizeTokenBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function scaleBudgets(budgets: Readonly<Record<NarrativeContextChannel, number>>, maxTokens?: number): Record<NarrativeContextChannel, number> {
  const normalizedMax = normalizeTokenBudget(maxTokens);
  const total = Object.values(budgets).reduce((sum, value) => sum + normalizeTokenBudget(value), 0);
  if (normalizedMax <= 0 || total <= normalizedMax) return { ...budgets };

  const scale = normalizedMax / total;
  const scaled = Object.fromEntries(Object.entries(budgets).map(([channel, value]) => [channel, Math.floor(normalizeTokenBudget(value) * scale)])) as Record<NarrativeContextChannel, number>;
  const allocated = Object.values(scaled).reduce((sum, value) => sum + value, 0);
  let remainder = normalizedMax - allocated;
  for (const channel of ["hard", "state", "timeline", "hooks", "facts", "semantic", "relationship", "style"] satisfies readonly NarrativeContextChannel[]) {
    if (remainder <= 0) break;
    scaled[channel] += 1;
    remainder -= 1;
  }
  return scaled;
}

function resolveChannelBudgets(policy: NarrativeBudgetPolicy): Record<NarrativeContextChannel, number> {
  const source = policy.channelBudgets
    ? Object.fromEntries(Object.keys(DEFAULT_NARRATIVE_CHANNEL_BUDGETS).map((channel) => [channel, policy.channelBudgets?.[channel as NarrativeContextChannel] ?? 0])) as Record<NarrativeContextChannel, number>
    : { ...DEFAULT_NARRATIVE_CHANNEL_BUDGETS };
  const normalized = Object.fromEntries(Object.entries(source).map(([channel, value]) => [channel, normalizeTokenBudget(value)])) as Record<NarrativeContextChannel, number>;
  return scaleBudgets(normalized, policy.maxTokens);
}

function contentAtLevel(card: NarrativeContextCard, level: JingweiBudgetDetailLevel): string {
  switch (level) {
    case "full":
      return card.content;
    case "normal":
      return card.normal ?? card.summary ?? card.brief;
    case "summary":
      return card.summary ?? card.brief;
    case "brief":
      return card.brief;
  }
}

function tokenEstimateFor(value: string, fallback: number): number {
  const estimated = estimateTokens(value);
  return Math.max(1, estimated || Math.min(Math.max(1, fallback), 1));
}

function tokenAtLevel(card: NarrativeContextCard, level: JingweiBudgetDetailLevel): number {
  if (level === "full") return Math.max(1, card.estimatedTokens);
  return tokenEstimateFor(contentAtLevel(card, level), card.estimatedTokens);
}

function packCard(card: NarrativeContextCard, detailLevel: JingweiBudgetDetailLevel): PackedNarrativeContextCard {
  return {
    card,
    detailLevel,
    content: contentAtLevel(card, detailLevel),
    estimatedTokens: tokenAtLevel(card, detailLevel),
  };
}

function recordDegradation(card: NarrativeContextCard, to: JingweiBudgetDetailLevel): DegradedNarrativeCard | undefined {
  return to === "full" ? undefined : { id: card.id, from: "full", to };
}

function packHardChannel(cards: readonly NarrativeContextCard[], channelBudget: number): { packed: PackedNarrativeContextCard[]; degraded: DegradedNarrativeCard[]; warnings: string[] } {
  const ordered = [...cards].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.priority - a.priority || a.id.localeCompare(b.id));
  const state = new Map<string, JingweiBudgetDetailLevel>(ordered.map((card) => [card.id, "full"]));
  const total = (): number => ordered.reduce((sum, card) => sum + tokenAtLevel(card, state.get(card.id) ?? "full"), 0);
  const byLowPriority = [...ordered].sort((a, b) => a.priority - b.priority || (a.score ?? 0) - (b.score ?? 0) || a.id.localeCompare(b.id));

  let guard = 0;
  while (total() > channelBudget && guard < ordered.length * DETAIL_LEVELS.length + 1) {
    guard += 1;
    const target = byLowPriority.find((card) => detailIndex(state.get(card.id) ?? "full") < DETAIL_LEVELS.length - 1);
    if (!target) break;
    const current = state.get(target.id) ?? "full";
    state.set(target.id, DETAIL_LEVELS[detailIndex(current) + 1] ?? "brief");
  }

  const packed = ordered.map((card) => packCard(card, state.get(card.id) ?? "full"));
  const degraded = packed.map((item) => recordDegradation(item.card, item.detailLevel)).filter((item): item is DegradedNarrativeCard => Boolean(item));
  const warnings = total() > channelBudget ? [`hard channel exceeds budget after degradation: ${total()}/${channelBudget}`] : [];
  return { packed, degraded, warnings };
}

function packDroppableChannel(cards: readonly NarrativeContextCard[], channelBudget: number): { packed: PackedNarrativeContextCard[]; dropped: NarrativeContextCard[]; degraded: DegradedNarrativeCard[] } {
  const ordered = [...cards].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.priority - a.priority || a.id.localeCompare(b.id));
  const itemById = new Map(ordered.map((card) => [card.id, card]));
  const result = applyTokenBudgetWithDegradation(ordered.map((card) => ({
    id: card.id,
    priority: card.priority + (card.score ?? 0),
    initialLevel: "full" as const,
    levels: DETAIL_LEVELS.map((detailLevel) => ({ detailLevel, estimatedTokens: tokenAtLevel(card, detailLevel) })),
  })), channelBudget);

  const packed = result.items.map((item) => packCard(itemById.get(item.id)!, item.detailLevel));
  const droppedIds = new Set(result.droppedEntryIds);
  const dropped = ordered.filter((card) => droppedIds.has(card.id));
  const degraded = packed.map((item) => recordDegradation(item.card, item.detailLevel)).filter((item): item is DegradedNarrativeCard => Boolean(item));
  return { packed, dropped, degraded };
}

function dropGloballyIfNeeded(
  packed: readonly PackedNarrativeContextCard[],
  maxTokens?: number,
): { packed: PackedNarrativeContextCard[]; dropped: NarrativeContextCard[] } {
  const budget = normalizeTokenBudget(maxTokens);
  if (budget <= 0) return { packed: [...packed], dropped: [] };
  const alive = new Set(packed.map((item) => item.card.id));
  let total = packed.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const dropOrder = [...packed]
    .filter((item) => item.card.channel !== "hard")
    .sort((a, b) => a.card.priority - b.card.priority || (a.card.score ?? 0) - (b.card.score ?? 0) || b.estimatedTokens - a.estimatedTokens || a.card.id.localeCompare(b.card.id));
  const dropped: NarrativeContextCard[] = [];
  for (const item of dropOrder) {
    if (total <= budget) break;
    alive.delete(item.card.id);
    total -= item.estimatedTokens;
    dropped.push(item.card);
  }
  return { packed: packed.filter((item) => alive.has(item.card.id)), dropped };
}

export function packNarrativeContext(cards: readonly NarrativeContextCard[], policy: NarrativeBudgetPolicy = {}): NarrativeBudgetResult {
  const channelBudgets = resolveChannelBudgets(policy);
  const warnings: string[] = [];
  const degradedCards: DegradedNarrativeCard[] = [];
  const droppedCards: NarrativeContextCard[] = [];
  const packedCards: PackedNarrativeContextCard[] = [];

  for (const channel of uniqueChannels(cards)) {
    const channelCards = cards.filter((card) => card.channel === channel);
    if (channel === "hard") {
      const result = packHardChannel(channelCards, channelBudgets[channel] ?? 0);
      packedCards.push(...result.packed);
      degradedCards.push(...result.degraded);
      warnings.push(...result.warnings);
    } else {
      const result = packDroppableChannel(channelCards, channelBudgets[channel] ?? 0);
      packedCards.push(...result.packed);
      droppedCards.push(...result.dropped);
      degradedCards.push(...result.degraded);
    }
  }

  const global = dropGloballyIfNeeded(packedCards, policy.maxTokens);
  const globalDroppedIds = new Set(global.dropped.map((card) => card.id));
  droppedCards.push(...global.dropped.filter((card) => !droppedCards.some((dropped) => dropped.id === card.id)));

  const finalCards = global.packed.sort((a, b) => (b.card.score ?? 0) - (a.card.score ?? 0) || b.card.priority - a.card.priority || a.card.id.localeCompare(b.card.id));
  const totalEstimatedTokens = finalCards.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const injectedTokensByChannel: Partial<Record<NarrativeContextChannel, number>> = {};
  for (const item of finalCards) {
    injectedTokensByChannel[item.card.channel] = (injectedTokensByChannel[item.card.channel] ?? 0) + item.estimatedTokens;
  }

  return {
    cards: finalCards,
    droppedCards,
    degradedCards: degradedCards.filter((item) => !globalDroppedIds.has(item.id)),
    totalEstimatedTokens,
    injectedTokensByChannel,
    channelBudgets,
    warnings,
  };
}
