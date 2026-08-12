import { describe, expect, it } from "vitest";
import { handleSceneSpec } from "./scene-spec-handler.js";

const spec = (chapter: number, title: string, beatBudget: unknown) => ({
  chapter,
  title,
  wordTarget: 3000,
  beatBudget,
  scenes: [{
    characters: ["林舟"],
    location: "城南旧巷",
    conflict: "跟踪与被发现的风险",
    mood: "紧绷→压抑",
    outcome: "锁定废弃仓库",
    hooks_used: [],
    hooks_planted: [],
  }],
  constraints: [],
});

describe("scene.spec deterministic contract", () => {
  it("校验并提示不合规的 beatBudget", async () => {
    const result = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 4,
      userDirectives: "让林舟带着账本去找老周求证",
      skipContextGate: true,
      cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
      sceneSpec: spec(4, "求证", [{ summary: "信息揭示", density: "dense", words: 900 }]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain("beat-budget-invalid");
    expect(result.data.beatBudget?.ok).toBe(false);
  });

  it("接受合规蓝图且不调用模型", async () => {
    const result = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 5,
      userDirectives: "让林舟在雨夜跟踪三轮车",
      skipContextGate: true,
      cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
      sceneSpec: spec(5, "雨夜", [
        { summary: "铺垫", density: "normal", words: 900 },
        { summary: "冲突升级", density: "dense", words: 1200 },
        { summary: "信息揭示", density: "dense", words: 900 },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.beatBudget?.ok).toBe(true);
  });
});
