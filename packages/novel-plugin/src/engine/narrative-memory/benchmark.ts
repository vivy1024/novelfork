import type { NarrativeContextCard } from "./types.js";
import { rerankByGeodesicEnergy } from "./wave/geodesic-rerank.js";

export type NarrativeBenchmarkBaselineName = "priority-only" | "fts-only" | "facts+fts" | "semantic" | "wave";

export type NarrativeBenchmarkFixture = Readonly<{
  id: string;
  query: string;
  requiredCardIds: readonly string[];
  cards: readonly NarrativeContextCard[];
}>;

export type NarrativeBenchmarkBaselineResult = Readonly<{
  name: NarrativeBenchmarkBaselineName;
  recallAtBudget: number;
  injectedTokens: number;
  latencyMs: number;
  skippedReason?: string;
}>;

export type NarrativeBenchmarkResult = Readonly<{
  fixtures: number;
  budgetTokens: number;
  baselines: readonly NarrativeBenchmarkBaselineResult[];
}>;

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "sourceType" | "sourceId" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "bench-book",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.summary ?? input.content,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "benchmark fixture",
    estimatedTokens: input.estimatedTokens ?? 30,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

export function createDefaultNarrativeBenchmarkFixtures(): NarrativeBenchmarkFixture[] {
  const seeds = [
    ["小瓶", "韩立", "小瓶催熟药草", "fact"],
    ["墨大夫", "韩立", "墨大夫怀疑韩立", "hooks"],
    ["药园", "小瓶", "药园异常", "timeline"],
    ["南宫婉", "禁地", "南宫婉在禁地受伤", "fact"],
    ["筑基丹", "韩立", "韩立需要筑基丹", "facts"],
    ["黄枫谷", "门规", "黄枫谷门规森严", "hard"],
    ["储物袋", "小瓶", "小瓶藏在储物袋", "state"],
    ["灵药", "药园", "灵药成熟时间异常", "facts"],
    ["师兄", "韩立", "师兄试探韩立修为", "hooks"],
    ["文风", "克制", "保持凡人修仙式克制文风", "style"],
  ] as const;
  return seeds.map(([term, entity, title, channel], index) => {
    const required = card({
      id: `required-${index + 1}`,
      sourceType: channel === "fact" || channel === "facts" ? "fact" : channel === "hooks" ? "hook" : channel === "style" ? "style" : "jingwei",
      sourceId: `source-${index + 1}`,
      channel: channel === "fact" ? "facts" : channel as NarrativeContextCard["channel"],
      title,
      content: `${title}，与${term}和${entity}直接相关。`,
      entities: [term, entity],
      tags: [channel, term],
      priority: 60,
      importance: 80,
      estimatedTokens: 30,
    });
    const distractor = card({
      id: `distractor-${index + 1}`,
      sourceType: "jingwei",
      sourceId: `distractor-source-${index + 1}`,
      channel: "state",
      title: `无关状态 ${index + 1}`,
      content: "普通背景信息，预算紧张时不应优先召回。",
      entities: ["路人"],
      priority: index % 2 === 0 ? 70 : 20,
      importance: 20,
      estimatedTokens: 45,
    });
    return {
      id: `fixture-${index + 1}`,
      query: `${entity} ${term}`,
      requiredCardIds: [required.id],
      cards: [required, distractor],
    };
  });
}

function tokens(value: readonly NarrativeContextCard[]): number {
  return value.reduce((sum, card) => sum + card.estimatedTokens, 0);
}

function takeBudget(cards: readonly NarrativeContextCard[], budgetTokens: number): NarrativeContextCard[] {
  const result: NarrativeContextCard[] = [];
  let spent = 0;
  for (const card of cards) {
    if (spent + card.estimatedTokens > budgetTokens) continue;
    spent += card.estimatedTokens;
    result.push(card);
  }
  return result;
}

function queryTerms(query: string): string[] {
  return query.split(/\s+/u).map((term) => term.trim()).filter(Boolean);
}

function ftsScore(card: NarrativeContextCard, query: string): number {
  const haystack = [card.title, card.content, ...card.entities, ...card.tags].join(" ");
  return queryTerms(query).reduce((sum, term) => haystack.includes(term) ? sum + 1 : sum, 0);
}

function rankFixture(fixture: NarrativeBenchmarkFixture, baseline: NarrativeBenchmarkBaselineName): NarrativeContextCard[] {
  if (baseline === "priority-only") {
    return [...fixture.cards].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }
  if (baseline === "fts-only") {
    return [...fixture.cards].sort((a, b) => ftsScore(b, fixture.query) - ftsScore(a, fixture.query) || a.id.localeCompare(b.id));
  }
  if (baseline === "facts+fts") {
    return [...fixture.cards].sort((a, b) => {
      const aFact = a.sourceType === "fact" ? 2 : 0;
      const bFact = b.sourceType === "fact" ? 2 : 0;
      return (bFact + ftsScore(b, fixture.query)) - (aFact + ftsScore(a, fixture.query)) || a.id.localeCompare(b.id);
    });
  }
  if (baseline === "wave") {
    return [...rerankByGeodesicEnergy(fixture.cards, Object.fromEntries(queryTerms(fixture.query).map((term) => [term, 2])), { alpha: 0.5 }).cards];
  }
  return [...fixture.cards];
}

function runBaseline(fixtures: readonly NarrativeBenchmarkFixture[], baseline: NarrativeBenchmarkBaselineName, budgetTokens: number): NarrativeBenchmarkBaselineResult {
  const startedAt = performance.now();
  if (baseline === "semantic") {
    return { name: baseline, recallAtBudget: 0, injectedTokens: 0, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), skippedReason: "embedding provider unavailable" };
  }
  let required = 0;
  let hit = 0;
  let injectedTokens = 0;
  for (const fixture of fixtures) {
    const packed = takeBudget(rankFixture(fixture, baseline), budgetTokens);
    injectedTokens += tokens(packed);
    const injected = new Set(packed.map((card) => card.id));
    for (const id of fixture.requiredCardIds) {
      required += 1;
      if (injected.has(id)) hit += 1;
    }
  }
  return {
    name: baseline,
    recallAtBudget: required === 0 ? 0 : hit / required,
    injectedTokens,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

export function runNarrativeRecallBenchmark(input: Readonly<{ fixtures?: readonly NarrativeBenchmarkFixture[]; budgetTokens?: number }>): NarrativeBenchmarkResult {
  const fixtures = input.fixtures ?? createDefaultNarrativeBenchmarkFixtures();
  const budgetTokens = input.budgetTokens ?? 120;
  const baselines: NarrativeBenchmarkBaselineName[] = ["priority-only", "fts-only", "facts+fts", "semantic", "wave"];
  return {
    fixtures: fixtures.length,
    budgetTokens,
    baselines: baselines.map((baseline) => runBaseline(fixtures, baseline, budgetTokens)),
  };
}
