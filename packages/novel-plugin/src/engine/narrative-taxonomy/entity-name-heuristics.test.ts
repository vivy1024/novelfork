import { describe, expect, it } from "vitest";

import { looksLikeEntity, looksLikeEventPhrase, splitCompositeName } from "./entity-name-heuristics.js";

describe("entity-name-heuristics", () => {
  it("keeps short character names and drops event phrases", () => {
    expect(looksLikeEntity("薛行之")).toBe(true);
    expect(looksLikeEntity("薛建国")).toBe(true);
    expect(looksLikeEntity("鼻血")).toBe(true);
    expect(looksLikeEntity("自费转诊")).toBe(false);
    expect(looksLikeEntity("指尖电流与异常感知")).toBe(false);
    expect(looksLikeEventPhrase("自费转诊")).toBe(true);
    expect(looksLikeEventPhrase("B-17数据抢救")).toBe(true);
  });

  it("splits composite subjects without treating parenthetical aliases as two people", () => {
    expect(splitCompositeName("薛行之与方工")).toEqual({ names: ["薛行之", "方工"], composite: true });
    expect(splitCompositeName("陈默（权威合并版）")).toEqual({
      names: ["陈默（权威合并版）"],
      composite: false,
    });
  });
});
