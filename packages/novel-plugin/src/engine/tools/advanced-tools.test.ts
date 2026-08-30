import { describe, expect, it } from "vitest";

import { detectArcInconsistency, detectStagnantArc } from "./arcs/character-arc-tracker.js";
import { detectToneDrift, GENRE_TONE_MAP } from "./tone/tone-drift-detector.js";
import type { CharacterArc } from "./arcs/arc-types.js";

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
