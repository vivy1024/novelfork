import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import { packNarrativeContext } from "../narrative-memory/budget.js";
import { createStyleChannel } from "../narrative-memory/channels/style-channel.js";
import { resolveActiveRegisterOverlays, resolveStyleSceneTypes, selectStyleSamples } from "../narrative-memory/style-samples.js";
import { createStylePresetRouter } from "../../routes/style-preset.js";
import type { RouterContext } from "../../routes/context.js";
import {
  appendRuntimeNegativeOverride,
  consolidateAndSaveStylePreset,
  consolidateStylePresetRules,
  MAX_CONSOLIDATED_STYLE_RULES,
} from "./style-consolidate.js";
import {
  adoptRecommendedStyleDistillation,
  adoptStyleDistillation,
  createStyleDistillationJob,
  runStyleDistillationBatches,
} from "./style-distillation-runner.js";
import { composeStyleGuide, createStylePreset, StylePresetSchema } from "./style-preset.js";
import { loadStylePreset, saveStylePreset } from "./style-preset-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeBookRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nf-style-v2-"));
  roots.push(dir);
  await mkdir(join(dir, "story"), { recursive: true });
  return dir;
}

describe("改造目标 2 & 4：主副分层、语域路由、预算反转、一键采纳范文、规则归约与 L5 负反馈", () => {
  it("向后兼容旧 schemaVersion:1 存档，且超出 1 个 primary_voice 时 superRefine 明确报错", async () => {
    const root = await makeBookRoot();
    // 模拟旧存档（无 role / triggerTags / forbiddenSourceTerms / consolidatedRules / registerGuardrail）
    const legacyJson = {
      schemaVersion: 1,
      name: "旧版存档",
      generalRules: ["少用感叹号"],
      sources: [{
        id: "old-src",
        title: "旧参考书",
        rules: [{ text: "动作紧贴对白", evidence: "第1章", transfer: "transferable", status: "confirmed" }],
        samples: [{ id: "sp-1", sceneType: "dialogue", text: "“走吧。”他提起箱子。", evidence: "第1章", transfer: "transferable", status: "confirmed" }],
      }],
      bookVoice: { tone: "冷峻", narrativeVoice: "第三人称限知", principles: [] },
      fingerprint: null,
    };
    await writeFile(join(root, "story", "style_preset.json"), JSON.stringify(legacyJson), "utf8");
    const loaded = await loadStylePreset(root);
    expect(loaded.preset?.name).toBe("旧版存档");
    expect(loaded.guideText).toContain("动作紧贴对白");
    const tagged = structuredClone(legacyJson);
    Object.assign(tagged.sources[0]!.samples[0]!, { registerTag: "dialogue_banter" });
    expect(StylePresetSchema.parse(tagged).sources[0]?.samples[0]?.registerTag).toBe("dialogue_banter");
    Object.assign(tagged.sources[0]!.samples[0]!, { registerTag: "unknown" });
    expect(StylePresetSchema.safeParse(tagged).success).toBe(false);

    const invalid = createStylePreset();
    invalid.sources = [
      { id: "m1", title: "没钱修什么仙", role: "primary_voice", rules: [], samples: [] },
      { id: "m2", title: "玄鉴仙族", role: "primary_voice", rules: [], samples: [] },
    ];
    const check = StylePresetSchema.safeParse(invalid);
    expect(check.success).toBe(false);
    if (!check.success) {
      expect(check.error.issues.map((i) => i.message).join(" ")).toContain("主文风来源最多只能设 1 个");
    }
  });

  it("双源《没钱》(primary_voice) + 《玄鉴》(register_overlay)：日常算账场景 0 注入《玄鉴》，古籍推演场景精准挂载并保底留锚点", async () => {
    const preset = createStylePreset();
    preset.sources = [
      {
        id: "meiqian",
        title: "没钱修什么仙",
        role: "primary_voice",
        forbiddenSourceTerms: ["张羽", "眼骸", "法骸", "福姬", "昆墟"],
        rules: [
          {
            text: "现代白话贴身算账，灵石收支与身体负荷直接量化落地",
            evidence: "第2章",
            transfer: "transferable",
            status: "confirmed",
            category: "voice",
          },
        ],
        samples: [
          { id: "mq-1", sceneType: "dialogue", text: "“这门吐纳法一个月光营养费就要三千块，练不起。”他合上账本。", evidence: "第2章", transfer: "transferable", status: "confirmed" },
          { id: "mq-2", sceneType: "action", text: "脚掌蹬地，呼吸按节拍卡死在胸腔里，一丝热流硬生生挤过经脉。", evidence: "第3章", transfer: "transferable", status: "confirmed" },
          { id: "mq-3", sceneType: "interiority", text: "穷有穷的练法，先把今天工钱结了再说。", evidence: "第4章", transfer: "transferable", status: "confirmed" },
          { id: "mq-4", sceneType: "general", text: "天还没亮，工地外头的早餐摊已经支起了铁锅。", evidence: "第5章", transfer: "transferable", status: "confirmed" },
        ],
      },
      {
        id: "xuanjian",
        title: "玄鉴仙族",
        role: "register_overlay",
        triggerTags: ["ancient_scripture", "紫府密谈"],
        forbiddenSourceTerms: ["陆江仙", "青池宗", "李通崖", "望月湖"],
        rules: [
          {
            text: "半文言冷峻族志笔法，以天象器物起兴，点到即止",
            evidence: "第8章",
            transfer: "transferable",
            status: "confirmed",
            category: "language",
          },
        ],
        samples: [
          { id: "xj-1", sceneType: "description", text: "残碑篆字漫漶，唯余“太阳明昭，配伍忌阴”八字依稀可辨。", evidence: "第8章", transfer: "transferable", status: "confirmed" },
        ],
      },
    ];

    // 场景 A：日常打工算账对话 -> 《玄鉴》规则和范文全部 0 注入！
    const dailyOverlays = resolveActiveRegisterOverlays(preset, {
      planText: "主角在出租屋核对本月打工账单，与包工头商议预支工钱",
    });
    expect([...dailyOverlays.activeIds]).toEqual([]);

    const dailyGuide = composeStyleGuide(preset, { activeOverlayIds: dailyOverlays.activeIds });
    expect(dailyGuide).toContain("现代白话贴身算账");
    expect(dailyGuide).not.toContain("半文言冷峻族志笔法");
    expect(dailyGuide).not.toContain("玄鉴仙族");

    const dailyChannel = await createStyleChannel().run({
      bookId: "book-dual",
      styleGuideText: composeStyleGuide(preset),
      stylePreset: preset,
      planText: "主角在出租屋核对本月打工账单，与包工头商议预支工钱",
      budgetTokens: 1200,
    });
    const dailyText = dailyChannel.cards.map((c) => c.content).join("\n");
    expect(dailyText).toContain("现代白话贴身算账");
    expect(dailyText).not.toContain("玄鉴仙族");
    expect(dailyText).not.toContain("残碑篆字漫漶");

    // 场景 B：研读道藏残卷推演仙基 -> 命中 ancient_scripture 别名，激活《玄鉴》局部挂载 + 保底选入 1 段《玄鉴》锚点！
    const scriptureChannel = await createStyleChannel().run({
      bookId: "book-dual",
      styleGuideText: composeStyleGuide(preset),
      stylePreset: preset,
      planText: "夜半研读道藏古籍残卷，推演仙基配伍之法",
      budgetTokens: 1200,
    });
    const guideCard = scriptureChannel.cards.find((c) => c.id === "style:style-guide")!;
    expect(guideCard.content).toContain("【局部语域挂载：玄鉴仙族】");
    expect(guideCard.content).toContain("半文言冷峻族志笔法");
    const sampleCards = scriptureChannel.cards.filter((c) => c.tags.includes("style-sample"));
    expect(sampleCards.some((c) => c.id === "style:sample:xuanjian/xj-1")).toBe(true);
    expect(sampleCards[0]!.content).toContain("【原文节奏与笔法锚点（仅学句式节奏，严禁照搬专名）】");
    expect(sampleCards[0]!.priority).toBe(53);
  });

  it("一键采纳自动选入最多 6 段不同场景范文，并自动提取原著高频专名写入 forbiddenSourceTerms", async () => {
    const root = await makeBookRoot();
    const ch1 = [
      "陆江仙在青池宗翻开账册，青池宗的外门灵田今年收成减半。",
      "“这笔灵石不够交差。”陆江仙低声道，青池宗的管事脸色铁青。",
      "陆江仙拔剑格挡，刀锋擦着石柱掠过，火星溅在青池宗大殿阶前。",
      "陆江仙心里盘算着退路，青池宗这潭浑水不能再久留了。",
      "数日后，陆江仙离开青池宗，沿着泥泞山道一路向南赶路。",
    ].join("\n").repeat(6);
    const ch2 = [
      "陆江仙在青池宗后山检视阵盘，夜雾笼罩着青池宗的飞檐与石阶。",
      "“明日便走。”陆江仙收起包裹，再未看青池宗山门一眼。",
    ].join("\n").repeat(6);

    const job = await createStyleDistillationJob({
      bookRoot: root,
      bookId: "book-adopt",
      source: {
        sourceName: "参考仙侠稿",
        chapters: [
          { number: 1, title: "第一章", content: ch1 },
          { number: 2, title: "第二章", content: ch2 },
        ],
      },
      modelAvailable: true,
    });
    expect(job.samples.length).toBeGreaterThan(0);

    const fakeGen: RuntimeTextGenerator = async () => ({
      text: JSON.stringify({
        rules: [{
          category: "dialogue",
          text: "对白简短冷硬，紧接动作反应",
          evidence: "“明日便走。”",
          transfer: "transferable",
          reason: "通用对白节奏",
        }],
      }),
    });
    await runStyleDistillationBatches({ bookRoot: root, jobId: job.jobId, generateText: fakeGen });

    const adopted = await adoptRecommendedStyleDistillation({
      bookRoot: root,
      jobId: job.jobId,
      expectedRevision: null,
    });
    const savedSource = adopted.preset.preset!.sources[0]!;
    expect(savedSource.samples.length).toBeGreaterThan(0);
    expect(savedSource.samples.length).toBeLessThanOrEqual(6);
    expect(savedSource.samples.every((s) => s.status === "confirmed")).toBe(true);
    expect(savedSource.forbiddenSourceTerms).toEqual(expect.arrayContaining(["陆江仙", "青池宗"]));

    // 采纳第二个来源并显式指定 primary_voice 时，原首个来源平滑降级为 register_overlay
    const job2 = await createStyleDistillationJob({
      bookRoot: root,
      bookId: "book-adopt",
      source: {
        sourceName: "新主文风书",
        chapters: [{ number: 1, title: "一", content: "“先算清工钱。”他拍了拍裤腿上的灰。".repeat(30) }],
      },
      modelAvailable: false,
    });
    const switched = await adoptStyleDistillation({
      bookRoot: root,
      jobId: job2.jobId,
      ruleIds: [],
      sampleIds: job2.samples.slice(0, 1).map((s) => s.id),
      role: "primary_voice",
      expectedRevision: adopted.preset.revision,
    });
    const sources = switched.preset.preset!.sources;
    expect(sources.filter((s) => s.role === "primary_voice")).toHaveLength(1);
    expect(sources[0]!.id).toBe(job2.sourceId);
    expect(sources[1]!.role).toBe("register_overlay");
  });

  it("consolidateStylePresetRules 把几十条啰嗦规则与正确废话归约为 ≤12 条正反例铁律，合成指南控制在 ≤900 字", async () => {
    const preset = createStylePreset();
    preset.generalRules = [
      "注意长短句结合",
      "语言生动",
      "描写细腻",
      "账目收支直接写明具体数字，不写模糊的许多钱",
    ];
    const noisyRules = Array.from({ length: 28 }, (_, i) => ({
      text: i % 2 === 0
        ? `人物对话不超过两句就接手头动作（批次变体${i}）`
        : `第${i}种写法：用器物的温度、磨损与重量代替空泛情绪形容词`,
      evidence: "他摸了摸豁口的粗瓷碗，没接话。",
      transfer: "transferable" as const,
      status: "confirmed" as const,
      category: (["dialogue", "scene", "rhythm", "voice", "language", "consistency"] as const)[i % 6],
    }));
    preset.sources = [{
      id: "src-1",
      title: "主文风参考",
      role: "primary_voice",
      rules: noisyRules,
      samples: [],
    }];

    // 无模型确定性归约兜底
    const det = await consolidateStylePresetRules({ preset });
    expect(det.droppedPlatitudeCount).toBe(3);
    expect(det.consolidatedRules.length).toBeGreaterThan(0);
    expect(det.consolidatedRules.length).toBeLessThanOrEqual(MAX_CONSOLIDATED_STYLE_RULES);
    expect(det.consolidatedRules.every((r) => Boolean(r.doExample && r.dontExample))).toBe(true);

    preset.consolidatedRules = det.consolidatedRules;
    const guide = composeStyleGuide(preset);
    expect(guide).toContain("### 执行铁律");
    expect(guide.length).toBeLessThanOrEqual(900);
    expect(guide).not.toContain("注意长短句结合");

    // 有模型结构化归约路径
    const mockLlm: RuntimeTextGenerator = vi.fn(async () => ({
      text: JSON.stringify({
        rules: Array.from({ length: 5 }, (_, idx) => ({
          category: "dialogue",
          rule: `精炼铁律第${idx + 1}条：对白截断即转动作`,
          doExample: "“不够。”他合上账本起身。",
          dontExample: "他心中百感交集地长叹道这实在不够。",
          sourceIds: ["src-1"],
        })),
      }),
    }));
    const withLlm = await consolidateStylePresetRules({ preset, generateText: mockLlm });
    expect(withLlm.usedModel).toBe(true);
    expect(withLlm.consolidatedRules).toHaveLength(5);
  });

  it("appendRuntimeNegativeOverride（L5 负反馈）将口头纠偏置顶写入 customConstraints 且同义去重，HTTP 路由完整贯通", async () => {
    const root = await makeBookRoot();
    const initial = createStylePreset();
    initial.customConstraints = ["原有约束：章末留钩子"];
    initial.sources = [
      { id: "s1", title: "没钱", rules: [], samples: [] },
      { id: "s2", title: "玄鉴", rules: [], samples: [] },
    ];
    await saveStylePreset(root, initial, null);

    const r1 = await appendRuntimeNegativeOverride(root, "这段翻译腔太冲了，别搞欧化长定语");
    expect(r1.customConstraints[0]).toContain("【负反馈铁律】");
    expect(r1.customConstraints[0]).toContain("翻译腔");
    expect(r1.customConstraints[1]).toBe("原有约束：章末留钩子");

    const r2 = await appendRuntimeNegativeOverride(root, "别用英文缩写！");
    expect(r2.customConstraints[0]).toContain("英文专业缩写");
    expect(r2.customConstraints).toHaveLength(3);

    // 再次提翻译腔：去重并重新置顶，条数不膨胀
    const r3 = await appendRuntimeNegativeOverride(root, "还是有翻译腔");
    expect(r3.deduplicated).toBe(true);
    expect(r3.customConstraints).toHaveLength(3);
    expect(r3.customConstraints[0]).toContain("翻译腔");

    // 验证 HTTP 路由：consolidate / negative-override / PATCH sources/:sourceId
    const ctx = { state: { bookDir: () => root } } as unknown as RouterContext;
    const app = new Hono().route("/", createStylePresetRouter(ctx));

    const patchRes = await app.request("/api/books/b1/style-preset/sources/s2", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "register_overlay",
        triggerTags: ["ancient_scripture", "紫府密谈"],
        forbiddenSourceTerms: ["陆江仙", "望月湖"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchedBody = await patchRes.json();
    expect(patchedBody.preset.sources[1]).toMatchObject({
      id: "s2",
      role: "register_overlay",
      triggerTags: ["ancient_scripture", "紫府密谈"],
      forbiddenSourceTerms: ["陆江仙", "望月湖"],
    });

    const negRes = await app.request("/api/books/b1/style-preset/negative-override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedbackText: "少用心理描写" }),
    });
    expect(negRes.status).toBe(200);
    expect((await negRes.json()).customConstraints[0]).toContain("心理剖析");

    const consRes = await app.request("/api/books/b1/style-preset/consolidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxRules: 8 }),
    });
    expect(consRes.status).toBe(200);
  });
});
