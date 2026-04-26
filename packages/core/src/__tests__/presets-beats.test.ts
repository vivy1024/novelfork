import { describe, expect, it } from "vitest";
import { builtinBeatTemplates } from "../presets/beats/index.js";

function ratioSum(templateId: string): number {
  const template = builtinBeatTemplates.find((t) => t.id === templateId);
  if (!template) throw new Error(`Missing template: ${templateId}`);
  return template.beats.reduce((sum, beat) => sum + beat.wordRatio, 0);
}

describe("beat templates", () => {
  it("registers all required beat templates", () => {
    expect(builtinBeatTemplates.map((t) => t.id).sort()).toEqual([
      "chapter-ending-hooks",
      "heros-journey",
      "opening-hooks",
      "save-the-cat",
      "three-act",
    ]);
  });

  it("has correct beat counts", () => {
    expect(builtinBeatTemplates.find((t) => t.id === "heros-journey")?.beats).toHaveLength(17);
    expect(builtinBeatTemplates.find((t) => t.id === "save-the-cat")?.beats).toHaveLength(15);
    expect(builtinBeatTemplates.find((t) => t.id === "three-act")?.beats).toHaveLength(3);
    expect(builtinBeatTemplates.find((t) => t.id === "opening-hooks")?.beats).toHaveLength(12);
    expect(builtinBeatTemplates.find((t) => t.id === "chapter-ending-hooks")!.beats.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps word ratios close to 1", () => {
    for (const template of builtinBeatTemplates) {
      expect(ratioSum(template.id)).toBeCloseTo(1, 2);
    }
  });

  it("requires purpose and emotional tone for every beat", () => {
    for (const template of builtinBeatTemplates) {
      for (const beat of template.beats) {
        expect(beat.purpose.length).toBeGreaterThan(0);
        expect(beat.emotionalTone.length).toBeGreaterThan(0);
      }
    }
  });
});
