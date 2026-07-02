import { describe, expect, it } from "vitest";

import { extractNarrativeEventsFromChapter } from "./chapter-event-extractor.js";

const baseInput = {
  bookId: "book-1",
  chapterNumber: 12,
  title: "第十二章 药园试探",
  content: [
    "【地点】韩立抵达药园",
    "【伏笔】小瓶：韩立发现瓶中绿液能催熟药草",
    "【时间线】三日后：韩立完成药园试探",
    "正文继续。",
  ].join("\n"),
};

describe("chapter event extractor", () => {
  it("extracts structured chapter markers into narrative event drafts", async () => {
    const result = await extractNarrativeEventsFromChapter(baseInput);

    expect(result.warnings).toEqual([]);
    expect(result.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", source: "settle" }),
      expect.objectContaining({ eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "韩立发现瓶中绿液能催熟药草", source: "settle" }),
      expect.objectContaining({ eventType: "timeline_advanced", subject: "时间线", predicate: "三日后", object: "韩立完成药园试探", source: "settle" }),
    ]));
    expect(result.drafts.every((draft) => draft.evidenceText.length > 0)).toBe(true);
  });

  it("merges duplicate drafts within the same chapter", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      content: "【地点】韩立抵达药园\n【地点】韩立抵达药园",
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.deduped).toBe(1);
  });

  it("drops invalid LLM drafts without evidence", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      content: "正文没有结构化标记。",
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

  it("uses rule fallback when LLM extraction fails", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => {
        throw new Error("LLM unavailable");
      },
    });

    expect(result.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "location_changed" })]));
    expect(result.warnings.join("\n")).toContain("LLM 抽取失败");
  });
});
