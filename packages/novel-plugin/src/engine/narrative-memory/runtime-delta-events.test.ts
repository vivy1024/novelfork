import { describe, expect, it } from "vitest";
import type { RuntimeStateDelta } from "@vivy1024/novelfork-core";

import { runtimeDeltaToNarrativeEvents } from "./runtime-delta-events.js";

describe("runtimeDeltaToNarrativeEvents", () => {
  it("converts currentStatePatch, knowledge, timeline, resources and hooks into narrative events", () => {
    const delta: RuntimeStateDelta = {
      chapter: 12,
      currentStatePatch: {
        currentLocation: "药园",
        protagonistState: "韩立保持警惕",
        currentGoal: "确认小瓶能力",
      },
      hookOps: {
        upsert: [{ hookId: "hook-small-bottle", startChapter: 10, type: "小瓶", status: "progressing", lastAdvancedChapter: 12, expectedPayoff: "揭示小瓶能力", notes: "药草成熟" }],
        mention: ["hook-old"],
        resolve: ["hook-resolved"],
        defer: [],
      },
      newHookCandidates: [{ type: "墨大夫怀疑", expectedPayoff: "后续逼问", notes: "墨大夫注意到药草异常" }],
      resourceOps: [{ resourceId: "spirit-herb", name: "灵草", delta: 3, reason: "小瓶催熟" }],
      knowledgeOps: [{ characterId: "韩立", fact: "小瓶能催熟药草", learnedAtChapter: 12, source: "正文" }],
      timelineOp: { chapter: 12, storyTime: "七日后", label: "药园试探", durationFromPrev: "七日", ordinal: 12 },
      subplotOps: [],
      emotionalArcOps: [],
      characterMatrixOps: [],
      notes: [],
    };

    const events = runtimeDeltaToNarrativeEvents({
      bookId: "book-1",
      delta,
      evidenceText: "韩立在药园确认小瓶能催熟药草。",
      now: new Date("2026-06-22T00:00:00.000Z"),
    });

    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "location_changed",
      "character_state_changed",
      "world_fact_introduced",
      "timeline_advanced",
      "hook_progressed",
      "hook_planted",
      "hook_resolved",
    ]));
    expect(events.find((event) => event.subject === "韩立" && event.predicate === "知道")?.object).toBe("小瓶能催熟药草");
    expect(events.find((event) => event.subject === "灵草")?.predicate).toBe("资源变化");
    expect(events.every((event) => event.evidenceText === "韩立在药园确认小瓶能催熟药草。")).toBe(true);
    expect(events.every((event) => event.chapterNumber === 12)).toBe(true);
  });

  it("returns stable event ids and pending risk for world facts", () => {
    const events = runtimeDeltaToNarrativeEvents({
      bookId: "book-1",
      delta: {
        chapter: 12,
        hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
        knowledgeOps: [{ characterId: "韩立", fact: "小瓶能催熟药草", learnedAtChapter: 12, source: "正文" }],
        resourceOps: [],
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
        notes: [],
      },
      evidenceText: "证据",
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toContain("runtime-delta:book-1:12:world_fact_introduced");
    expect(events[0]?.status).toBe("pending");
    expect(events[0]?.riskLevel).toBe("high");
  });
});
