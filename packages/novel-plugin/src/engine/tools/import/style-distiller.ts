/**
 * 文风指纹蒸馏（纯统计，0 LLM）。
 *
 * 输入作者选定的参考样文，输出可作为本书基线的 `StyleProfile`。它写入
 * `story/style_profile.json` —— 那是文风指纹的唯一权威源，节奏分析
 * (`analyzeRhythm`) 与漂移检测 (`detectStyleDrift`) 都读同一份文件。
 *
 * 只提取可复用的语言统计特征。样文里的专名、人物口癖和具体情节**不进指纹**：
 * 那些属于来源绑定内容，混进基线会污染当前作品。
 */

import { bigramTypeTokenRatio, burstiness, stdDev } from "../../filter/engine/tokenizer.js";
import type { StyleProfile } from "./multi-work-style.js";

/**
 * 蒸馏产物。前 4 个字段与 `StyleProfile` 同构，因此可直接作为
 * `detectStyleDrift` 的基线；其余字段是额外的可复用节奏信息。
 */
export interface DistilledStyleProfile extends StyleProfile {
  /** 爆发度：越接近 -1 越均质（AI 特征），大于 0 表示长短错落。 */
  readonly sentenceLengthBurstiness: number;
  readonly shortSentenceRatio: number;
  readonly longSentenceRatio: number;
  readonly avgParagraphLength: number;
  readonly weakAdverbPer1000: number;
  readonly sampleCharCount: number;
  readonly sampleSentenceCount: number;
  /**
   * 句长分布直方图，按 `SENTENCE_LENGTH_BUCKETS` 的六档计数。
   *
   * 爆发度是一个标量，看不出「均质在哪一档」。直方图能让作者一眼分辨
   * 「全挤在 11-15 字」和「两头分布」——两者爆发度可能接近，读感完全不同。
   */
  readonly sentenceLengthBuckets: readonly number[];
}

/** 句长直方图分档上界（最后一档为 Infinity）。 */
export const SENTENCE_LENGTH_BUCKETS: readonly { readonly label: string; readonly max: number }[] = [
  { label: "≤5", max: 5 },
  { label: "6-10", max: 10 },
  { label: "11-15", max: 15 },
  { label: "16-20", max: 20 },
  { label: "21-30", max: 30 },
  { label: "31+", max: Number.POSITIVE_INFINITY },
];

function bucketize(lengths: readonly number[]): number[] {
  const buckets = SENTENCE_LENGTH_BUCKETS.map(() => 0);
  for (const length of lengths) {
    const index = SENTENCE_LENGTH_BUCKETS.findIndex((bucket) => length <= bucket.max);
    buckets[index === -1 ? buckets.length - 1 : index] += 1;
  }
  return buckets;
}

const SENTENCE_SPLIT = /[。！？…!?]+/u;
const DIALOGUE_PATTERN = /[“"「][^”"」]+[”"」]/gu;
const WEAK_ADVERBS = ["缓缓", "微微", "轻轻", "淡淡"];

function sentencesOf(text: string): string[] {
  return text.split(SENTENCE_SPLIT).map((part) => part.trim()).filter((part) => part.length > 0);
}

function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

/** 从参考样文提取可复用的文风统计指纹。 */
export function distillStyleProfile(samples: readonly string[]): DistilledStyleProfile {
  const text = samples.join("\n\n");
  const sentences = sentencesOf(text);
  const lengths = sentences.map((sentence) => sentence.length);
  const paragraphs = paragraphsOf(text);

  const dialogueMatches = [...text.matchAll(DIALOGUE_PATTERN)];
  const dialogueChars = dialogueMatches.reduce((sum, match) => sum + match[0].length, 0);
  const weakAdverbHits = WEAK_ADVERBS.reduce((sum, term) => sum + countOccurrences(text, term), 0);

  return {
    avgSentenceLength: round(mean(lengths), 1),
    sentenceLengthStdDev: round(stdDev(lengths), 2),
    // 爆发度是与 AI 检测同源的指标：越接近 -1 越均质。
    sentenceLengthBurstiness: round(burstiness(lengths)),
    shortSentenceRatio: round(lengths.length === 0 ? 0 : lengths.filter((length) => length <= 8).length / lengths.length),
    longSentenceRatio: round(lengths.length === 0 ? 0 : lengths.filter((length) => length >= 30).length / lengths.length),
    avgParagraphLength: round(mean(paragraphs.map((paragraph) => paragraph.length)), 1),
    dialogueRatio: round(text.length === 0 ? 0 : dialogueChars / text.length),
    vocabularyDiversity: round(bigramTypeTokenRatio(text)),
    weakAdverbPer1000: round(text.length === 0 ? 0 : (weakAdverbHits / text.length) * 1000, 2),
    sampleCharCount: text.length,
    sampleSentenceCount: sentences.length,
    sentenceLengthBuckets: bucketize(lengths),
  };
}
