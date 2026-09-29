import { describe, expect, it } from "vitest";

import { buildNarrativeGraph } from "./narrative-graph.js";

describe("buildNarrativeGraph causal chain", () => {
  it("prefers explicit causedBy and marks missingCausality false", () => {
    const graph = buildNarrativeGraph({
      events: [
        { id: "e1", chapterNumber: 3, eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "绿液", evidenceText: "他发现瓶中绿液" },
        { id: "e2", chapterNumber: 8, eventType: "hook_progressed", subject: "小瓶", predicate: "推进", object: "药园试验", evidenceText: "药园试验开始", causedBy: ["e1"] },
        { id: "e3", chapterNumber: 12, eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", evidenceText: "韩立抵达药园" },
      ],
      currentChapter: 12,
    });
    const progressed = graph.causal.find((node) => node.id === "e2");
    expect(progressed?.causes).toEqual(["e1"]);
    expect(progressed?.causeSource).toBe("explicit");
    expect(graph.quality.missingCausality).toBe(false);
    expect(graph.quality.explicitCausalEdges).toBeGreaterThan(0);
  });

  it("links hook planted → progressed even without causedBy", () => {
    const graph = buildNarrativeGraph({
      events: [
        { id: "e1", chapterNumber: 3, eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "绿液" },
        { id: "e2", chapterNumber: 8, eventType: "hook_progressed", subject: "小瓶", predicate: "推进", object: "药园试验" },
      ],
      currentChapter: 8,
    });
    expect(graph.causal.find((node) => node.id === "e2")?.causeSource).toBe("explicit");
    expect(graph.causal.find((node) => node.id === "e2")?.causes).toEqual(["e1"]);
  });
});

describe("buildNarrativeGraph foreshadow CFPG", () => {
  it("derives triggered from applied hook events linked to the jingwei entry", () => {
    const graph = buildNarrativeGraph({
      entries: [
        { id: "entry-bottle", category: "foreshadowing", title: "小瓶", fields: { status: "已埋设", plantedChapter: 3 } },
      ],
      events: [
        { id: "e1", chapterNumber: 3, eventType: "hook_planted", subject: "小瓶", object: "绿液", subjectEntryId: "entry-bottle", status: "applied" },
        { id: "e2", chapterNumber: 8, eventType: "hook_triggered", subject: "小瓶", object: "药园试验开始", subjectEntryId: "entry-bottle", status: "applied" },
      ],
      currentChapter: 12,
    });
    expect(graph.foreshadows).toEqual([
      expect.objectContaining({
        entryId: "entry-bottle",
        label: "小瓶",
        phase: "triggered",
        setupChapter: 3,
        triggerChapter: 8,
        triggerCondition: "药园试验开始",
        dangling: false,
      }),
    ]);
  });

  it("does not turn hook events without a jingwei entry into foreshadows", () => {
    const graph = buildNarrativeGraph({
      events: [
        { id: "e1", chapterNumber: 3, eventType: "hook_planted", subject: "小瓶", object: "绿液", status: "applied" },
      ],
      currentChapter: 12,
    });
    expect(graph.foreshadows).toEqual([]);
  });
});
