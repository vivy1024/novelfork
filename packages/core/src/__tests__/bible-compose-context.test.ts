import { describe, expect, it } from "vitest";

import { composeBibleContext } from "../bible/context/compose-context.js";
import { applyTokenBudget, estimateTokens } from "../bible/context/token-budget.js";
import type { BibleContextItem } from "../bible/types.js";

describe("Bible token budget", () => {
  it("estimates Chinese token usage with the configured rough ratio", () => {
    expect(estimateTokens("一二三四五六七八九十")).toBe(6);
    expect(estimateTokens("")).toBe(0);
  });

  it("keeps higher source priority when token budget overflows", () => {
    const items: BibleContextItem[] = [
      makeItem("tracked-old", "tracked", "可丢弃 tracked", 5, "2026-04-25T01:00:00.000Z"),
      makeItem("nested", "nested", "中等优先 nested", 5, "2026-04-25T01:01:00.000Z"),
      makeItem("global", "global", "最高优先 global", 5, "2026-04-25T01:02:00.000Z"),
      makeItem("tracked-new", "tracked", "较新的 tracked", 5, "2026-04-25T01:03:00.000Z"),
    ];

    const result = applyTokenBudget(items, 15);

    expect(result.items.map((item) => item.id)).toEqual(["global", "nested", "tracked-new"]);
    expect(result.droppedIds).toEqual(["tracked-old"]);
    expect(result.totalTokens).toBe(15);
  });

  it("drops tracked before nested before global until the budget fits", () => {
    const items: BibleContextItem[] = [
      makeItem("global", "global", "global", 6),
      makeItem("nested", "nested", "nested", 6),
      makeItem("tracked", "tracked", "tracked", 6),
    ];

    const result = applyTokenBudget(items, 6);

    expect(result.items.map((item) => item.id)).toEqual(["global"]);
    expect(result.droppedIds).toEqual(["tracked", "nested"]);
  });
});

describe("Bible context composer", () => {
  it("formats items as AI-consumable Chinese structured lines", () => {
    const result = composeBibleContext([
      makeItem("char-1", "global", "谨慎求长生", 4, undefined, "character", "韩立"),
      makeItem("setting-1", "nested", "资源决定突破", 4, undefined, "setting", "修炼体系", "power-system"),
    ], { tokenBudget: 20, mode: "dynamic" });

    expect(result.items.map((item) => item.content)).toEqual([
      "【角色】韩立：谨慎求长生",
      "【设定-power-system】修炼体系：资源决定突破",
    ]);
    expect(result.mode).toBe("dynamic");
    expect(result.totalTokens).toBe(8);
    expect(result.droppedIds).toEqual([]);
  });

  it("sorts by source priority before applying the token budget", () => {
    const result = composeBibleContext([
      makeItem("tracked", "tracked", "tracked", 3),
      makeItem("global", "global", "global", 3),
      makeItem("nested", "nested", "nested", 3),
    ], { tokenBudget: 9, mode: "static" });

    expect(result.items.map((item) => item.id)).toEqual(["global", "nested", "tracked"]);
  });
});

function makeItem(
  id: string,
  source: BibleContextItem["source"],
  rawContent: string,
  estimatedTokens: number,
  updatedAt?: string,
  type: BibleContextItem["type"] = "event",
  name = id,
  category?: string,
): BibleContextItem & { rawContent: string; updatedAt?: Date } {
  return {
    id,
    type,
    category,
    name,
    content: rawContent,
    rawContent,
    priority: 0,
    source,
    estimatedTokens,
    ...(updatedAt ? { updatedAt: new Date(updatedAt) } : {}),
  };
}
