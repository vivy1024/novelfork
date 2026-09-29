import type { StyleDistillationJob, StyleRuleCategory } from "./style-distillation.js";

/**
 * 同书多个来源包的并列比较：共同技法 / 来源差异 / 不应迁移。
 * 纯函数、确定性：只做文本相似度聚类，不调用模型，不写任何文件；结果是派生视图，不落盘。
 */

export interface StyleComparisonSourceInput {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly rules: readonly {
    readonly id: string;
    readonly text: string;
    readonly transfer: "transferable" | "source-only";
    readonly status: "needs-review" | "confirmed";
    readonly category?: StyleRuleCategory;
  }[];
}

export interface StyleComparisonMember {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly ruleId: string;
  readonly text: string;
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
  readonly sources: readonly { readonly sourceId: string; readonly sourceName: string; readonly ruleCount: number }[];
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
}

export const STYLE_COMPARISON_SIMILARITY_THRESHOLD = 0.5;

function normalize(text: string): string {
  return text.replace(/[\s\p{P}\p{S}\d]+/gu, "").toLowerCase();
}

function bigrams(text: string): Map<string, number> {
  const value = normalize(text);
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
  for (const source of sources) {
    for (const rule of source.rules) {
      const item: Item = {
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        ruleId: rule.id,
        text: rule.text,
        status: rule.status,
        category: rule.category ?? "general",
      };
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
    sources: sources.map((source) => ({ sourceId: source.sourceId, sourceName: source.sourceName, ruleCount: source.rules.length })),
    common,
    differences: sources
      .map((source) => ({ sourceId: source.sourceId, sourceName: source.sourceName, rules: unique.get(source.sourceId) ?? [] }))
      .filter((entry) => entry.rules.length > 0),
    nonTransferable,
  };
}

/** 从任务文件取比较输入：同一来源取最新的一次任务（jobs 需按创建时间倒序）。 */
export function comparisonInputsFromJobs(jobs: readonly StyleDistillationJob[]): StyleComparisonSourceInput[] {
  const latest = new Map<string, StyleDistillationJob>();
  for (const job of jobs) if (!latest.has(job.sourceId)) latest.set(job.sourceId, job);
  return [...latest.values()].map((job) => ({
    sourceId: job.sourceId,
    sourceName: job.sourceName,
    rules: job.rules,
  }));
}
