import { describe, expect, it } from "vitest";

import { formatBibleContextForPrompt, mergeBibleContextWithExternalContext } from "../bible/context/pipeline-bridge.js";
import type { BuildBibleContextResult } from "../bible/types.js";

const context: BuildBibleContextResult = {
  mode: "dynamic",
  totalTokens: 18,
  droppedIds: ["old-event"],
  items: [
    {
      id: "setting-1",
      type: "setting",
      category: "power-system",
      name: "修炼体系",
      content: "【设定-power-system】修炼体系：灵根决定修行效率。",
      source: "global",
      priority: 30,
      estimatedTokens: 12,
    },
    {
      id: "char-1",
      type: "character",
      name: "韩立",
      content: "【角色】韩立：谨慎求长生。",
      source: "tracked",
      priority: 10,
      estimatedTokens: 6,
    },
  ],
};

describe("Bible pipeline bridge", () => {
  it("formats Bible context as a bounded prompt block", () => {
    expect(formatBibleContextForPrompt(context)).toBe([
      "# Novel Bible Context",
      "",
      "mode: dynamic",
      "totalTokens: 18",
      "droppedIds: old-event",
      "",
      "【设定-power-system】修炼体系：灵根决定修行效率。",
      "【角色】韩立：谨慎求长生。",
    ].join("\n"));
  });

  it("prepends Bible context before user supplied external context", () => {
    expect(mergeBibleContextWithExternalContext(context, "临时要求：本章节奏快。"))
      .toContain("【角色】韩立：谨慎求长生。\n\n---\n\n临时要求：本章节奏快。");
  });

  it("returns existing context unchanged when no Bible entries are available", () => {
    expect(mergeBibleContextWithExternalContext({ ...context, items: [], droppedIds: [], totalTokens: 0 }, "仅使用用户上下文"))
      .toBe("仅使用用户上下文");
  });
});
