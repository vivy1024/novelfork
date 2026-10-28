import type { JingweiBudgetDetailLevel } from "../jingwei/read-model/token-budget.js";
import { applyTokenBudgetWithDegradation } from "../jingwei/read-model/token-budget.js";
import { estimateTokens } from "../jingwei/context/token-budget.js";
import type { NarrativeContextCard, NarrativeContextChannel } from "./types.js";

const DETAIL_LEVELS: readonly JingweiBudgetDetailLevel[] = ["full", "normal", "summary", "brief"];

// 口径说明（T4.7）：预算表按 CJK 感知估算尺定标，各通道数值为旧英文尺 ×3，
// 保住原表约 4k/3k/2k… 中文字的真实容量；总和（含层级前情档）68100 > 全局默认 24000，
// 常规写作走 scaleBudgets 比例缩放（hard 份额 ≈4400 ≈ 旧尺 4000）。
export const DEFAULT_NARRATIVE_CHANNEL_BUDGETS: Readonly<Record<NarrativeContextChannel, number>> = {
  hard: 12000,
  state: 12000,
  // 原 9000 拆出 4500 给层级前情档（DEFAULT_STORY_ARC_BUDGET），总和不变，hard 等通道的缩放份额不变。
  timeline: 4500,
  hooks: 6000,
  facts: 6000,
  style: 3000,
  semantic: 6000,
  relationship: 3000,
  "character-kernel": 4500,
  "recent-summary": 3600,
  knowledge: 3000,
};

/**
 * 层级前情档位（本卷前情 / 前卷卷摘要 / 全书梗概，见 story-arc.ts）。
 * 卡片挂在 timeline 分段，但单独装箱：不和前章尾部、Runtime 时间线抢 timeline 份额，
 * 档内按 priority 降档/丢弃（本卷前情 > 前卷近→远 > 全书梗概）。近章在 recent-summary 通道，不在本档。
 * 与各通道一起参与 maxTokens 等比缩放；它是可丢弃档，永远不挤 hard。
 */
export const DEFAULT_STORY_ARC_BUDGET = 4500;
const STORY_ARC_TAG = "story-arc";

export type NarrativeBudgetPolicy = Readonly<{
  maxTokens?: number;
  channelBudgets?: Partial<Record<NarrativeContextChannel, number>>;
  /** 层级前情档位预算；缺省时：给了 channelBudgets 就跟随其 timeline 份额（没给 timeline 即 0），否则用默认值。 */
  storyArcBudget?: number;
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
  /** 层级前情档位的最终预算（已缩放）。 */
  storyArcBudget: number;
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

type ResolvedBudgets = { channels: Record<NarrativeContextChannel, number>; storyArc: number };

function scaleBudgets(budgets: Readonly<Record<NarrativeContextChannel, number>>, storyArc: number, maxTokens?: number): ResolvedBudgets {
  const normalizedMax = normalizeTokenBudget(maxTokens);
  const total = Object.values(budgets).reduce((sum, value) => sum + normalizeTokenBudget(value), 0) + storyArc;
  if (normalizedMax <= 0 || total <= normalizedMax) return { channels: { ...budgets }, storyArc };

  const scale = normalizedMax / total;
  const scaled = Object.fromEntries(Object.entries(budgets).map(([channel, value]) => [channel, Math.floor(normalizeTokenBudget(value) * scale)])) as Record<NarrativeContextChannel, number>;
  const scaledArc = Math.floor(storyArc * scale);
  const allocated = Object.values(scaled).reduce((sum, value) => sum + value, 0) + scaledArc;
  let remainder = normalizedMax - allocated;
  for (const channel of ["hard", "state", "timeline", "recent-summary", "hooks", "facts", "character-kernel", "knowledge", "semantic", "relationship", "style"] satisfies readonly NarrativeContextChannel[]) {
    if (remainder <= 0) break;
    scaled[channel] += 1;
    remainder -= 1;
  }
  return { channels: scaled, storyArc: scaledArc };
}

/** 各通道最终预算（含 maxTokens 缩放）；召回前通道据此自裁，与打包时用的是同一份数字。 */
export function resolveNarrativeChannelBudgets(policy: NarrativeBudgetPolicy = {}): Record<NarrativeContextChannel, number> {
  return resolveBudgets(policy).channels;
}

function resolveBudgets(policy: NarrativeBudgetPolicy): ResolvedBudgets {
  const source = policy.channelBudgets
    ? Object.fromEntries(Object.keys(DEFAULT_NARRATIVE_CHANNEL_BUDGETS).map((channel) => [channel, policy.channelBudgets?.[channel as NarrativeContextChannel] ?? 0])) as Record<NarrativeContextChannel, number>
    : { ...DEFAULT_NARRATIVE_CHANNEL_BUDGETS };
  const normalized = Object.fromEntries(Object.entries(source).map(([channel, value]) => [channel, normalizeTokenBudget(value)])) as Record<NarrativeContextChannel, number>;
  // 层级前情挂在 timeline 分段：调用方圈定通道（channelBudgets）时，跟随 timeline 是否被圈定。
  const storyArc = normalizeTokenBudget(policy.storyArcBudget ?? (policy.channelBudgets ? policy.channelBudgets.timeline ?? 0 : DEFAULT_STORY_ARC_BUDGET));
  return scaleBudgets(normalized, storyArc, policy.maxTokens);
}

function isStoryArcCard(card: NarrativeContextCard): boolean {
  return card.tags.includes(STORY_ARC_TAG);
}

/**
 * 本章出场实体的 canon 设定（state 通道，标 entity-canon）：可降档，但在同通道里最后才动，
 * 全局裁剪时也排在可丢弃卡的最后；真被裁掉时由 packNarrativeContext 写进 warnings 点名，不静默。
 */
const ENTITY_CANON_TAG = "entity-canon";
const ENTITY_CANON_PRIORITY_LIFT = 1000;

function isEntityCanonCard(card: NarrativeContextCard): boolean {
  return card.tags.includes(ENTITY_CANON_TAG);
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
    priority: card.priority + (card.score ?? 0) + (isEntityCanonCard(card) ? ENTITY_CANON_PRIORITY_LIFT : 0),
    initialLevel: "full" as const,
    levels: DETAIL_LEVELS.map((detailLevel) => ({ detailLevel, estimatedTokens: tokenAtLevel(card, detailLevel) })),
  })), channelBudget);

  const packed = result.items.map((item) => packCard(itemById.get(item.id)!, item.detailLevel));
  const droppedIds = new Set(result.droppedEntryIds);
  const dropped = ordered.filter((card) => droppedIds.has(card.id));
  const degraded = packed.map((item) => recordDegradation(item.card, item.detailLevel)).filter((item): item is DegradedNarrativeCard => Boolean(item));
  return { packed, dropped, degraded };
}

/** 层级前情档：严格按 priority 降档/丢弃（不掺 score），保证「本卷前情 > 前卷 > 全书梗概」的次序可预期。 */
function packStoryArcTier(cards: readonly NarrativeContextCard[], budget: number): { packed: PackedNarrativeContextCard[]; dropped: NarrativeContextCard[]; degraded: DegradedNarrativeCard[] } {
  const ordered = [...cards].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const itemById = new Map(ordered.map((card) => [card.id, card]));
  const result = applyTokenBudgetWithDegradation(ordered.map((card) => ({
    id: card.id,
    priority: card.priority,
    initialLevel: "full" as const,
    levels: DETAIL_LEVELS.map((detailLevel) => ({ detailLevel, estimatedTokens: tokenAtLevel(card, detailLevel) })),
  })), budget);
  const packed = result.items.map((item) => packCard(itemById.get(item.id)!, item.detailLevel));
  const droppedIds = new Set(result.droppedEntryIds);
  return {
    packed,
    dropped: ordered.filter((card) => droppedIds.has(card.id)),
    degraded: packed.map((item) => recordDegradation(item.card, item.detailLevel)).filter((item): item is DegradedNarrativeCard => Boolean(item)),
  };
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
    .sort((a, b) => Number(isEntityCanonCard(a.card)) - Number(isEntityCanonCard(b.card)) || a.card.priority - b.card.priority || (a.card.score ?? 0) - (b.card.score ?? 0) || b.estimatedTokens - a.estimatedTokens || a.card.id.localeCompare(b.card.id));
  const dropped: NarrativeContextCard[] = [];
  for (const item of dropOrder) {
    if (total <= budget) break;
    alive.delete(item.card.id);
    total -= item.estimatedTokens;
    dropped.push(item.card);
  }
  return { packed: packed.filter((item) => alive.has(item.card.id)), dropped };
}

/** 该卡片在打分时是否吃到了「旧」的负加权（新近变动加权为负）。用于可解释诊断。 */
function isAgedDown(card: NarrativeContextCard): boolean {
  const boost = card.scoreBreakdown?.recentChangeBoost;
  return typeof boost === "number" && boost < 0;
}

export function packNarrativeContext(cards: readonly NarrativeContextCard[], policy: NarrativeBudgetPolicy = {}): NarrativeBudgetResult {
  const resolved = resolveBudgets(policy);
  const channelBudgets = resolved.channels;
  const warnings: string[] = [];
  const degradedCards: DegradedNarrativeCard[] = [];
  const droppedCards: NarrativeContextCard[] = [];
  const packedCards: PackedNarrativeContextCard[] = [];

  // hard 卡永远走 hard 装箱；层级前情卡（非 hard）单独成档。
  const arcCards = cards.filter((card) => card.channel !== "hard" && isStoryArcCard(card));
  const channelPool = cards.filter((card) => card.channel === "hard" || !isStoryArcCard(card));
  if (arcCards.length > 0) {
    const tier = packStoryArcTier(arcCards, resolved.storyArc);
    packedCards.push(...tier.packed);
    droppedCards.push(...tier.dropped);
    degradedCards.push(...tier.degraded);
  }

  for (const channel of uniqueChannels(channelPool)) {
    const channelCards = channelPool.filter((card) => card.channel === channel);
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

  const droppedEntityCanon = droppedCards.filter(isEntityCanonCard);
  if (droppedEntityCanon.length > 0) {
    warnings.push(`本章出场实体设定未能注入：发生了什么：${droppedEntityCanon.length} 条出场实体的 canon 设定（${droppedEntityCanon.map((card) => card.title).join("、")}）降到最简档后仍装不进召回预算，被裁掉。为什么要看：模型写这些角色/地点时看不到它们的设定，可能写走样。建议怎么做：调高本书召回预算（retrieval.maxTokens），或精简这些条目的正文与摘要。`);
  }

  // 可解释：新近变动加权（子项2）让长期未变动的旧内容在同配额竞争中吃负加权，
  // 因而更容易被降级/丢弃。这里点名「谁因为旧而落选」，便于诊断与作者复查。
  // hard 通道从不吃旧惩罚（canon 不失效），因此不会出现在这里。
  const agedDroppedIds = droppedCards.filter(isAgedDown).map((card) => card.id);
  if (agedDroppedIds.length > 0) {
    warnings.push(`因长期未变动（新近度低）被丢弃 ${agedDroppedIds.length} 张卡片：${agedDroppedIds.join("、")}`);
  }
  const degradedIdSet = new Set(degradedCards.map((item) => item.id));
  const agedDegradedIds = packedCards
    .filter((item) => degradedIdSet.has(item.card.id) && isAgedDown(item.card) && !globalDroppedIds.has(item.card.id))
    .map((item) => item.card.id);
  if (agedDegradedIds.length > 0) {
    warnings.push(`因长期未变动（新近度低）被降级 ${agedDegradedIds.length} 张卡片：${agedDegradedIds.join("、")}`);
  }

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
    storyArcBudget: resolved.storyArc,
    warnings,
  };
}
