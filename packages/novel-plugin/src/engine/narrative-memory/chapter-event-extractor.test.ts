import { describe, expect, it } from "vitest";

import { extractNarrativeEventsFromChapter } from "./chapter-event-extractor.js";

const baseInput = {
  bookId: "book-1",
  chapterNumber: 12,
  title: "第十二章 药园试探",
  content: [
    "韩立抵达药园，四处打量。",
    "他发现瓶中绿液能催熟药草。",
    "三日后，韩立完成药园试探。",
  ].join("\n"),
};

const baseDrafts = [
  { eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", evidenceText: "韩立抵达药园", confidence: 0.88, source: "settle" },
  { eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "瓶中绿液能催熟药草", evidenceText: "他发现瓶中绿液能催熟药草", confidence: 0.82, source: "settle" },
];

describe("chapter event extractor", () => {
  it("extracts LLM event drafts into validated narrative events", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => baseDrafts,
    });

    expect(result.warnings).toEqual([]);
    expect(result.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", source: "settle" }),
      expect.objectContaining({ eventType: "hook_planted", subject: "小瓶", predicate: "埋设", source: "settle" }),
    ]));
    expect(result.drafts.every((draft) => draft.evidenceText.length > 0)).toBe(true);
  });

  it("merges duplicate drafts within the same chapter", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => [baseDrafts[0], baseDrafts[0]],
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.deduped).toBe(1);
  });

  it("drops invalid LLM drafts without evidence", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => [{
        eventType: "relationship_changed",
        subject: "韩立",
        predicate: "信任",
        object: "厉飞雨",
        evidenceText: "",
        confidence: 0.88,
        source: "settle",
      }],
    });

    expect(result.drafts).toEqual([]);
    expect(result.warnings.join("\n")).toContain("丢弃无效事件草案");
  });

  /**
   * 抽取失败不再降级为规则兜底：错误向上抛，由结算服务转成 failed，
   * agent 看到工具失败后二次调用重试。兜底会把「没抽到」伪装成成功。
   */
  it("propagates LLM extraction failures instead of falling back to rules", async () => {
    await expect(extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => {
        throw new Error("LLM unavailable");
      },
    })).rejects.toThrow("LLM unavailable");
  });

  it("rejects settlement without any LLM extractor", async () => {
    await expect(extractNarrativeEventsFromChapter(baseInput))
      .rejects.toThrow(/没有可用的 LLM 抽取器/u);
  });
});
