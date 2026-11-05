import type { StyleDistillationJob, StyleRuleCategory } from "./style-distillation.js";
import { normalizeEvidenceForMatch } from "./style-distillation-normalize.js";

/**
 * 同书多个来源包的并列比较：共同技法 / 来源差异 / 不应迁移。
 * 纯函数、确定性：只做文本相似度聚类，不调用模型，不写任何文件；结果是派生视图，不落盘。
 *
 * 判定规则：
 * - 确定性统计生成的基线规则（isBaselineRule）不参与合并，连同统计指纹按来源并列在 statistics；
 * - 作品专属（source-only）条目一律进「不应迁移」，不参与聚类；
 * - 可迁移条目只在「不同来源、同一类别」之间按归一后文本相似度连边（并查集），
 *   一个簇覆盖 ≥2 个来源 → 「共同技法」；否则按来源进「来源差异」。
 * 每个成员都带 jobId / ruleId / 证据 / 来源名，界面据此展示出处并按原任务采纳。
 */

export interface StyleComparisonSourceInput {
  readonly sourceId: string;
  readonly sourceName: string;
  /** 该来源被比较的那次任务；采纳时按它调用现有采纳接口。 */
  readonly jobId?: string;
  /** 该任务上次采纳时点名的条目，界面据此初始化选择，避免重新采纳时丢掉旧选择。 */
  readonly adoptedRuleIds?: readonly string[];
  readonly adoptedSampleIds?: readonly string[];
  readonly rules: readonly {
    readonly id: string;
    readonly text: string;
    readonly evidence?: string;
    readonly transfer: "transferable" | "source-only";
    readonly status: "needs-review" | "confirmed";
    readonly category?: StyleRuleCategory;
    /** baseline：确定性统计生成；model：模型抽取。旧任务文件没有此字段，那时只有基线规则。 */
    readonly origin?: "baseline" | "model";
  }[];
  /** 该来源的统计指纹（数值字段并列展示，不参与合并）。 */
  readonly fingerprint?: Readonly<Record<string, unknown>> | null;
}

export interface StyleComparisonMember {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly jobId: string | null;
  readonly ruleId: string;
  readonly text: string;
  readonly evidence: string;
  readonly status: "needs-review" | "confirmed";
}

export interface StyleComparisonGroup {
  readonly category: StyleRuleCategory;
  /** 组内最短的一条作为代表文案。 */
  readonly text: string;
  readonly sourceIds: readonly string[];
  readonly members: readonly StyleComparisonMember[];
}

export interface StyleSourceComparison {
  readonly sources: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly jobId: string | null;
    readonly ruleCount: number;
    readonly adoptedRuleIds: readonly string[];
    readonly adoptedSampleIds: readonly string[];
  }[];
  /** 相似度判定用的阈值，随结果返回，便于界面与排查对照。 */
  readonly threshold: number;
  /** 至少两个来源都出现的可迁移技法。 */
  readonly common: readonly StyleComparisonGroup[];
  /** 只在单个来源出现的可迁移技法，按来源分列。 */
  readonly differences: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly rules: readonly (StyleComparisonMember & { readonly category: StyleRuleCategory })[];
  }[];
  /** 标为作品专属的条目：只作证据，不应进入本书指南。 */
  readonly nonTransferable: readonly (StyleComparisonMember & { readonly category: StyleRuleCategory })[];
  /**
   * 各来源统计对比：每个来源的统计指纹数值与确定性基线规则，按来源原样并列，不合并、不下结论。
   * 基线规则的文案由统计数值套模板生成，去掉数字后几乎一样，按文本相似度合并会把
   * 「对话约占 0%」和「对话约占 19%」当成同一条技法，所以不进上面三组。
   */
  readonly statistics: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly jobId: string | null;
    readonly metrics: Readonly<Record<string, number>>;
    readonly baselineRules: readonly (StyleComparisonMember & { readonly category: StyleRuleCategory })[];
  }[];
}

/**
 * 「同一条技法」的相似度下限（字符二元组 Dice 系数，取值 0–1）。取 0.4 的理由（实测见
 * style-distillation-compare.test.ts 的「阈值标定样例」）：
 * - 同一技法的不同说法：只差补充的约 0.9（「…开场，先写冷和湿」/「…开场，先写冷」0.92），
 *   换近义词的 0.47–0.64（「用一个小动作收住情绪」/「以细小动作收束情绪」0.47）；
 * - 同类别的不同技法共有的多是「对白」「人物」「情绪」这类泛词，实测 0–0.15；
 * - 0.4 在两组之间各留出约 0.07 / 0.25 的余量，偏向不误并：改写幅度很大的同一技法
 *   （如 0.27 的「长段落描写后接一句独立短句收束」/「长段描写之后用一句短句单独成段收住」）
 *   会留在「来源差异」由作者判断，而不是把两条不同技法并成「共同技法」；
 * - 只在同类别、不同来源之间比较，已排除大部分偶然相似。
 */
export const STYLE_COMPARISON_SIMILARITY_THRESHOLD = 0.4;

/**
 * 相似度比较用的归一：先走证据比对同一套逐字归一（引号/全角/大小写/常见繁简），
 * 再去掉标点、符号与数字——它们不承载技法含义，只会拉低短句的重合度。
 */
export function normalizeStyleRuleText(text: string): string {
  return normalizeEvidenceForMatch(text).replace(/[\p{P}\p{S}\d]+/gu, "");
}

function bigrams(text: string): Map<string, number> {
  const value = normalizeStyleRuleText(text);
  const grams = new Map<string, number>();
  if (value.length === 1) grams.set(value, 1);
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** 字符二元组 Dice 系数，适合中文短句的近似匹配。 */
export function styleRuleSimilarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  const sizeA = [...a.values()].reduce((sum, count) => sum + count, 0);
  const sizeB = [...b.values()].reduce((sum, count) => sum + count, 0);
  if (sizeA === 0 || sizeB === 0) return 0;
  let overlap = 0;
  for (const [gram, count] of a) overlap += Math.min(count, b.get(gram) ?? 0);
  return (2 * overlap) / (sizeA + sizeB);
}

export function compareStyleSources(
  inputs: readonly StyleComparisonSourceInput[],
  threshold = STYLE_COMPARISON_SIMILARITY_THRESHOLD,
): StyleSourceComparison {
  // 同一来源多次出现时只保留第一份，避免同源重复被误判为「共同技法」。
  const seen = new Set<string>();
  const sources = inputs.filter((source) => {
    if (seen.has(source.sourceId)) return false;
    seen.add(source.sourceId);
    return true;
  });

  type Item = StyleComparisonMember & { readonly category: StyleRuleCategory };
  const transferable: Item[] = [];
  const nonTransferable: Item[] = [];
  const baselineBySource = new Map<string, Item[]>();
  for (const source of sources) {
    for (const rule of source.rules) {
      const item: Item = {
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        jobId: source.jobId ?? null,
        ruleId: rule.id,
        text: rule.text,
        evidence: rule.evidence ?? "",
        status: rule.status,
        category: rule.category ?? "general",
      };
      if (isBaselineRule(rule)) {
        baselineBySource.set(source.sourceId, [...(baselineBySource.get(source.sourceId) ?? []), item]);
        continue;
      }
      (rule.transfer === "transferable" ? transferable : nonTransferable).push(item);
    }
  }

  // 并查集：只在不同来源、同一类别之间按相似度连边。
  const parent = transferable.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  for (let i = 0; i < transferable.length; i += 1) {
    for (let j = i + 1; j < transferable.length; j += 1) {
      const left = transferable[i]!;
      const right = transferable[j]!;
      if (left.sourceId === right.sourceId || left.category !== right.category) continue;
      if (styleRuleSimilarity(left.text, right.text) >= threshold) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, Item[]>();
  transferable.forEach((item, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) ?? []), item]);
  });

  const common: StyleComparisonGroup[] = [];
  const unique = new Map<string, Item[]>();
  for (const members of clusters.values()) {
    const sourceIds = [...new Set(members.map((member) => member.sourceId))];
    if (sourceIds.length >= 2) {
      const representative = [...members].sort((a, b) => a.text.length - b.text.length || a.text.localeCompare(b.text))[0]!;
      common.push({
        category: representative.category,
        text: representative.text,
        sourceIds,
        members: members.map(({ category: _category, ...member }) => member),
      });
    } else {
      for (const member of members) unique.set(member.sourceId, [...(unique.get(member.sourceId) ?? []), member]);
    }
  }
  common.sort((a, b) => b.sourceIds.length - a.sourceIds.length || a.category.localeCompare(b.category) || a.text.localeCompare(b.text));

  return {
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      jobId: source.jobId ?? null,
      ruleCount: source.rules.length,
      adoptedRuleIds: [...(source.adoptedRuleIds ?? [])],
      adoptedSampleIds: [...(source.adoptedSampleIds ?? [])],
    })),
    threshold,
    common,
    differences: sources
      .map((source) => ({ sourceId: source.sourceId, sourceName: source.sourceName, rules: unique.get(source.sourceId) ?? [] }))
      .filter((entry) => entry.rules.length > 0),
    nonTransferable,
    statistics: sources.map((source) => ({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      jobId: source.jobId ?? null,
      metrics: numericMetrics(source.fingerprint),
      baselineRules: baselineBySource.get(source.sourceId) ?? [],
    })),
  };
}

/**
 * 确定性统计生成的基线规则以 origin 为准：origin=baseline，或旧任务文件里没有 origin
 * （那时还没有模型批次，规则全部来自基线）。模型规则的类别里没有 general，口径一致。
 */
export function isBaselineRule(rule: { readonly origin?: "baseline" | "model" }): boolean {
  return rule.origin !== "model";
}

/** 只取指纹里的有限数值字段（分布数组等不并列）。 */
function numericMetrics(fingerprint: Readonly<Record<string, unknown>> | null | undefined): Record<string, number> {
  if (!fingerprint) return {};
  return Object.fromEntries(Object.entries(fingerprint)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}

/** 从任务文件取比较输入：同一来源取最新的一次任务（jobs 需按创建时间倒序）。 */
export function comparisonInputsFromJobs(jobs: readonly StyleDistillationJob[]): StyleComparisonSourceInput[] {
  const latest = new Map<string, StyleDistillationJob>();
  for (const job of jobs) if (!latest.has(job.sourceId)) latest.set(job.sourceId, job);
  return [...latest.values()].map((job) => ({
    sourceId: job.sourceId,
    sourceName: job.sourceName,
    jobId: job.jobId,
    adoptedRuleIds: job.adoption?.ruleIds ?? [],
    adoptedSampleIds: job.adoption?.sampleIds ?? [],
    rules: job.rules,
    fingerprint: job.fingerprint,
  }));
}
