import { describe, expect, it } from "vitest";
import { buildPovDashboard } from "../tools/pov/pov-tracker.js";

describe("buildPovDashboard", () => {
  it("tracks multi POV chapter distribution and warning gaps", () => {
    const dashboard = buildPovDashboard({
      characterMatrix: "| 角色 | POV |\n| 林青 | 是 |\n| 苏白 | POV |\n| 路人 | 否 |",
      chapterSummaries: "| 章节 | POV | 摘要 |\n| 1 | 林青 | 入山 |\n| 2 | 苏白 | 追查 |\n| 3 | 林青 | 破局 |",
      currentChapter: 14,
      gapWarningThreshold: 10,
    });

    expect(dashboard.characters).toEqual([
      expect.objectContaining({ name: "林青", totalChapters: 2, lastAppearanceChapter: 3 }),
      expect.objectContaining({ name: "苏白", totalChapters: 1, lastAppearanceChapter: 2 }),
    ]);
    expect(dashboard.warnings.map((warning) => warning.characterName)).toContain("苏白");
  });

  it("returns empty dashboard for single POV books", () => {
    const dashboard = buildPovDashboard({
      characterMatrix: "| 角色 | POV |\n| 林青 | 是 |",
      chapterSummaries: "| 章节 | POV | 摘要 |\n| 1 | 林青 | 入山 |",
      currentChapter: 2,
    });

    expect(dashboard.characters).toEqual([]);
    expect(dashboard.warnings).toEqual([]);
    expect(dashboard.suggestion).toBeUndefined();
  });

  it("suggests the POV with the largest gap", () => {
    const dashboard = buildPovDashboard({
      characterMatrix: "- 林青 #POV\n- 苏白 #POV\n- 周衡 #POV",
      chapterSummaries: "第1章 POV: 林青\n第2章 POV: 苏白\n第6章 POV: 林青",
      currentChapter: 8,
    });

    expect(dashboard.suggestion?.recommendedPov).toBe("周衡");
  });

  it("keeps missing chapter POV characters from crashing statistics", () => {
    const dashboard = buildPovDashboard({
      characterMatrix: "- 林青 #POV\n- 苏白 #POV",
      chapterSummaries: "第1章 POV: 未登记角色\n第2章 POV: 林青",
      currentChapter: 3,
    });

    expect(dashboard.characters.map((character) => character.name)).toEqual(["林青", "苏白"]);
  });
});
