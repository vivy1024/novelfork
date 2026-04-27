import { describe, expect, it } from "vitest";
import { detectStyleDrift } from "../tools/import/style-drift-detector.js";
import type { StyleProfile } from "../tools/import/multi-work-style.js";

describe("detectStyleDrift", () => {
  const base: StyleProfile = {
    avgSentenceLength: 20,
    sentenceLengthStdDev: 5,
    vocabularyDiversity: 0.7,
    dialogueRatio: 0.3,
  };

  it("returns ~0 drift for identical profiles", () => {
    const result = detectStyleDrift(base, base);
    expect(result.sentenceLengthDrift).toBe(0);
    expect(result.vocabularyDrift).toBe(0);
    expect(result.overallDrift).toBe(0);
    expect(result.isSignificant).toBe(false);
  });

  it("detects large drift for very different profiles", () => {
    const current: StyleProfile = {
      avgSentenceLength: 40,
      sentenceLengthStdDev: 10,
      vocabularyDiversity: 0.2,
      dialogueRatio: 0.8,
    };
    const result = detectStyleDrift(current, base);
    expect(result.sentenceLengthDrift).toBeGreaterThan(0.3);
    expect(result.vocabularyDrift).toBeGreaterThan(0.3);
    expect(result.overallDrift).toBeGreaterThan(0.3);
    expect(result.isSignificant).toBe(true);
  });

  it("threshold: overallDrift > 0.3 → isSignificant", () => {
    // 小幅偏移
    const slight: StyleProfile = {
      avgSentenceLength: 22,
      sentenceLengthStdDev: 5,
      vocabularyDiversity: 0.68,
      dialogueRatio: 0.3,
    };
    const result = detectStyleDrift(slight, base);
    expect(result.overallDrift).toBeLessThan(0.3);
    expect(result.isSignificant).toBe(false);
  });
});
