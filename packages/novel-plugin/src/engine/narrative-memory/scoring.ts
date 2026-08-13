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

/**
 * 新近变动加权（P5 规模化 · 子项2）。
 *
 * 长篇后期同配额竞争时，第 8 章的旧 fact 不该和第 99 章的新 fact 权重一样。
 * 这里按「最后变动章 → 当前章」的距离给非 hard 卡片加/减权：变动越近加权越
 * 高，越旧减权越多，从而让新近变动的内容在通道内装箱竞争与全局丢弃排序中占优。
 *
 * 边界与纪律：
 *   - hard 通道（canon/硬规则）恒不加权：canon 不随时间失效，不能因为「旧」被
 *     降级或丢弃，加权只在可丢弃通道内部竞争时生效。
 *   - 拿不到当前章号、或卡片无变动章号（validFromChapter 缺失）时返回 0（中性），
 *     绝不凭空制造旧惩罚。
 *   - 距离为负（变动章晚于当前章，例如预设的未来生效事实）按 0 处理，只给满额
 *     正加权，不额外奖励。
 */
const RECENT_CHANGE_MAX_BOOST = 20;
/** 超过这个章距后不再有正加权；再远则进入负加权（旧惩罚）区间。 */
const RECENT_CHANGE_NEUTRAL_DISTANCE = 20;

function recentChangeBoost(card: NarrativeContextCard, currentChapter?: number): number {
  // canon/硬规则不随时间失效：绝不给 hard 卡片加旧惩罚，否则可能被优先降级。
  if (card.channel === "hard") return 0;
  if (currentChapter === undefined || !Number.isFinite(currentChapter)) return 0;
  const changedChapter = card.validFromChapter;
  if (changedChapter === undefined || !Number.isFinite(changedChapter)) return 0;
  const distance = Math.max(0, currentChapter - changedChapter);
  // 线性衰减：distance=0 时 +MAX，distance=NEUTRAL 时 0，更旧则负，封底 -MAX。
  const raw = RECENT_CHANGE_MAX_BOOST * (1 - distance / RECENT_CHANGE_NEUTRAL_DISTANCE);
  return Math.max(-RECENT_CHANGE_MAX_BOOST, Math.min(RECENT_CHANGE_MAX_BOOST, raw));
}

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
    recentChangeBoost: recentChangeBoost(card, context.currentChapter),
    tokenCostPenalty: -Math.min(30, card.estimatedTokens / 80),
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    ...card,
    score,
    scoreBreakdown: breakdown,
  };
}
