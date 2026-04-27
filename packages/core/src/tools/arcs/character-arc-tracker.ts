import type { ArcBeat, ArcType, CharacterArc } from "./arc-types.js";

export interface ArcInconsistency {
  readonly characterId: string;
  readonly arcType: ArcType;
  readonly consecutiveRegressions: number;
  readonly regressionBeats: ReadonlyArray<ArcBeat>;
  readonly message: string;
}

export interface StagnantArc {
  readonly characterId: string;
  readonly arcType: ArcType;
  readonly lastBeatChapter: number;
  readonly currentChapter: number;
  readonly stalledChapters: number;
  readonly message: string;
}

/**
 * Detect arc inconsistency: a positive-growth arc with 3+ consecutive regressions is flagged.
 */
export function detectArcInconsistency(arc: CharacterArc): ArcInconsistency | null {
  if (arc.arcType !== "positive-growth") return null;

  let maxConsecutive = 0;
  let currentRun = 0;
  let runStart = 0;

  for (let i = 0; i < arc.beats.length; i++) {
    if (arc.beats[i]!.direction === "regression") {
      if (currentRun === 0) runStart = i;
      currentRun++;
      if (currentRun > maxConsecutive) maxConsecutive = currentRun;
    } else {
      currentRun = 0;
    }
  }

  if (maxConsecutive < 3) return null;

  // Find the last run of regressions with length >= 3
  let lastRunEnd = -1;
  let count = 0;
  for (let i = arc.beats.length - 1; i >= 0; i--) {
    if (arc.beats[i]!.direction === "regression") {
      if (lastRunEnd === -1) lastRunEnd = i;
      count++;
    } else {
      if (count >= 3) break;
      lastRunEnd = -1;
      count = 0;
    }
  }

  const regressionBeats = count >= 3
    ? arc.beats.slice(lastRunEnd - count + 1, lastRunEnd + 1)
    : arc.beats.filter((b) => b.direction === "regression").slice(-maxConsecutive);

  return {
    characterId: arc.characterId,
    arcType: arc.arcType,
    consecutiveRegressions: maxConsecutive,
    regressionBeats,
    message: `角色 ${arc.characterId} 的正向弧线出现连续 ${maxConsecutive} 次回退，可能存在弧线不一致`,
  };
}

/**
 * Detect stagnant arc: no new beat for `threshold` chapters.
 */
export function detectStagnantArc(
  arc: CharacterArc,
  currentChapter: number,
  threshold = 5,
): StagnantArc | null {
  if (arc.beats.length === 0) return null;

  const lastBeatChapter = Math.max(...arc.beats.map((b) => b.chapter));
  const stalledChapters = currentChapter - lastBeatChapter;

  if (stalledChapters < threshold) return null;

  return {
    characterId: arc.characterId,
    arcType: arc.arcType,
    lastBeatChapter,
    currentChapter,
    stalledChapters,
    message: `角色 ${arc.characterId} 已 ${stalledChapters} 章无弧线推进（阈值 ${threshold}）`,
  };
}
