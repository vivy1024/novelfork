import { describe, expect, it } from "vitest";
import { analyzeRhythm } from "../tools/analysis/rhythm-analyzer.js";

describe("analyzeRhythm", () => {
  it("flags uniform sentence lengths with low rhythm score", () => {
    const text = "山门静了三息。剑光落在石上。少年没有回头。雨声压住呼吸。";

    const result = analyzeRhythm(text);

    expect(result.sentenceLengths).toHaveLength(4);
    expect(result.rhythmScore).toBeLessThan(60);
    expect(result.issues.some((issue) => issue.type === "uniform-length")).toBe(true);
  });

  it("scores mixed sentence lengths higher and records sentence ranges", () => {
    const text = "停。风从断崖下卷上来，带着潮湿的铁锈味，吹得火把一阵乱晃。林青笑了。下一刻，他拔剑。";

    const result = analyzeRhythm(text);

    expect(result.rhythmScore).toBeGreaterThan(60);
    expect(result.sentenceRanges.length).toBeGreaterThanOrEqual(4);
    expect(result.sentenceRanges[0]?.start).toBe(0);
    expect(result.sentenceRanges.every((range) => range.end > range.start)).toBe(true);
  });

  it("returns safe empty analysis for blank text", () => {
    const result = analyzeRhythm("   \n\n  ");

    expect(result.sentenceLengths).toEqual([]);
    expect(result.sentenceHistogram).toEqual([]);
    expect(result.rhythmScore).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("calculates reference profile deviation", () => {
    const result = analyzeRhythm("短句。很长很长的一句话压下来，让人几乎喘不过气。", {
      avgSentenceLength: 20,
      sentenceLengthStdDev: 8,
      avgParagraphLength: 80,
      paragraphLengthRange: { min: 20, max: 120 },
      vocabularyDiversity: 0.5,
      topPatterns: [],
      rhetoricalFeatures: [],
      analyzedAt: "2026-04-26T00:00:00.000Z",
    });

    expect(result.referenceComparison).toEqual(expect.objectContaining({
      refAvgSentenceLength: 20,
      refStdDev: 8,
    }));
    expect(result.referenceComparison?.deviation).toBeGreaterThanOrEqual(0);
  });
});
