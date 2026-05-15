// ---------------------------------------------------------------------------
// Multi-Work Style — 多作品文风合并
// ---------------------------------------------------------------------------

export interface StyleProfile {
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  vocabularyDiversity: number;
  dialogueRatio: number;
}

export interface RangeStats {
  min: number;
  max: number;
  mean: number;
}

export interface PersonalStyleProfile {
  mergedFrom: number;
  avgSentenceLength: RangeStats;
  vocabularyDiversity: RangeStats;
  dialogueRatio: RangeStats;
}

function rangeOf(values: number[]): RangeStats {
  if (values.length === 0) return { min: 0, max: 0, mean: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { min, max, mean };
}

/**
 * 合并多个作品的 StyleProfile，计算各维度的 min/max/mean 交集范围。
 */
export function mergeStyleProfiles(profiles: StyleProfile[]): PersonalStyleProfile {
  if (profiles.length === 0) {
    return {
      mergedFrom: 0,
      avgSentenceLength: { min: 0, max: 0, mean: 0 },
      vocabularyDiversity: { min: 0, max: 0, mean: 0 },
      dialogueRatio: { min: 0, max: 0, mean: 0 },
    };
  }

  return {
    mergedFrom: profiles.length,
    avgSentenceLength: rangeOf(profiles.map((p) => p.avgSentenceLength)),
    vocabularyDiversity: rangeOf(profiles.map((p) => p.vocabularyDiversity)),
    dialogueRatio: rangeOf(profiles.map((p) => p.dialogueRatio)),
  };
}
