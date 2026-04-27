// ---------------------------------------------------------------------------
// Style Drift Detector — 文风漂移检测
// ---------------------------------------------------------------------------

import type { StyleProfile } from "./multi-work-style.js";

export interface DriftResult {
  sentenceLengthDrift: number; // 0-1
  vocabularyDrift: number; // 0-1
  overallDrift: number; // 0-1
  isSignificant: boolean; // > 0.3
}

const SIGNIFICANCE_THRESHOLD = 0.3;

/** 句长权重 */
const WEIGHT_SENTENCE_LENGTH = 0.5;
/** 词汇多样性权重 */
const WEIGHT_VOCABULARY = 0.5;

/**
 * 计算单维度偏差（归一化到 0-1）。
 * 使用 |current - base| / max(base, 1) 并 clamp 到 [0, 1]。
 */
function dimensionDrift(current: number, base: number): number {
  const denominator = Math.max(Math.abs(base), 1);
  return Math.min(1, Math.abs(current - base) / denominator);
}

/**
 * 检测当前文本的 StyleProfile 相对于基准 profile 的文风漂移。
 */
export function detectStyleDrift(current: StyleProfile, base: StyleProfile): DriftResult {
  const sentenceLengthDrift = dimensionDrift(current.avgSentenceLength, base.avgSentenceLength);
  const vocabularyDrift = dimensionDrift(current.vocabularyDiversity, base.vocabularyDiversity);
  const overallDrift =
    WEIGHT_SENTENCE_LENGTH * sentenceLengthDrift + WEIGHT_VOCABULARY * vocabularyDrift;

  return {
    sentenceLengthDrift,
    vocabularyDrift,
    overallDrift,
    isSignificant: overallDrift > SIGNIFICANCE_THRESHOLD,
  };
}
