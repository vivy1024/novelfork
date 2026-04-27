import { describe, expect, it } from "vitest";

import type { BibleConflictRecord } from "../bible/types.js";
import { buildConflictMap, detectMainConflictDrift } from "../tools/conflicts/conflict-tracker.js";
import { detectArcInconsistency, detectStagnantArc } from "../tools/arcs/character-arc-tracker.js";
import { detectToneDrift, GENRE_TONE_MAP } from "../tools/tone/tone-drift-detector.js";
import type { CharacterArc } from "../tools/arcs/arc-types.js";

function makeConflict(overrides: Partial<BibleConflictRecord> = {}): BibleConflictRecord {
  return {
    id: "conflict-1",
    bookId: "book-1",
    name: "主线冲突",
    type: "external",
    scope: "global",
    priority: 1,
    protagonistSideJson: JSON.stringify("凡人"),
    antagonistSideJson: JSON.stringify("仙道"),
    stakes: "生死",
    rootCauseJson: "[]",
    evolutionPathJson: JSON.stringify([
      { chapter: 1, state: "latent" },
      { chapter: 5, state: "escalating", trigger: "宗门审判" },
    ]),
    resolutionState: "escalating",
    resolutionChapter: null,
    relatedConflictIdsJson: "[]",
    visibilityRuleJson: JSON.stringify({ type: "global" }),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("conflict-tracker", () => {
  it("buildConflictMap returns entries with dialectic info", () => {
    const conflicts = [makeConflict()];
    const map = buildConflictMap(conflicts);
    expect(map).toHaveLength(1);
    expect(map[0]!.id).toBe("conflict-1");
    expect(map[0]!.dialectic?.rank).toBe("primary");
    expect(map[0]!.dialectic?.sides).toEqual(["凡人", "仙道"]);
    expect(map[0]!.lastAdvancedChapter).toBe(5);
  });

  it("detectMainConflictDrift returns null when within threshold", () => {
    const result = detectMainConflictDrift([makeConflict()], 8, 5);
    expect(result).toBeNull();
  });

  it("detectMainConflictDrift detects drift when stalled >= threshold", () => {
    const result = detectMainConflictDrift([makeConflict()], 12, 5);
    expect(result).not.toBeNull();
    expect(result!.stalledChapters).toBe(7);
    expect(result!.conflictId).toBe("conflict-1");
  });

  it("detectMainConflictDrift ignores resolved conflicts", () => {
    const resolved = makeConflict({ resolutionState: "resolved" });
    const result = detectMainConflictDrift([resolved], 20, 5);
    expect(result).toBeNull();
  });
});

describe("character-arc-tracker", () => {
  const baseArc: CharacterArc = {
    characterId: "char-1",
    arcType: "positive-growth",
    startPoint: "唯唯诺诺",
    endPoint: "心怀天下",
    currentPhase: "觉醒期",
    beats: [
      { chapter: 1, event: "入门", change: "开始", direction: "advance" },
      { chapter: 3, event: "挫折1", change: "退缩", direction: "regression" },
      { chapter: 4, event: "挫折2", change: "再退", direction: "regression" },
      { chapter: 5, event: "挫折3", change: "崩溃", direction: "regression" },
      { chapter: 6, event: "觉醒", change: "反弹", direction: "advance" },
    ],
  };

  it("detectArcInconsistency flags 3 consecutive regressions in positive arc", () => {
    const result = detectArcInconsistency(baseArc);
    expect(result).not.toBeNull();
    expect(result!.consecutiveRegressions).toBe(3);
  });

  it("detectArcInconsistency returns null for non-positive arcs", () => {
    const flatArc: CharacterArc = { ...baseArc, arcType: "flat" };
    expect(detectArcInconsistency(flatArc)).toBeNull();
  });

  it("detectArcInconsistency returns null when < 3 consecutive regressions", () => {
    const arc: CharacterArc = {
      ...baseArc,
      beats: [
        { chapter: 1, event: "a", change: "a", direction: "regression" },
        { chapter: 2, event: "b", change: "b", direction: "regression" },
        { chapter: 3, event: "c", change: "c", direction: "advance" },
      ],
    };
    expect(detectArcInconsistency(arc)).toBeNull();
  });

  it("detectStagnantArc detects stagnation", () => {
    const result = detectStagnantArc(baseArc, 15, 5);
    expect(result).not.toBeNull();
    expect(result!.stalledChapters).toBe(9);
  });

  it("detectStagnantArc returns null when within threshold", () => {
    expect(detectStagnantArc(baseArc, 8, 5)).toBeNull();
  });

  it("detectStagnantArc returns null for empty beats", () => {
    const emptyArc: CharacterArc = { ...baseArc, beats: [] };
    expect(detectStagnantArc(emptyArc, 20, 5)).toBeNull();
  });
});

describe("tone-drift-detector", () => {
  it("GENRE_TONE_MAP has 12 entries", () => {
    expect(Object.keys(GENRE_TONE_MAP)).toHaveLength(12);
  });

  it("detectToneDrift returns low drift for matching tone", () => {
    // Long sentences, few exclamations → 古典意境
    const text = "月光洒落在青石板路上，远处的山峦在薄雾中若隐若现。" +
      "溪水潺潺流过古桥之下，带走了一片片落叶。" +
      "他独自站在亭中，望着远方的天际线，心中涌起一阵莫名的感慨。" +
      "风吹过竹林，发出沙沙的声响，仿佛在诉说着千年的故事。";
    const result = detectToneDrift(text, "古典意境");
    expect(result.declaredTone).toBe("古典意境");
    expect(result.driftScore).toBeLessThanOrEqual(0.5);
  });

  it("detectToneDrift detects significant drift", () => {
    // Short exclamatory sentences → not 古典意境
    const text = "冲啊！杀！快跑！不要停！冲上去！干掉他！太强了！不可能！啊！完了！";
    const result = detectToneDrift(text, "古典意境");
    expect(result.isSignificant).toBe(true);
    expect(result.driftScore).toBeGreaterThan(0.3);
  });

  it("detectToneDrift accepts styleProfile", () => {
    const text = "他走在路上。天很冷。风很大。";
    const result = detectToneDrift(text, "冷峻质朴", {
      avgSentenceLength: 5,
      sentenceLengthStdDev: 2,
      avgParagraphLength: 50,
      paragraphLengthRange: { min: 30, max: 80 },
      vocabularyDiversity: 0.6,
      topPatterns: [],
      rhetoricalFeatures: [],
    });
    expect(result.declaredTone).toBe("冷峻质朴");
    expect(typeof result.driftScore).toBe("number");
  });
});
