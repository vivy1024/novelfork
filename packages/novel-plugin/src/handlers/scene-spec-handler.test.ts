import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("scene.spec word target", () => {
  it("没有 cockpitSnapshot 时按 bookRoot/book.json 的 chapterWordCount 定目标，不回落硬编码 3000", async () => {
    // 真模型实测：Runtime 派发 scene.spec 只带 bookRoot，不带 cockpitSnapshot；
    // 之前直接回落 3000，2200 字的书被报「目标 3000」，模型只好去书目录里翻来源。
    const root = await mkdtemp(join(tmpdir(), "scene-spec-word-"));
    try {
      await writeFile(join(root, "book.json"), JSON.stringify({ id: "book-1", chapterWordCount: 2200 }), "utf8");
      const result = await handleSceneSpec({
        bookId: "book-1",
        chapterNumber: 1,
        userDirectives: "林舟在镇口听见青铜铃白日自鸣",
        skipContextGate: true,
        bookRoot: root,
        sceneSpec: { ...spec(1, "白日铃", []), wordTarget: 2200 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.summary).toContain("目标 2200 字");
      expect(result.summary).not.toContain("3000");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
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

  it("记录点名实体，供 write profile 超上限时定向保留", async () => {
    const result = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 5,
      userDirectives: "让林舟在雨夜跟踪三轮车，并盯紧账本线索",
      skipContextGate: true,
      cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
      namedEntities: ["账本"],
      sceneSpec: spec(5, "雨夜", [
        { summary: "铺垫", density: "normal", words: 900 },
        { summary: "冲突升级", density: "dense", words: 1200 },
        { summary: "信息揭示", density: "dense", words: 900 },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.namedEntities).toEqual(expect.arrayContaining(["账本", "林舟"]));
    expect(result.summary).toContain("点名实体");
  });

  it("留白：合法条目原样透传，非法条目剔除而不让蓝图失败", async () => {
    const base = spec(5, "雨夜", [
      { summary: "铺垫", density: "normal", words: 900 },
      { summary: "冲突", density: "dense", words: 1200 },
      { summary: "揭示", density: "dense", words: 900 },
    ]);
    const withGaps = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          gaps: [
            { kind: "motivation", gap: "林舟为什么这次没有当场追上去", answer: "他看到账本上的旧编号，先回家核实" },
            { kind: "detail", gap: "三轮车停在了哪一侧", answer: "靠墙的阴影里" },
            { kind: "unknown-kind", gap: "x", answer: "y" },
            { kind: "pacing", gap: "", answer: "空 gap 剔除" },
          ],
        },
      ],
    };
    const result = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 5,
      userDirectives: "让林舟在雨夜跟踪三轮车",
      skipContextGate: true,
      cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
      sceneSpec: withGaps,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gaps = result.data.sceneSpec.scenes[0]!.gaps;
    expect(gaps).toEqual([
      { kind: "motivation", gap: "林舟为什么这次没有当场追上去", answer: "他看到账本上的旧编号，先回家核实" },
      { kind: "detail", gap: "三轮车停在了哪一侧", answer: "靠墙的阴影里" },
    ]);
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
