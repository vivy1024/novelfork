import { describe, expect, it } from "vitest";

import { createRuntimeChapterEventExtractor, extractNarrativeEventsFromChapter, parseLLMChapterExtraction } from "./chapter-event-extractor.js";

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

describe("parseLLMChapterExtraction", () => {
  it("reads object payload and mentionedEntities", () => {
    const parsed = parseLLMChapterExtraction(JSON.stringify({
      events: [{ eventType: "location_changed" }],
      mentionedEntities: ["韩立", "药园"],
    }));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.mentionedEntities).toEqual(["韩立", "药园"]);
  });

  it("still accepts a bare event array", () => {
    const parsed = parseLLMChapterExtraction(`[{"eventType":"location_changed"}]`);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.mentionedEntities).toEqual([]);
  });
});

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
    expect(result.mentionedEntities.map((item) => item.name)).toEqual(
      expect.arrayContaining(["韩立", "药园", "小瓶"]),
    );
  });

  it("关系事件的对方写成描述句时保留草案并告警，写成名字时不告警", async () => {
    const content = "薛行之出手救下了野修老四。老四其实就是陈默。";
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      content,
      llmExtractor: async () => [
        { eventType: "relationship_changed", subject: "薛行之", predicate: "救下", object: "陈默", evidenceText: "薛行之出手救下了野修老四", confidence: 0.8, source: "settle" },
        { eventType: "relationship_changed", subject: "薛行之", predicate: "救下", object: "野修『老四』（陈默）：被围攻时出手", evidenceText: "薛行之出手救下了野修老四", confidence: 0.8, source: "settle" },
      ],
    });

    expect(result.drafts).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("不是名字");
    expect(result.warnings[0]).toContain("薛行之 / 救下");
  });

  it("抽取规则要求关系事件的双方都写名字", async () => {
    let systemPrompt = "";
    const extractor = createRuntimeChapterEventExtractor(async ({ messages }) => {
      systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
      return { text: JSON.stringify({ events: [], mentionedEntities: [] }) };
    });
    await extractor(baseInput);

    expect(systemPrompt).toContain("relationship_changed）：subject 与 object 都只写一方的名字");
    expect(systemPrompt).not.toMatch(/状态类变化（[^）]*关系/u);
  });

  it("keeps causedBy refs from the LLM payload", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => [
        { ...baseDrafts[0], causedBy: [] },
        { ...baseDrafts[1], causedBy: ["0", "韩立"] },
      ],
    });
    expect(result.drafts.find((draft) => draft.eventType === "hook_planted")?.causedBy).toEqual(["0", "韩立"]);
  });

  it("accepts hook_triggered drafts from the LLM payload", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => [{
        eventType: "hook_triggered",
        subject: "小瓶",
        predicate: "触发",
        object: "药园试验开始",
        evidenceText: "他发现瓶中绿液能催熟药草",
        confidence: 0.86,
        source: "settle",
      }],
    });
    expect(result.drafts).toEqual([
      expect.objectContaining({ eventType: "hook_triggered", subject: "小瓶", object: "药园试验开始" }),
    ]);
  });

  it("兼容旧数组 payload，并把 LLM 提及并进清单", async () => {
    const result = await extractNarrativeEventsFromChapter({
      ...baseInput,
      llmExtractor: async () => ({
        events: baseDrafts,
        mentionedEntities: ["厉飞雨", "故事主线时间"],
      }),
    });
    expect(result.mentionedEntities.map((item) => item.name)).toEqual(
      expect.arrayContaining(["韩立", "药园", "小瓶", "厉飞雨"]),
    );
    expect(result.mentionedEntities.some((item) => item.name === "故事主线时间")).toBe(false);
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
