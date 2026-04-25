import type { AiTasteLevel, FilterReport, RuleHit } from "../types.js";
import { scanWithZhuque, type ZhuqueConfig } from "../zhuque/client.js";
import { createCompositeHit, FILTER_RULES } from "./rules.js";
import { tokenizeChineseText } from "./tokenizer.js";

export const FILTER_ENGINE_VERSION = "filter-v1";

export interface RunFilterOptions {
  bookId?: string;
  pgiUsed?: boolean;
  weights?: Record<string, number>;
  zhuqueConfig?: ZhuqueConfig | null;
}

export function mapAiTasteLevel(score: number): AiTasteLevel {
  if (score < 30) return "clean";
  if (score < 50) return "mild";
  if (score <= 70) return "moderate";
  return "severe";
}

function severityFactor(hit: RuleHit): number {
  if (hit.severity === "high") return 3;
  if (hit.severity === "medium") return 2;
  return 1;
}

function scoreHits(hits: RuleHit[], weights?: Record<string, number>): number {
  const raw = hits.reduce((sum, hit) => {
    const override = weights?.[hit.ruleId] ?? 1;
    return sum + hit.weightContribution * severityFactor(hit) * override;
  }, 0);
  return Math.max(0, Math.min(100, Math.round(raw * 4)));
}

function hitCounts(hits: RuleHit[]): Record<string, number> {
  return Object.fromEntries(hits.map((hit) => [hit.ruleId, hit.spans.length]));
}

export async function runFilter(text: string, options: RunFilterOptions = {}): Promise<FilterReport> {
  const started = performance.now();
  const tokenized = tokenizeChineseText(text);
  const baseHits = FILTER_RULES
    .map((rule) => rule.run(text, { text, tokenized, priorHits: [] }))
    .filter((hit): hit is RuleHit => hit !== null);
  const composite = createCompositeHit(baseHits);
  const hits = composite ? [...baseHits, composite] : baseHits;
  const aiTasteScore = scoreHits(hits, options.weights);
  const zhuque = options.zhuqueConfig ? await scanWithZhuque(text, options.zhuqueConfig) : { status: "not-configured" as const };
  const elapsedMs = performance.now() - started;

  return {
    aiTasteScore,
    level: mapAiTasteLevel(aiTasteScore),
    hits,
    zhuque,
    engineVersion: FILTER_ENGINE_VERSION,
    tokensAnalyzed: tokenized.charCount,
    elapsedMs,
    pgiUsed: options.pgiUsed ?? false,
    crossSpecHints: zhuque.status === "success" && (zhuque.score ?? 0) > 30 ? [{ type: "platform-risk", message: "朱雀评分超过 30%，平台拒稿风险升高。", data: { zhuqueScore: zhuque.score } }] : [],
  };
}

export function summarizeHitCounts(hits: RuleHit[]): Record<string, number> {
  return hitCounts(hits);
}

export { FILTER_RULES };
export type { FilterRule, RuleContext } from "./rules.js";
