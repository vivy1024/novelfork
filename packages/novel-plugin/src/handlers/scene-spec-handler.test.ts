import { describe, expect, it } from "vitest";

import { handleSceneSpec } from "./scene-spec-handler.js";

describe("scene.spec beat budget gate note", () => {
  it("warns that pipeline.write will reject a block-level budget", async () => {
    const result = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 4,
      userDirectives: "让林舟带着账本去找老周求证",
      skipContextGate: true,
      cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
      beatBudget: [
        { summary: "林舟找老周求证转账去向", density: "dense", words: 900, function: "信息揭示" },
      ],
      generateText: async () => ({
        text: JSON.stringify({
          chapter: 4,
          title: "求证",
          wordTarget: 3000,
          scenes: [{
            characters: ["林舟", "老周"],
            location: "老周家",
            conflict: "老周不愿开口",
            mood: "试探→紧绷",
            outcome: "老周透露一个名字",
            hooks_used: ["4800 元去向"],
            hooks_planted: [],
          }],
          constraints: [],
        }),
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain("beat-budget-invalid");
    expect(result.data.beatBudget?.ok).toBe(false);
  });

  it("stays silent about the gate when the budget is compliant", async () => {
    const result = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 5,
      userDirectives: "让林舟在雨夜跟踪那辆送货三轮车",
      skipContextGate: true,
      cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
      beatBudget: [
        { summary: "林舟发现三轮车绕开主路", density: "normal", words: 900, function: "铺垫" },
        { summary: "雨中跟丢又重新咬住", density: "dense", words: 1200, function: "冲突升级" },
        { summary: "停在废弃仓库门口", density: "dense", words: 900, function: "信息揭示" },
      ],
      generateText: async () => ({
        text: JSON.stringify({
          chapter: 5,
          title: "雨夜",
          wordTarget: 3000,
          scenes: [{
            characters: ["林舟"],
            location: "城南旧巷",
            conflict: "跟踪与被发现的风险",
            mood: "紧绷→压抑",
            outcome: "锁定一处废弃仓库",
            hooks_used: [],
            hooks_planted: ["废弃仓库里的人"],
          }],
          constraints: [],
        }),
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).not.toContain("beat-budget-invalid");
    expect(result.data.beatBudget?.ok).toBe(true);
  });
});
