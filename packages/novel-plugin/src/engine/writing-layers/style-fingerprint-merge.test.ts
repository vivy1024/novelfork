import { describe, expect, it } from "vitest";

import { mergeDistilledFingerprint, readDistilledSources } from "./style-fingerprint-merge.js";
import { composeStyleGuide, createStylePreset, selectGuideSourceRules, STYLE_GUIDE_MAX_RULES_PER_CATEGORY, STYLE_GUIDE_SOURCE_RULES_CHAR_CAP } from "./style-preset.js";

const a = { avgSentenceLength: 10, sentenceLengthStdDev: 2, vocabularyDiversity: 0.6, dialogueRatio: 0.1, sampleCharCount: 3_000, sentenceLengthBuckets: [1, 2, 3, 0, 0, 0] };
const b = { avgSentenceLength: 20, sentenceLengthStdDev: 4, vocabularyDiversity: 0.8, dialogueRatio: 0.4, sampleCharCount: 1_000, sentenceLengthBuckets: [0, 0, 1, 2, 3, 4] };

describe("M2 多来源统计指纹合并", () => {
  it("第一个来源原样写入并记下来源；第二个来源按字数加权合并，而不是覆盖", () => {
    const first = mergeDistilledFingerprint({ existing: null, sourceId: "s-a", sourceChars: 3_000, fingerprint: a })!;
    expect(first.avgSentenceLength).toBe(10);
    expect(readDistilledSources(first).map((item) => item.sourceId)).toEqual(["s-a"]);

    const second = mergeDistilledFingerprint({ existing: first, sourceId: "s-b", sourceChars: 1_000, fingerprint: b })!;
    // 3:1 加权：10×0.75 + 20×0.25 = 12.5
    expect(second.avgSentenceLength).toBe(12.5);
    expect(second.dialogueRatio).toBeCloseTo(0.175, 3);
    // 合并方差：0.75×(4+100) + 0.25×(16+400) − 12.5² = 78+104−156.25 = 25.75 → σ≈5.07
    expect(second.sentenceLengthStdDev).toBeCloseTo(5.07, 2);
    expect(second.sampleCharCount).toBe(4_000);
    expect(second.sentenceLengthBuckets).toEqual([1, 2, 4, 2, 3, 4]);
    expect(readDistilledSources(second).map((item) => item.sourceId)).toEqual(["s-a", "s-b"]);
  });

  it("同一来源再次采纳替换旧记录；既有指纹没有来源记录时按样本字数作为一份基线参与加权", () => {
    const first = mergeDistilledFingerprint({ existing: null, sourceId: "s-a", sourceChars: 3_000, fingerprint: a })!;
    const again = mergeDistilledFingerprint({ existing: first, sourceId: "s-a", sourceChars: 3_000, fingerprint: { ...a, avgSentenceLength: 14 } })!;
    expect(again.avgSentenceLength).toBe(14);
    expect(readDistilledSources(again)).toHaveLength(1);

    const manual = { ...b, vaultBasis: { kind: "external", sampleIds: [], recordedAt: "2026-01-01T00:00:00.000Z" } };
    const merged = mergeDistilledFingerprint({ existing: manual, sourceId: "s-a", sourceChars: 3_000, fingerprint: a })!;
    expect(merged.avgSentenceLength).toBe(12.5);
    expect((merged as Record<string, unknown>).vaultBasis).toBeUndefined();
    expect(mergeDistilledFingerprint({ existing: manual, sourceId: "s-a", sourceChars: 1, fingerprint: null })).toBe(manual);
  });
});

describe("M2 合成指南有上限", () => {
  function rule(text: string, category: string, confidence?: "high" | "medium" | "low") {
    return { text, evidence: "原文", transfer: "transferable" as const, status: "confirmed" as const, category: category as "voice", ...(confidence ? { confidence } : {}) };
  }

  it("主文风来源内的近似重复规则合并，未设 role 的第 2 个来源默认不混入全局指南（避免双源语域互殴）", () => {
    const preset = createStylePreset();
    preset.sources = [
      { id: "s1", title: "甲", samples: [], rules: [
        rule("对白只写一两句，随即转入动作描写", "dialogue"),
        rule("对白只写一两句，随即转入动作描写。", "dialogue"),
      ] },
      { id: "s2", title: "乙", role: "register_overlay", triggerTags: ["古籍"], samples: [], rules: [rule("转场改用半文言古语", "scene")] },
    ];
    const guide = composeStyleGuide(preset);
    expect(guide).toContain("对白只写一两句，随即转入动作描写（来源：甲）");
    expect(guide.match(/对白只写一两句/gu)).toHaveLength(1);
    expect(guide).not.toContain("转场改用半文言古语");
    const activated = composeStyleGuide(preset, { activeOverlayIds: new Set(["s2"]) });
    expect(activated).toContain("【局部语域挂载：乙】");
    expect(activated).toContain("转场改用半文言古语");
  });

  it("每类限条数且高置信优先；总字数有上限，各类别轮流取", () => {
    const preset = createStylePreset();
    const voiceTexts = [
      "叙述者先自嘲再入正题", "用旁观口吻讲亲历的事", "评论夹在动作之间一笔带过", "心理活动只写结论不写过程",
      "第二人称偶尔插入拉近读者", "叙述距离随紧张程度收放", "回忆段落改用过去完成语气", "结尾用一句冷淡的概括收束",
      "不解释人物动机让读者自己猜", "反讽靠平静陈述而非夸张形容",
    ];
    const voice = voiceTexts.map((text, index) => rule(text, "voice", index === 9 ? "high" : "low"));
    const rhythm = ["长段落之后紧跟一行短句", "打斗场面每句不超过十字", "章末停在半句悬念上"].map((text) => rule(text, "rhythm"));
    preset.sources = [{ id: "s1", title: "甲", samples: [], rules: [...voice, ...rhythm] }];
    const selected = selectGuideSourceRules(preset);
    const voicePicked = selected.rules.filter((item) => item.category === "voice");
    expect(voicePicked).toHaveLength(STYLE_GUIDE_MAX_RULES_PER_CATEGORY);
    // 唯一的高置信条目排在最前
    expect(voicePicked[0]?.text).toBe("反讽靠平静陈述而非夸张形容");
    expect(selected.rules.filter((item) => item.category === "rhythm")).toHaveLength(3);
    expect(selected.omitted).toBe(4);

    const long = createStylePreset();
    // 每条约 80 字、彼此不相似（用不同汉字段拼出）：36 条远超字数上限。
    const pool = "天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章";
    let seed = 7;
    const nextIndex = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % pool.length; };
    const distinct = () => Array.from({ length: 80 }, () => pool[nextIndex()]).join("");
    long.sources = [{ id: "s1", title: "甲", samples: [], rules: ["voice", "language", "rhythm", "dialogue", "scene", "consistency"].flatMap((category) =>
      Array.from({ length: 6 }, () => rule(distinct(), category))) }];
    const capped = selectGuideSourceRules(long);
    const chars = capped.rules.reduce((sum, item) => sum + item.text.length + 10, 0);
    expect(chars).toBeLessThanOrEqual(STYLE_GUIDE_SOURCE_RULES_CHAR_CAP + 200);
    // 字数先到上限时，六个类别都有代表
    expect(new Set(capped.rules.map((item) => item.category)).size).toBe(6);
    expect(capped.omitted).toBeGreaterThan(0);
  });
});
