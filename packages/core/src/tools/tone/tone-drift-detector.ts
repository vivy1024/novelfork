import type { StyleProfile } from "../../models/style-profile.js";
import type { ToneDriftResult } from "./tone-types.js";

/**
 * Genre → recommended tone mapping (12 genres).
 */
export const GENRE_TONE_MAP: Record<string, string> = {
  xianxia: "古典意境",
  xuanhuan: "热血激昂",
  wuxia: "古典意境",
  urban: "冷峻质朴",
  romance: "细腻温柔",
  scifi: "冷峻质朴",
  history: "厚重沉稳",
  mystery: "悬疑紧张",
  horror: "阴郁压抑",
  comedy: "沙雕轻快",
  military: "铁血刚硬",
  game: "热血激昂",
};

interface TextStats {
  avgSentenceLength: number;
  exclamationRatio: number;
  questionRatio: number;
  dialogueRatio: number;
  shortSentenceRatio: number;
}

function computeTextStats(text: string): TextStats {
  const sentences = text.split(/[。！？…\n]+/).filter((s) => s.trim().length > 0);
  const totalSentences = sentences.length || 1;
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / totalSentences;

  const exclamations = (text.match(/！/g) || []).length;
  const questions = (text.match(/？/g) || []).length;
  const punctuationTotal = (text.match(/[。！？]/g) || []).length || 1;

  const dialogueChars = (text.match(/[""「」『』].*?[""「」『』]/g) || [])
    .reduce((sum, m) => sum + m.length, 0);

  const shortSentences = sentences.filter((s) => s.trim().length <= 10).length;

  return {
    avgSentenceLength,
    exclamationRatio: exclamations / punctuationTotal,
    questionRatio: questions / punctuationTotal,
    dialogueRatio: dialogueChars / (text.length || 1),
    shortSentenceRatio: shortSentences / totalSentences,
  };
}

/** Tone fingerprint: each tone maps to expected statistical ranges. */
const TONE_PROFILES: Record<string, { avgLen: [number, number]; excl: [number, number]; short: [number, number] }> = {
  "古典意境": { avgLen: [18, 35], excl: [0, 0.1], short: [0, 0.25] },
  "冷峻质朴": { avgLen: [10, 22], excl: [0, 0.08], short: [0.2, 0.5] },
  "热血激昂": { avgLen: [8, 20], excl: [0.15, 0.5], short: [0.25, 0.6] },
  "细腻温柔": { avgLen: [15, 30], excl: [0, 0.1], short: [0.05, 0.3] },
  "厚重沉稳": { avgLen: [20, 40], excl: [0, 0.05], short: [0, 0.2] },
  "悬疑紧张": { avgLen: [8, 18], excl: [0.05, 0.2], short: [0.3, 0.6] },
  "阴郁压抑": { avgLen: [15, 30], excl: [0, 0.05], short: [0.1, 0.3] },
  "沙雕轻快": { avgLen: [6, 16], excl: [0.2, 0.5], short: [0.35, 0.7] },
  "铁血刚硬": { avgLen: [8, 20], excl: [0.1, 0.3], short: [0.25, 0.55] },
  "悲苦孤独": { avgLen: [15, 35], excl: [0, 0.05], short: [0.05, 0.25] },
};

function computeDrift(stats: TextStats, declaredTone: string, styleProfile?: StyleProfile): number {
  const profile = TONE_PROFILES[declaredTone];
  if (!profile) return 0;

  let drift = 0;
  let factors = 0;

  // Average sentence length deviation
  const [minLen, maxLen] = profile.avgLen;
  if (stats.avgSentenceLength < minLen) {
    drift += (minLen - stats.avgSentenceLength) / minLen;
  } else if (stats.avgSentenceLength > maxLen) {
    drift += (stats.avgSentenceLength - maxLen) / maxLen;
  }
  factors++;

  // Exclamation ratio deviation
  const [minExcl, maxExcl] = profile.excl;
  if (stats.exclamationRatio < minExcl) {
    drift += (minExcl - stats.exclamationRatio);
  } else if (stats.exclamationRatio > maxExcl) {
    drift += (stats.exclamationRatio - maxExcl);
  }
  factors++;

  // Short sentence ratio deviation
  const [minShort, maxShort] = profile.short;
  if (stats.shortSentenceRatio < minShort) {
    drift += (minShort - stats.shortSentenceRatio);
  } else if (stats.shortSentenceRatio > maxShort) {
    drift += (stats.shortSentenceRatio - maxShort);
  }
  factors++;

  // Style profile comparison (bonus factor)
  if (styleProfile) {
    const refAvg = styleProfile.avgSentenceLength;
    if (refAvg > 0) {
      const deviation = Math.abs(stats.avgSentenceLength - refAvg) / refAvg;
      drift += Math.min(deviation, 1);
      factors++;
    }
  }

  return Math.min(factors > 0 ? drift / factors : 0, 1);
}

function inferDetectedTone(stats: TextStats): string {
  let bestTone = "未知";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [tone, profile] of Object.entries(TONE_PROFILES)) {
    const midLen = (profile.avgLen[0] + profile.avgLen[1]) / 2;
    const midExcl = (profile.excl[0] + profile.excl[1]) / 2;
    const midShort = (profile.short[0] + profile.short[1]) / 2;

    const score =
      Math.abs(stats.avgSentenceLength - midLen) / midLen +
      Math.abs(stats.exclamationRatio - midExcl) +
      Math.abs(stats.shortSentenceRatio - midShort);

    if (score < bestScore) {
      bestScore = score;
      bestTone = tone;
    }
  }

  return bestTone;
}

/**
 * Detect tone drift between chapter text and declared tone.
 * driftScore > 0.3 = significant drift.
 */
export function detectToneDrift(
  chapterText: string,
  declaredTone: string,
  styleProfile?: StyleProfile,
): ToneDriftResult {
  const stats = computeTextStats(chapterText);
  const driftScore = computeDrift(stats, declaredTone, styleProfile);
  const detectedTone = inferDetectedTone(stats);
  const isSignificant = driftScore > 0.3;

  return {
    declaredTone,
    detectedTone,
    driftScore: Math.round(driftScore * 100) / 100,
    driftDirection: detectedTone === declaredTone ? "一致" : `偏向${detectedTone}`,
    isSignificant,
    consecutiveDriftChapters: 0, // Requires cross-chapter state; caller should track
  };
}
