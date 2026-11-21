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

  it("支持高密度施工控制卡字段（microBeats / infoPayloads / reactionPairs / forbid / engineRole / contractCheck）与 infoAnchors、pinnedMechanismIds 直通", async () => {
    const root = await mkdtemp(join(tmpdir(), "scene-spec-high-density-"));
    try {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "story"), { recursive: true });
      await writeFile(join(root, "book.json"), JSON.stringify({ id: "book-1", chapterWordCount: 3000 }), "utf8");
      await writeFile(
        join(root, "story", "mechanism_cards.json"),
        JSON.stringify({
          schemaVersion: 1,
          cards: [
            {
              id: "mech-pinned-unconfirmed",
              name: "冷门账目套利反杀",
              sourceTitle: "参考甲",
              sourceChapterRange: "第1-3章",
              readerDesire: "看底层主角靠算账翻盘",
              emotionChain: "欠款紧逼 -> 核账抓漏洞 -> 当众结算反杀",
              triggerAndPayoff: "管事催债 -> 亮出折旧率铁证 -> 反扣贪墨帽子",
              abstractSlots: [{ slot: "刚性催款单", roleDescription: "制造限时压力" }],
              forbiddenSourceTerms: [],
              tags: ["算账"],
              status: "needs-review",
              validationStatus: "single_book",
            },
          ],
        }),
        "utf8",
      );

      const highDensityRes = await handleSceneSpec({
        bookId: "book-1",
        bookRoot: root,
        chapterNumber: 6,
        userDirectives: "林舟当堂核对灵田折旧账本反击刘管事",
        skipContextGate: true,
        pinnedMechanismIds: ["mech-pinned-unconfirmed"],
        infoAnchors: ["灵田年折旧率上限 12%", "私账夹页朱砂暗记"],
        sceneSpec: {
          chapter: 6,
          title: "当堂核账",
          wordTarget: 3000,
          engineRole: "payoff",
          contractCheck: { agencyOwner: "林舟", payoffOwner: "林舟" },
          scenes: [
            {
              characters: ["林舟", "刘管事", "执事长老"],
              location: "庶务堂",
              conflict: "刘管事污蔑林舟亏空灵石",
              mood: "压抑→爽快反转",
              outcome: "查实刘管事私吞折旧差额",
              hooks_used: ["旧账残页"],
              hooks_planted: ["黑市买家身份"],
              microBeats: ["刘管事拍桌逼签认罪书", "林舟请长老核验三年折旧率", "翻出夹页朱砂暗记坐实贪墨"],
              infoPayloads: ["外门灵田年折旧率不得超过 12% 的门规条目"],
              reactionPairs: [{ action: "林舟亮出朱砂暗记", reactions: "刘管事脸色惨白失手打翻茶盏；执事长老眼神转冷下令封账" }],
              forbid: ["严禁提前暴露黑市买家真名"],
            },
          ],
          constraints: [],
        },
      });

      expect(highDensityRes.ok).toBe(true);
      if (!highDensityRes.ok) return;
      expect(highDensityRes.data.sceneSpec.engineRole).toBe("payoff");
      expect(highDensityRes.data.sceneSpec.contractCheck).toEqual({ agencyOwner: "林舟", payoffOwner: "林舟" });
      const s0 = highDensityRes.data.sceneSpec.scenes[0]!;
      expect(s0.microBeats).toHaveLength(3);
      expect(s0.infoPayloads).toEqual(["外门灵田年折旧率不得超过 12% 的门规条目"]);
      expect(s0.reactionPairs).toEqual([
        { action: "林舟亮出朱砂暗记", reactions: "刘管事脸色惨白失手打翻茶盏；执事长老眼神转冷下令封账" },
      ]);
      expect(s0.forbid).toEqual(["严禁提前暴露黑市买家真名"]);
      expect(highDensityRes.data.sceneSpec.constraints).toContain("【作者指定信息增量锚点】灵田年折旧率上限 12%");
      expect(highDensityRes.data.sceneSpec.constraints).toContain("【场景1禁区】严禁提前暴露黑市买家真名");
      // 已有 microBeats / infoPayloads 时不再弹低密度提示
      expect(highDensityRes.summary).not.toContain("密度提示：");
      // 作者显式勾选的机制卡即使处于 needs-review 也优先置顶召回
      expect(highDensityRes.data.planningMechanisms?.[0]?.id).toBe("mech-pinned-unconfirmed");

      // 既无 beatBudget 也无 microBeats / infoPayloads 时给出温和密度改进提示且不阻断返回
      const thinRes = await handleSceneSpec({
        bookId: "book-1",
        chapterNumber: 6,
        userDirectives: "林舟当堂核对灵田折旧账本",
        skipContextGate: true,
        sceneSpec: spec(6, "薄蓝图", []),
      });
      expect(thinRes.ok).toBe(true);
      if (thinRes.ok) {
        expect(thinRes.summary).toContain("密度提示：");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("支持场景戏剧引擎字段（sceneMode / valueTurn / expectationGap / entryPoint / infoMode），并对非事件场与平顺期望给出提醒", async () => {
    const rich = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 7,
      userDirectives: "林舟潜入库房核账却撞见管事毁证",
      skipContextGate: true,
      sceneSpec: {
        chapter: 7,
        title: "火焚旧账",
        wordTarget: 3000,
        scenes: [
          {
            characters: ["林舟", "刘管事"],
            location: "后院旧账库",
            conflict: "抢在火势吞没前保住折旧底册",
            mood: "紧张→剧烈反转",
            outcome: "底册被毁但林舟抢下带朱砂指印的封皮",
            hooks_used: ["旧账残页"],
            hooks_planted: ["朱砂指印所属幕后人"],
            sceneMode: "active",
            valueTurn: { from: "隐蔽潜入（占优）", to: "身份暴露（陷入追杀）" },
            expectationGap: { expectation: "趁夜悄然抄完账目脱身", reality: "刘管事早已在库内点火并反锁库门" },
            entryPoint: "跳过翻墙进院过场，直接从火苗舔上账册封皮的瞬间切入",
            infoMode: "irony",
            microBeats: ["火起封门", "抢出半页封皮", "破窗脱身"],
          },
        ],
        constraints: [],
      },
    });
    expect(rich.ok).toBe(true);
    if (!rich.ok) return;
    const s0 = rich.data.sceneSpec.scenes[0]!;
    expect(s0.sceneMode).toBe("active");
    expect(s0.valueTurn).toEqual({ from: "隐蔽潜入（占优）", to: "身份暴露（陷入追杀）" });
    expect(s0.expectationGap?.reality).toContain("点火");
    expect(s0.entryPoint).toContain("火苗");
    expect(s0.infoMode).toBe("irony");
    expect(rich.data.craftFindings).toBeUndefined();

    // 起止价值未变 & 期望与结果相同 → 给出戏剧结构提醒（不阻断）
    const flat = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 8,
      userDirectives: "林舟去集市买了一把新柴刀",
      skipContextGate: true,
      sceneSpec: {
        chapter: 8,
        title: "买刀",
        wordTarget: 3000,
        scenes: [
          {
            characters: ["林舟", "铁匠"],
            location: "集市铁匠铺",
            conflict: "挑一把趁手的柴刀",
            mood: "平静",
            outcome: "买到柴刀离开",
            hooks_used: [],
            hooks_planted: [],
            sceneMode: "active",
            valueTurn: { from: "安全", to: "安全" },
            expectationGap: { expectation: "付钱买到柴刀", reality: "付钱买到柴刀" },
          },
        ],
        constraints: [],
      },
    });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.data.craftFindings?.map((f) => f.code)).toEqual([
      "non-event-value-turn",
      "flat-expectation-gap",
    ]);
    expect(flat.summary).toContain("非事件场");
    expect(flat.summary).toContain("鸿沟");
  });
});
