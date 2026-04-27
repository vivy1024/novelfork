import { describe, expect, it } from "vitest";
import { mergeStyleProfiles, type StyleProfile } from "../tools/import/multi-work-style.js";

describe("mergeStyleProfiles", () => {
  it("returns zeroed profile for empty input", () => {
    const result = mergeStyleProfiles([]);
    expect(result.mergedFrom).toBe(0);
    expect(result.avgSentenceLength).toEqual({ min: 0, max: 0, mean: 0 });
    expect(result.vocabularyDiversity).toEqual({ min: 0, max: 0, mean: 0 });
    expect(result.dialogueRatio).toEqual({ min: 0, max: 0, mean: 0 });
  });

  it("handles single profile", () => {
    const profile: StyleProfile = {
      avgSentenceLength: 18,
      sentenceLengthStdDev: 5,
      vocabularyDiversity: 0.72,
      dialogueRatio: 0.3,
    };
    const result = mergeStyleProfiles([profile]);
    expect(result.mergedFrom).toBe(1);
    expect(result.avgSentenceLength).toEqual({ min: 18, max: 18, mean: 18 });
    expect(result.vocabularyDiversity).toEqual({ min: 0.72, max: 0.72, mean: 0.72 });
    expect(result.dialogueRatio).toEqual({ min: 0.3, max: 0.3, mean: 0.3 });
  });

  it("merges two profiles with correct min/max/mean", () => {
    const profiles: StyleProfile[] = [
      { avgSentenceLength: 15, sentenceLengthStdDev: 4, vocabularyDiversity: 0.6, dialogueRatio: 0.2 },
      { avgSentenceLength: 21, sentenceLengthStdDev: 6, vocabularyDiversity: 0.8, dialogueRatio: 0.4 },
    ];
    const result = mergeStyleProfiles(profiles);
    expect(result.mergedFrom).toBe(2);
    expect(result.avgSentenceLength.min).toBe(15);
    expect(result.avgSentenceLength.max).toBe(21);
    expect(result.avgSentenceLength.mean).toBe(18);
    expect(result.vocabularyDiversity.min).toBe(0.6);
    expect(result.vocabularyDiversity.max).toBe(0.8);
    expect(result.dialogueRatio.min).toBe(0.2);
    expect(result.dialogueRatio.max).toBe(0.4);
    expect(result.dialogueRatio.mean).toBeCloseTo(0.3);
  });
});
