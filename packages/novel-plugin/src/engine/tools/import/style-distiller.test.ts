/**
 * 文风蒸馏的契约测试。
 *
 * 两条关键约束：
 * 1. 产出必须与 `StyleProfile` 同构 —— 否则 `detectStyleDrift` 拿不到基线；
 * 2. 统计口径必须能区分「长短错落的人类正文」与「句长均质的模板文本」，
 *    否则蒸馏出来的基线毫无判别力。
 */

import { describe, expect, it } from "vitest";
import { distillStyleProfile } from "./style-distiller.js";
import { detectStyleDrift } from "./style-drift-detector.js";

const humanLike = [
  "韩立把药锄扛在肩上，鞋底沾着泥。他没急着回屋，先蹲在田埂边，捻起一点发黑的土。",
  "风从山口钻下来，吹得灯笼乱晃。老仆问他要不要添饭，他摇头，只说炉火别灭。",
  "“这批还能用吗。”",
  "“卖不出价。”",
  "院墙外有人走过，脚步很重，踩过水洼时溅了一声。要下雨了。",
].join("\n\n");

const uniformLike = "他走了过去。她看了一眼。天亮了起来。风停了下来。".repeat(20);

describe("文风蒸馏产出", () => {
  it("包含 StyleProfile 的全部基线字段，可直接喂给漂移检测", () => {
    const profile = distillStyleProfile([humanLike]);

    expect(typeof profile.avgSentenceLength).toBe("number");
    expect(typeof profile.sentenceLengthStdDev).toBe("number");
    expect(typeof profile.vocabularyDiversity).toBe("number");
    expect(typeof profile.dialogueRatio).toBe("number");

    // 同构即可用：不需要任何字段映射或补默认值。
    const drift = detectStyleDrift(profile, profile);
    expect(drift.overallDrift).toBe(0);
  });

  it("记录样本规模，便于判断基线是否可信", () => {
    const profile = distillStyleProfile([humanLike]);

    expect(profile.sampleCharCount).toBeGreaterThan(0);
    expect(profile.sampleSentenceCount).toBeGreaterThan(0);
  });

  it("多段样本合并统计，不是只取第一段", () => {
    const single = distillStyleProfile(["他走了。"]);
    const merged = distillStyleProfile(["他走了。", humanLike]);

    expect(merged.sampleCharCount).toBeGreaterThan(single.sampleCharCount);
  });
});

describe("统计口径的判别力", () => {
  it("均质文本的爆发度显著低于人类正文", () => {
    const human = distillStyleProfile([humanLike]);
    const uniform = distillStyleProfile([uniformLike]);

    expect(uniform.sentenceLengthBurstiness).toBeLessThan(human.sentenceLengthBurstiness);
  });

  it("重复词池的词汇丰富度显著低于人类正文", () => {
    const human = distillStyleProfile([humanLike]);
    const uniform = distillStyleProfile([uniformLike]);

    expect(uniform.vocabularyDiversity).toBeLessThan(human.vocabularyDiversity);
  });

  it("识别出对话占比：有台词的样本高于纯叙述样本", () => {
    const withDialogue = distillStyleProfile([humanLike]);
    const narrationOnly = distillStyleProfile(["韩立把药锄扛在肩上，鞋底沾着泥，一路往回走。"]);

    expect(withDialogue.dialogueRatio).toBeGreaterThan(narrationOnly.dialogueRatio);
  });

  it("短句占比按 ≤8 字统计，碎句文本明显偏高", () => {
    const choppy = distillStyleProfile(["他走。她停。风起。雨落。天黑。人散。".repeat(5)]);

    expect(choppy.shortSentenceRatio).toBeGreaterThan(0.8);
  });
});

describe("句长直方图", () => {
  it("六档计数之和等于句子总数", () => {
    const profile = distillStyleProfile([humanLike]);
    const total = profile.sentenceLengthBuckets.reduce((sum, count) => sum + count, 0);

    expect(profile.sentenceLengthBuckets).toHaveLength(6);
    expect(total).toBe(profile.sampleSentenceCount);
  });

  it("碎句文本集中在最短档，长句文本集中在最长档", () => {
    const choppy = distillStyleProfile(["他走。她停。风起。雨落。"]);
    const lengthy = distillStyleProfile([
      "他把药锄扛在肩上沿着田埂慢慢往回走一路上遇见几个挑水的乡人都低着头没有打招呼。",
    ]);

    expect(choppy.sentenceLengthBuckets[0]).toBeGreaterThan(0);
    expect(lengthy.sentenceLengthBuckets[5]).toBeGreaterThan(0);
  });

  it("空样本得到全零直方图", () => {
    const profile = distillStyleProfile([""]);
    expect(profile.sentenceLengthBuckets).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("边界输入", () => {
  it("空样本不抛错，返回零值基线", () => {
    const profile = distillStyleProfile([""]);

    expect(profile.avgSentenceLength).toBe(0);
    expect(profile.dialogueRatio).toBe(0);
    expect(profile.sampleSentenceCount).toBe(0);
  });

  it("单句样本的爆发度取 0，不因样本不足给出结论", () => {
    const profile = distillStyleProfile(["他走了。"]);

    expect(profile.sentenceLengthBurstiness).toBe(0);
  });
});
