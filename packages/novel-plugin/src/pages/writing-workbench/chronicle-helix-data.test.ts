import { describe, expect, it } from "vitest";

import {
  buildChronicleHelixModel,
  extractChronicleArcEvents,
  extractChronicleBeats,
  findChronicleIntersections,
  pickTopCharacters,
  splitCompositeSubject,
} from "./chronicle-helix-data";

const summaryEntry = (chapterNumber: number, overrides: Record<string, unknown> = {}) => ({
  fields: { chapterNumber, summary: `第${chapterNumber}章摘要。`, tension_score: 5, ...overrides },
  contentMd: `第${chapterNumber}章正文摘要。`,
});

describe("chronicle-helix-data", () => {
  it("extracts beats from chapter-summaries with snake_case tension and drops missing chapter numbers", () => {
    const beats = extractChronicleBeats([
      summaryEntry(3),
      summaryEntry(1, { tension_score: undefined, tensionScore: 7 }),
      { fields: {} },
      { fields: { chapterNumber: "abc" } },
    ]);
    expect(beats.map((beat) => beat.chapterNumber)).toEqual([1, 3]);
    expect(beats[0]?.tensionScore).toBe(7);
    expect(beats[1]?.summary).toContain("第3章");
  });

  it("falls back to 第N章 title parsing when fields and relatedChapterNumbers lack a chapter", () => {
    const beats = extractChronicleBeats([
      { title: "第 12 章 觉醒", summaryMd: "标题回退摘要。" },
      { fields: { chapter_number: 3 }, title: "第99章 干扰标题", summaryMd: "字段优先。" },
      { relatedChapterNumbers: ["x", 7], title: "第 1 章", summaryMd: "关联章号优先于标题。" },
      { title: "没有章号的标题", summaryMd: "应被丢弃。" },
    ]);
    expect(beats.map((beat) => beat.chapterNumber)).toEqual([3, 7, 12]);
    // 字段优先于标题
    expect(beats.find((beat) => beat.chapterNumber === 3)?.summary).toBe("字段优先。");
    // relatedChapterNumbers 优先于标题
    expect(beats.find((beat) => beat.chapterNumber === 7)?.summary).toBe("关联章号优先于标题。");
    // 标题回退命中
    expect(beats.find((beat) => beat.chapterNumber === 12)?.summary).toBe("标题回退摘要。");
  });

  it("prefers summaryMd then contentMd then fields.summary for the beat summary", () => {
    const [onlyContent] = extractChronicleBeats([{ fields: { chapterNumber: 1 }, contentMd: "正文摘要。" }]);
    expect(onlyContent?.summary).toBe("正文摘要。");
    const [onlyFieldSummary] = extractChronicleBeats([{ fields: { chapterNumber: 2, summary: "字段摘要。" } }]);
    expect(onlyFieldSummary?.summary).toBe("字段摘要。");
    const [prefersSummaryMd] = extractChronicleBeats([
      { fields: { chapterNumber: 3, summary: "字段摘要。" }, contentMd: "正文摘要。", summaryMd: "首选摘要。" },
    ]);
    expect(prefersSummaryMd?.summary).toBe("首选摘要。");
  });

  it("T7读侧保险：同章双轨残留时确定性收敛到权威条，不随条目顺序抖动", () => {
    const legacy = { title: "第12章摘要：通道授权", summaryMd: "旧版人工摘要。", relatedChapterNumbers: [12] };
    const canonical = { title: "第12章", fields: { chapterNumber: 12, summary: "权威结算摘要。" } };

    // 无论输入顺序如何，都取带 fields 章号的权威条。
    expect(extractChronicleBeats([legacy, canonical])[0]?.summary).toBe("权威结算摘要。");
    expect(extractChronicleBeats([canonical, legacy])[0]?.summary).toBe("权威结算摘要。");

    // 两个同为非权威（都无 fields）：保留摘要更长者。
    const longLegacy = { title: "第13章摘要：协议裂变", summaryMd: "更长更完整的旧版摘要内容。", relatedChapterNumbers: [13] };
    const shortLegacy = { title: "第13章", summaryMd: "短。", relatedChapterNumbers: [13] };
    const merged = extractChronicleBeats([longLegacy, shortLegacy]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toContain("更长更完整");

    // 权威条张力优先保留。
    const tensioned = extractChronicleBeats([
      legacy,
      { title: "第12章", fields: { chapterNumber: 12, summary: "带张力的权威条。", tension_score: 7 } },
    ]);
    expect(tensioned[0]?.tensionScore).toBe(7);
  });

  it("T1哨兵：tension_score=-1（评分失败）按未评估处理，不进点径与峰值判定", () => {
    const beats = extractChronicleBeats([
      { title: "第12章", fields: { chapterNumber: 12, summary: "评分失败的章节。", tension_score: -1 } },
      { title: "第13章", fields: { chapterNumber: 13, summary: "正常高分章。", tension_score: 9 } },
    ]);
    expect(beats.find((beat) => beat.chapterNumber === 12)?.tensionScore).toBeUndefined();
    expect(beats.find((beat) => beat.chapterNumber === 13)?.tensionScore).toBe(9);

    // 未评估章节不触发张力峰值交叉点。
    const model = buildChronicleHelixModel(
      [{ title: "第12章", fields: { chapterNumber: 12, summary: "评分失败。" }, relatedChapterNumbers: [12] }],
      { events: [] },
    );
    expect(model.strandA.get(12)?.tensionScore).toBeUndefined();
    expect(model.intersections).toHaveLength(0);
  });

  it("splits composite subjects joined by 与/和/、/，/及/跟 into separate names", () => {
    expect(splitCompositeSubject("薛行之与方工")).toEqual(["薛行之", "方工"]);
    expect(splitCompositeSubject("薛行之、方工，韩立")).toEqual(["薛行之", "方工", "韩立"]);
    expect(splitCompositeSubject("薛行之和方工及韩立跟老张")).toEqual(["薛行之", "方工", "韩立", "老张"]);
    // 单主体不拆
    expect(splitCompositeSubject("薛行之")).toEqual(["薛行之"]);
    // 括号内含分隔符视为别名/说明，不拆
    expect(splitCompositeSubject("薛行之（与方工共事）")).toEqual(["薛行之（与方工共事）"]);
    // 空串返回空数组
    expect(splitCompositeSubject("   ")).toEqual([]);
  });

  it("expands composite subject arc events into one event per character sharing the entryId", () => {
    const events = extractChronicleArcEvents({
      events: [
        {
          subject: "薛行之与方工",
          eventType: "relationship_changed",
          chapterNumber: 5,
          subjectEntryId: "entry-pair",
          evidenceText: "两人决裂",
        },
      ],
    });
    expect(events.map((event) => event.characterName)).toEqual(["薛行之", "方工"]);
    expect(events.every((event) => event.entryId === "entry-pair")).toBe(true);
    expect(events.every((event) => event.description === "两人决裂")).toBe(true);
  });

  it("honestly degrades to an empty summary when no summary source exists", () => {
    const beats = extractChronicleBeats([{ fields: { chapterNumber: 5 } }]);
    expect(beats).toHaveLength(1);
    expect(beats[0]?.summary).toBe("");
  });

  it("filters arc events to character/relationship types with subjects and chapters", () => {
    const events = extractChronicleArcEvents({
      events: [
        { subject: "薛行之", eventType: "character_state_changed", chapterNumber: 2, evidenceText: "更加谨慎" },
        { eventType: "world_fact_introduced", subject: "规则", chapterNumber: 3 },
        { subject: "  ", eventType: "character_state_changed", chapterNumber: 4 },
        { subject: "韩立", eventType: "character_state_changed", chapterNumber: Number.NaN },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.characterName).toBe("薛行之");
    expect(events[0]?.description).toBe("更加谨慎");
  });

  it("picks top characters by frequency and carries identity entryIds", () => {
    const arcs = [
      ...Array.from({ length: 3 }, (_, index) => ({ chapterNumber: index + 1, characterName: "薛行之", description: "x", entryId: "entry-a" })),
      { chapterNumber: 1, characterName: "韩立", description: "y" },
    ];
    const top = pickTopCharacters(arcs);
    expect(top[0]).toMatchObject({ name: "薛行之", eventCount: 3, entryId: "entry-a" });
    expect(top[1]?.entryId).toBeUndefined();
  });

  it("marks intersections from conflict facts, high-risk events and tension peaks", () => {
    const beats = [summaryEntry(5, { tension_score: 9 }), summaryEntry(6)];
    const graph = {
      facts: [{ category: "conflict", sourceChapter: 6 }],
      events: [{ subject: "韩立", eventType: "character_state_changed", chapterNumber: 7, riskLevel: "high" }],
    };
    const intersections = findChronicleIntersections(extractChronicleBeats(beats), graph);
    const byChapter = new Map(intersections.map((item) => [item.chapterNumber, item]));
    expect(byChapter.get(5)?.reasons).toEqual(["tension-peak"]);
    expect(byChapter.get(6)?.reasons).toEqual(["conflict-fact"]);
    expect(byChapter.get(7)?.reasons).toEqual(["high-risk"]);
  });

  it("builds the full model with a sorted unified chapter axis", () => {
    const model = buildChronicleHelixModel(
      [summaryEntry(4, { tension_score: 8 }), summaryEntry(1)],
      { events: [{ subject: "薛行之", eventType: "relationship_changed", chapterNumber: 2, subjectEntryId: "e-1", predicate: "结盟", object: "韩立" }] },
    );
    expect(model.chapters).toEqual([1, 2, 4]);
    expect(model.strandA.get(4)?.tensionScore).toBe(8);
    expect(model.strandB.get(2)?.[0]?.entryId).toBe("e-1");
    expect(model.intersections.map((item) => item.chapterNumber)).toEqual([4]);
  });

  it("degrades honestly on empty inputs", () => {
    const model = buildChronicleHelixModel([], {});
    expect(model.chapters).toEqual([]);
    expect(model.intersections).toEqual([]);
    expect(model.topCharacters).toEqual([]);
  });
});
