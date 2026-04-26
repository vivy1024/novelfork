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
    expect(candidates.map((section) => section.name)).toEqual(["境界体系", "功法", "势力/宗门", "资源/灵材", "法宝/神器", "秘境/副本"]);
    expect(candidates.every((section) => section.fieldsJson.length > 0)).toBe(true);

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

  it("provides required genre-specific recommendation columns", () => {
    expect(getGenreJingweiCandidates("suspense").map((section) => section.name)).toEqual(["线索", "谜团", "误导项", "案件时间线", "真相层"]);
    expect(getGenreJingweiCandidates("romance").map((section) => section.name)).toEqual(["关系变化", "情感节点", "误会与和解", "家庭关系", "人物成长"]);
    expect(getGenreJingweiCandidates("scifi").map((section) => section.name)).toEqual(["科技树", "星图/地理", "组织/阵营", "术语表", "实验记录"]);
    expect(getGenreJingweiCandidates("urban").map((section) => section.name)).toEqual(["职业线", "关系网", "资产/经济", "城市地图", "社会身份"]);
    expect(getGenreJingweiCandidates("history").map((section) => section.name)).toEqual(["时代背景", "历史人物", "朝堂势力", "科技差", "蝴蝶效应"]);
  });
});
