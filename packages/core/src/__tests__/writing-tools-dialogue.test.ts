import { describe, expect, it } from "vitest";
import { analyzeDialogue } from "../tools/analysis/dialogue-analyzer.js";

describe("analyzeDialogue", () => {
  it("returns zero ratio for pure narration", () => {
    const result = analyzeDialogue("风从山门外吹来，所有人都低下了头。", "battle");

    expect(result.dialogueWords).toBe(0);
    expect(result.dialogueRatio).toBe(0);
    expect(result.characterDialogue).toEqual([]);
  });

  it("returns full ratio for pure dialogue", () => {
    const result = analyzeDialogue("\"你来了。\"\n\"我来了。\"");

    expect(result.totalWords).toBe(result.dialogueWords);
    expect(result.dialogueRatio).toBe(1);
  });

  it("calculates mixed dialogue ratio", () => {
    const result = analyzeDialogue("林青推门而入。\"你终于来了。\"雨声更急。", "daily");

    expect(result.dialogueRatio).toBeGreaterThan(0);
    expect(result.dialogueRatio).toBeLessThan(1);
    expect(result.referenceRange).toEqual({ min: 0.3, max: 0.5 });
  });

  it("groups dialogue by speaker", () => {
    const result = analyzeDialogue("林青说道：\"先走。\"苏白问道：\"去哪？\"林青冷声道：\"去山门。\"");

    expect(result.characterDialogue).toEqual([
      expect.objectContaining({ name: "林青", lineCount: 2 }),
      expect.objectContaining({ name: "苏白", lineCount: 1 }),
    ]);
  });
});
