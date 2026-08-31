import { describe, expect, it } from "vitest";

import { derivedCharacterToArcRecord, summarizeArcs } from "./arc-character.js";
import type { DerivedCharacterState } from "@vivy1024/novelfork-core";

function arcRecord(overrides: {
  characterId: string;
  arcType?: string;
  beats?: Array<{ chapter: number; direction: "advance" | "regression" | "neutral" }>;
}) {
  return {
    characterId: overrides.characterId,
    arcType: overrides.arcType ?? "positive-growth",
    startingState: "起点",
    endingState: "终点",
    currentPosition: "中段",
    keyTurningPointsJson: JSON.stringify(
      (overrides.beats ?? []).map((beat) => ({
        chapter: beat.chapter,
        event: `事件${beat.chapter}`,
        change: "变化",
        direction: beat.direction,
      })),
    ),
  };
}

describe("summarizeArcs", () => {
  it("summarizes beat counts and last beat chapter with display names", () => {
    const { items, warnings } = summarizeArcs({
      arcs: [arcRecord({ characterId: "c1", beats: [
        { chapter: 1, direction: "advance" },
        { chapter: 4, direction: "advance" },
      ] })],
      names: new Map([["c1", "韩立"]]),
      currentChapter: 5,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      characterId: "c1",
      characterName: "韩立",
      beatCount: 2,
      lastBeatChapter: 4,
    });
    expect(warnings).toEqual([]);
  });

  it("flags a positive arc with three consecutive regressions", () => {
    const { items, warnings } = summarizeArcs({
      arcs: [arcRecord({ characterId: "c1", beats: [
        { chapter: 1, direction: "regression" },
        { chapter: 2, direction: "regression" },
        { chapter: 3, direction: "regression" },
      ] })],
      names: new Map(),
      currentChapter: 3,
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(items[0]?.warnings.join(" ")).toContain("回退");
  });

  it("flags a stagnant arc past the threshold", () => {
    const { warnings } = summarizeArcs({
      arcs: [arcRecord({ characterId: "c1", beats: [{ chapter: 2, direction: "advance" }] })],
      names: new Map(),
      currentChapter: 20,
      stagnantThreshold: 5,
    });
    expect(warnings.join(" ")).toContain("无弧线推进");
  });

  it("skips stagnation checks when there is no current chapter", () => {
    const { items, warnings } = summarizeArcs({
      arcs: [arcRecord({ characterId: "c1", beats: [{ chapter: 2, direction: "advance" }] })],
      names: new Map(),
      currentChapter: 0,
    });
    expect(warnings).toEqual([]);
    expect(items[0]?.beatCount).toBe(1);
  });

  it("tolerates malformed beat json", () => {
    const { items } = summarizeArcs({
      arcs: [{
        characterId: "c1",
        arcType: "positive-growth",
        startingState: "a",
        endingState: "b",
        currentPosition: "c",
        keyTurningPointsJson: "not-json",
      }],
      names: new Map(),
      currentChapter: 3,
    });
    expect(items[0]?.beatCount).toBe(0);
    expect(items[0]?.lastBeatChapter).toBeNull();
  });
});

describe("derivedCharacterToArcRecord", () => {
  it("turns reduced character deltas into arc beats without jingwei records", () => {
    const character: DerivedCharacterState = {
      characterId: "han-li",
      name: "韩立",
      currentState: "抵达药园",
      knowledge: ["小瓶仍在"],
      firstChapter: 1,
      lastChapter: 12,
      beats: [
        { chapter: 1, state: "入门" },
        { chapter: 12, state: "抵达药园", goal: "确认小瓶" },
      ],
    };
    const record = derivedCharacterToArcRecord(character);
    const { items } = summarizeArcs({
      arcs: [record],
      names: new Map([["han-li", "韩立"]]),
      currentChapter: 12,
    });
    expect(items[0]).toMatchObject({
      id: "character-arc:han-li",
      characterName: "韩立",
      beatCount: 2,
      lastBeatChapter: 12,
      layer: "derived",
    });
  });
});
