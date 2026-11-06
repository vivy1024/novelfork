import { z } from "zod";

import { StyleFingerprintSchema, type StyleFingerprint } from "./style-preset.js";

/**
 * 多来源蒸馏采纳时的统计指纹合并。
 *
 * 指纹仍只有预设里的一份（唯一权威源）；为了下次采纳能重新加权，各来源的数值指标连同字数
 * 记在指纹自身的 `distilledSources` 上。同一来源再次采纳替换旧记录；指纹被金库自动重算
 * 或手动提取整体替换时，这份记录随之消失，不会两处走样。
 *
 * 加权口径：权重 = 来源正文字数。均值、比例类指标按字数加权平均；句长标准差按合并方差
 * （Σw(σ²+μ²)/Σw − μ̄²）求；样本字数 / 句数与句长分布直方图直接相加。
 */

export const MAX_DISTILLED_FINGERPRINT_SOURCES = 30;

const ContributionSchema = z.object({
  sourceId: z.string().min(1).max(120),
  chars: z.number().finite().nonnegative(),
  metrics: z.record(z.string(), z.number().finite()),
  buckets: z.array(z.number().finite().nonnegative()).max(20).optional(),
});

export type DistilledFingerprintContribution = z.infer<typeof ContributionSchema>;

/** 直接相加的计数类指标。 */
const SUMMED_METRICS = new Set(["sampleCharCount", "sampleSentenceCount"]);
/** 不参与合并的字段（自身记录或别处管理的元数据）。 */
const SKIPPED_KEYS = new Set(["distilledSources", "vaultBasis", "sentenceLengthBuckets"]);

export function readDistilledSources(fingerprint: StyleFingerprint | null | undefined): DistilledFingerprintContribution[] {
  const raw = (fingerprint as Record<string, unknown> | null | undefined)?.distilledSources;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = ContributionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function fingerprintContribution(
  sourceId: string,
  chars: number,
  fingerprint: Readonly<Record<string, unknown>>,
): DistilledFingerprintContribution {
  const metrics = Object.fromEntries(Object.entries(fingerprint)
    .filter((pair): pair is [string, number] => !SKIPPED_KEYS.has(pair[0]) && typeof pair[1] === "number" && Number.isFinite(pair[1])));
  const buckets = Array.isArray(fingerprint.sentenceLengthBuckets)
    && fingerprint.sentenceLengthBuckets.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
    ? fingerprint.sentenceLengthBuckets as number[]
    : undefined;
  return { sourceId, chars: Math.max(0, chars), metrics, ...(buckets ? { buckets: buckets.slice(0, 20) } : {}) };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 按字数加权合并多份来源指标；全部权重为 0 时按等权。 */
export function mergeFingerprintContributions(contributions: readonly DistilledFingerprintContribution[]): Record<string, unknown> {
  const totalChars = contributions.reduce((sum, item) => sum + item.chars, 0);
  const weight = (item: DistilledFingerprintContribution) => totalChars > 0 ? item.chars / totalChars : 1 / contributions.length;
  const keys = [...new Set(contributions.flatMap((item) => Object.keys(item.metrics)))];
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    const present = contributions.filter((item) => key in item.metrics);
    if (SUMMED_METRICS.has(key)) {
      merged[key] = present.reduce((sum, item) => sum + item.metrics[key]!, 0);
      continue;
    }
    const presentWeight = present.reduce((sum, item) => sum + weight(item), 0);
    if (presentWeight <= 0) continue;
    const mean = present.reduce((sum, item) => sum + weight(item) * item.metrics[key]!, 0) / presentWeight;
    merged[key] = round(mean, 3);
  }
  // 句长标准差用合并方差，而不是对各来源的标准差直接取平均。
  const withSpread = contributions.filter((item) => "sentenceLengthStdDev" in item.metrics && "avgSentenceLength" in item.metrics);
  const spreadWeight = withSpread.reduce((sum, item) => sum + weight(item), 0);
  if (spreadWeight > 0) {
    const mean = withSpread.reduce((sum, item) => sum + weight(item) * item.metrics.avgSentenceLength!, 0) / spreadWeight;
    const second = withSpread.reduce((sum, item) => {
      const sd = item.metrics.sentenceLengthStdDev!;
      const mu = item.metrics.avgSentenceLength!;
      return sum + weight(item) * (sd * sd + mu * mu);
    }, 0) / spreadWeight;
    merged.avgSentenceLength = round(mean, 1);
    merged.sentenceLengthStdDev = round(Math.sqrt(Math.max(0, second - mean * mean)), 2);
  }
  const bucketed = contributions.filter((item) => item.buckets);
  if (bucketed.length > 0) {
    const size = Math.max(...bucketed.map((item) => item.buckets!.length));
    merged.sentenceLengthBuckets = Array.from({ length: size }, (_, index) => bucketed.reduce((sum, item) => sum + (item.buckets![index] ?? 0), 0));
  }
  return merged;
}

/**
 * 把一个蒸馏来源的指纹并入预设现有指纹。
 * - 现有指纹带 distilledSources：替换同来源记录后重新加权；
 * - 现有指纹没有记录（手动提取、金库重算、旧版本采纳）：作为一份「既有基线」参与加权，
 *   权重取它的样本字数，拿不到时与新来源等权；
 * - 新来源没有指纹：原样保留现有指纹。
 */
export function mergeDistilledFingerprint(input: {
  readonly existing: StyleFingerprint | null;
  readonly sourceId: string;
  readonly sourceChars: number;
  readonly fingerprint: Readonly<Record<string, unknown>> | null;
}): StyleFingerprint | null {
  if (!input.fingerprint) return input.existing;
  const incoming = fingerprintContribution(input.sourceId, input.sourceChars, input.fingerprint);
  let others = readDistilledSources(input.existing).filter((item) => item.sourceId !== input.sourceId);
  if (input.existing && readDistilledSources(input.existing).length === 0) {
    const sample = (input.existing as Record<string, unknown>).sampleCharCount;
    const chars = typeof sample === "number" && Number.isFinite(sample) && sample > 0 ? sample : incoming.chars;
    others = [fingerprintContribution("existing-baseline", chars, input.existing as Record<string, unknown>)];
  }
  const contributions = [...others, incoming].slice(-MAX_DISTILLED_FINGERPRINT_SOURCES);
  const merged: Record<string, unknown> = contributions.length === 1 ? { ...input.fingerprint } : mergeFingerprintContributions(contributions);
  delete merged.vaultBasis;
  // 合并结果不满足指纹结构（如旧指纹缺必填项）时退回新来源自己的指纹，不写坏预设。
  const parsed = StyleFingerprintSchema.safeParse({ ...merged, distilledSources: contributions });
  if (parsed.success) return parsed.data;
  const fallback = StyleFingerprintSchema.safeParse({ ...input.fingerprint, distilledSources: [incoming] });
  return fallback.success ? fallback.data : input.existing;
}
