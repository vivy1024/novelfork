import { describe, expect, it } from "vitest";

import { inferHookCausalLinks, parseCausedBy, resolveCausedByRefs } from "./causal-resolve.js";

const planted = {
  id: "e-plant",
  chapterNumber: 3,
  eventType: "hook_planted",
  subject: "小瓶",
  predicate: "埋设",
  object: "绿液催熟",
};
const progressed = {
  id: "e-progress",
  chapterNumber: 8,
  eventType: "hook_progressed",
  subject: "小瓶",
  predicate: "推进",
  object: "药园试验",
};
const triggered = {
  id: "e-trigger",
  chapterNumber: 10,
  eventType: "hook_triggered",
  subject: "小瓶",
  predicate: "触发",
  object: "药园试验开始",
};
const resolved = {
  id: "e-resolve",
  chapterNumber: 12,
  eventType: "hook_resolved",
  subject: "小瓶",
  predicate: "揭晓",
  object: "瓶中绿液来历",
};

describe("parseCausedBy", () => {
  it("reads arrays, json strings, and integer indexes", () => {
    expect(parseCausedBy(["小瓶", "小瓶", 0])).toEqual(["小瓶", "0"]);
    expect(parseCausedBy(`["e-plant"]`)).toEqual(["e-plant"]);
    expect(parseCausedBy("韩立")).toEqual(["韩立"]);
    expect(parseCausedBy(null)).toEqual([]);
  });
});

describe("inferHookCausalLinks", () => {
  it("links planted → progressed → resolved on the same hook", () => {
    const links = inferHookCausalLinks([resolved, planted, progressed]);
    expect(links.get("e-progress")).toEqual(["e-plant"]);
    expect(links.get("e-resolve")).toEqual(["e-progress"]);
    expect(links.has("e-plant")).toBe(false);
  });

  it("links planted → triggered → resolved when the trigger condition appears", () => {
    const links = inferHookCausalLinks([resolved, planted, triggered]);
    expect(links.get("e-trigger")).toEqual(["e-plant"]);
    expect(links.get("e-resolve")).toEqual(["e-trigger"]);
  });

  it("does not join different hook subjects", () => {
    const other = { ...progressed, id: "e-other", subject: "禁地" };
    const links = inferHookCausalLinks([planted, other]);
    expect(links.has("e-other")).toBe(false);
  });

  it("does not treat a person name as hook identity", () => {
    const first = { id: "a", chapterNumber: 9, eventType: "hook_planted", subject: "薛行之", object: "预筛查" };
    const second = { id: "b", chapterNumber: 9, eventType: "hook_progressed", subject: "薛行之", object: "驻场体检" };
    expect(inferHookCausalLinks([first, second]).has("b")).toBe(false);
  });
});

describe("resolveCausedByRefs", () => {
  it("resolves same-batch index and unique subject", () => {
    const current = { id: "e2", chapterNumber: 12, eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园" };
    const prior = { id: "e1", chapterNumber: 12, eventType: "character_state_changed", subject: "韩立", predicate: "状态", object: "谨慎" };
    expect(resolveCausedByRefs({
      refs: ["0", "韩立"],
      current,
      batch: [prior, current],
      history: [],
    })).toEqual(["e1"]);
  });

  it("drops refs that do not uniquely match", () => {
    const current = { id: "now", chapterNumber: 4, eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园" };
    expect(resolveCausedByRefs({
      refs: ["不存在的人", "建立按项目结算的七天事故复核协作"],
      current,
      batch: [current],
      history: [],
    })).toEqual([]);
  });
});
