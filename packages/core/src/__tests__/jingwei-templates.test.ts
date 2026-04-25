import { describe, expect, it } from "vitest";

import { applyJingweiTemplate, getGenreJingweiCandidates } from "../jingwei/templates.js";

describe("jingwei templates", () => {
  it("applies blank, basic and enhanced templates without mutating built-ins", () => {
    expect(applyJingweiTemplate({ templateId: "blank" }).sections).toEqual([]);

    const basic = applyJingweiTemplate({ templateId: "basic" });
    expect(basic.sections.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要"]);
    expect(basic.sections.map((section) => section.key)).toEqual(["people", "events", "settings", "chapter-summary"]);
    expect(basic.sections.every((section) => section.enabled && section.showInSidebar && section.participatesInAi)).toBe(true);

    const enhanced = applyJingweiTemplate({ templateId: "enhanced" });
    expect(enhanced.sections.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要", "伏笔", "名场面", "核心记忆"]);
    expect(enhanced.sections.map((section) => section.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    enhanced.sections[0]!.name = "被测试污染的名字";
    expect(applyJingweiTemplate({ templateId: "basic" }).sections[0]!.name).toBe("人物");
  });

  it("builds genre recommendation candidates without forcing every candidate into the applied structure", () => {
    const candidates = getGenreJingweiCandidates("xuanhuan");
    expect(candidates.map((section) => section.name)).toEqual(["境界体系", "功法", "势力", "资源", "法宝", "秘境"]);

    const applied = applyJingweiTemplate({
      templateId: "genre-recommended",
      genre: "xuanhuan",
      selectedSectionKeys: ["power-system", "factions"],
    });

    expect(applied.availableCandidates.map((section) => section.key)).toEqual([
      "power-system",
      "skills",
      "factions",
      "resources",
      "artifacts",
      "secret-realms",
    ]);
    expect(applied.sections.map((section) => section.key)).toEqual(["power-system", "factions"]);
    expect(applied.sections.every((section) => section.sourceTemplate === "genre-recommended:xuanhuan")).toBe(true);
  });
});
