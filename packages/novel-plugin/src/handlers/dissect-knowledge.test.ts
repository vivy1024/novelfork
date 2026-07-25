import { describe, expect, it } from "vitest";

import {
  buildDissectLlmUserPrompt,
  extractKnowledgePack,
  mergeLlmKnowledgePack,
  type DissectSourceChapter,
} from "./dissect-knowledge.js";

const chapters: DissectSourceChapter[] = [
  {
    number: 1,
    title: "第一章 山门",
    content: [
      "韩立冷声道：「青牛镇的事，日后自有分晓。」",
      "他来到黄枫谷，只觉四周寒意逼人。",
      "厉飞雨笑道：「你终究要突破炼气三层。」",
      "殊不知，那枚小瓶暗中改变了他的命运。",
    ].join("\n"),
  },
  {
    number: 2,
    title: "第二章 试炼",
    content: [
      "韩立进入七玄门，与守卫交手。",
      "小瓶的秘密尚未揭开，他并未告诉任何人。",
      "厉飞雨沉声道：「宗门铁律不可违。」",
      "他终于决定隐忍，随即返回洞府。",
    ].join("\n"),
  },
];

describe("extractKnowledgePack", () => {
  it("builds character cards with aliases frequency and role", () => {
    const pack = extractKnowledgePack(chapters);
    expect(pack.characterCards.length).toBeGreaterThan(0);
    const first = pack.characterCards[0]!;
    expect(first.name.length).toBeGreaterThanOrEqual(2);
    expect(first.frequency).toBeGreaterThan(0);
    expect(first.confidence).toBeGreaterThan(0);
    expect(["protagonist", "supporting", "minor", "faction", "unknown"]).toContain(first.role);
  });

  it("classifies world elements into locations factions rules or power systems", () => {
    const pack = extractKnowledgePack(chapters);
    const categories = new Set(pack.worldElements.map((element) => element.category));
    expect(pack.worldElements.length).toBeGreaterThan(0);
    expect(
      categories.has("location") || categories.has("faction") || categories.has("rules") || categories.has("power-system"),
    ).toBe(true);
    for (const element of pack.worldElements) {
      expect(element.sourceChapters.length).toBeGreaterThan(0);
    }
  });

  it("produces event level summaries and traced open hooks", () => {
    const pack = extractKnowledgePack(chapters);
    expect(pack.detailedSummaries.length).toBe(2);
    expect(pack.detailedSummaries[0]!.summary.length).toBeGreaterThan(10);
    expect(pack.openHooks.length).toBeGreaterThan(0);
    for (const hook of pack.openHooks) {
      expect(hook.plantedChapter).toBeGreaterThan(0);
      expect(hook.speculation.length).toBeGreaterThan(0);
    }
    expect(pack.suggestedFocus).toBeTruthy();
  });

  it("derives style hints from prose statistics", () => {
    const pack = extractKnowledgePack(chapters);
    expect(pack.styleHints.tone.length).toBeGreaterThan(0);
    expect(pack.styleHints.formattingRules.length).toBeGreaterThan(0);
  });

  it("keeps flat compatibility fields", () => {
    const pack = extractKnowledgePack(chapters);
    expect(Array.isArray(pack.characters)).toBe(true);
    expect(Array.isArray(pack.locations)).toBe(true);
    expect(Array.isArray(pack.hooks)).toBe(true);
    expect(pack.chapterSummaries.length).toBeGreaterThan(0);
  });
});

describe("buildDissectLlmUserPrompt", () => {
  it("includes heuristic draft chapter body and target json schema", () => {
    const pack = extractKnowledgePack(chapters);
    const prompt = buildDissectLlmUserPrompt({
      heuristic: pack,
      chapters,
      fromChapter: 1,
      toChapter: 2,
      maxChars: 4000,
    });
    expect(prompt).toContain("规则抽取初稿");
    expect(prompt).toContain("第1章");
    expect(prompt).toContain("characterCards");
    expect(prompt).toContain("openHooks");
  });
});

describe("mergeLlmKnowledgePack", () => {
  it("merges valid llm json over the heuristic baseline", () => {
    const base = extractKnowledgePack(chapters);
    const merged = mergeLlmKnowledgePack(base, JSON.stringify({
      characterCards: [{
        name: "韩立",
        aliases: ["韩小子"],
        role: "protagonist",
        identity: "黄枫谷外门弟子",
        relationships: [{ target: "厉飞雨", relation: "挚友" }],
        firstAppearance: 1,
        frequency: 0.9,
        confidence: 0.95,
      }],
      worldElements: [{
        name: "黄枫谷",
        category: "location",
        description: "七玄门附属修炼地",
        sourceChapters: [1],
      }],
      detailedSummaries: [{ number: 2, title: "试炼", summary: "韩立进入七玄门并决定隐忍。", keyEvents: ["与守卫交手"] }],
      openHooks: [{
        description: "小瓶的秘密",
        plantedChapter: 1,
        status: "pending",
        evidence: "小瓶暗中改变命运",
        speculation: "后续可揭示催熟能力",
      }],
      relationshipGraph: [{ source: "韩立", target: "厉飞雨", description: "挚友" }],
      styleHints: { tone: "冷峻克制", customVocabulary: ["炼气"], formattingRules: ["短句为主"] },
      suggestedFocus: "第三章推进小瓶秘密并引出宗门冲突。",
    }));

    expect(merged.characterCards[0]?.name).toBe("韩立");
    expect(merged.characterCards[0]?.relationships[0]?.target).toBe("厉飞雨");
    expect(merged.worldElements.some((element) => element.name === "黄枫谷")).toBe(true);
    expect(merged.openHooks[0]?.speculation).toContain("催熟");
    expect(merged.suggestedFocus).toContain("小瓶秘密");
    expect(merged.styleHints.tone).toBe("冷峻克制");
    expect(merged.notes.join(" ")).toContain("LLM 增补");
  });

  it("falls back to baseline when llm output is not json", () => {
    const base = extractKnowledgePack(chapters);
    const merged = mergeLlmKnowledgePack(base, "抱歉，我无法输出 JSON。");
    expect(merged.characterCards).toEqual(base.characterCards);
    expect(merged.notes.join(" ")).toContain("无法解析");
  });

  it("clamps invalid numeric fields", () => {
    const base = extractKnowledgePack(chapters);
    const merged = mergeLlmKnowledgePack(base, JSON.stringify({
      characterCards: [{ name: "某人", frequency: 5, confidence: -3, firstAppearance: -1 }],
    }));
    const card = merged.characterCards[0]!;
    expect(card.frequency).toBeLessThanOrEqual(1);
    expect(card.confidence).toBeGreaterThanOrEqual(0);
    expect(card.firstAppearance).toBeGreaterThanOrEqual(1);
  });
});
