import { describe, expect, it } from "vitest";

import {
  compareStyleSources,
  normalizeStyleRuleText,
  STYLE_COMPARISON_SIMILARITY_THRESHOLD,
  styleRuleSimilarity,
  type StyleComparisonSourceInput,
} from "./style-distillation-compare.js";

const rule = (
  id: string,
  text: string,
  category: StyleComparisonSourceInput["rules"][number]["category"],
  transfer: "transferable" | "source-only" = "transferable",
) => ({ id, text, category, transfer, status: "needs-review" as const, origin: "model" as const });

describe("多来源文风比较", () => {
  it("并列共同技法、来源差异与不应迁移", () => {
    const result = compareStyleSources([
      { sourceId: "a", sourceName: "旧稿甲", rules: [
        rule("a1", "用具体的身体感受开场，先写冷和湿", "scene"),
        rule("a2", "对白里少用称谓，靠语气区分说话人", "dialogue"),
        rule("a3", "主角惯说「青云归我」", "voice", "source-only"),
      ] },
      { sourceId: "b", sourceName: "旧稿乙", rules: [
        rule("b1", "用具体的身体感受开场，先写冷", "scene"),
        rule("b2", "长段落描写后接一句独立短句收束", "rhythm"),
      ] },
    ]);
    expect(result.common).toHaveLength(1);
    expect(result.common[0]).toMatchObject({ category: "scene", sourceIds: expect.arrayContaining(["a", "b"]), text: "用具体的身体感受开场，先写冷" });
    expect(result.differences).toEqual([
      { sourceId: "a", sourceName: "旧稿甲", rules: [expect.objectContaining({ ruleId: "a2" })] },
      { sourceId: "b", sourceName: "旧稿乙", rules: [expect.objectContaining({ ruleId: "b2" })] },
    ]);
    expect(result.nonTransferable.map((item) => item.ruleId)).toEqual(["a3"]);
  });

  it("同一来源内的近似规则、不同类别的相似文本都不算共同技法", () => {
    const result = compareStyleSources([
      { sourceId: "a", sourceName: "甲", rules: [rule("a1", "句子短促推进动作", "rhythm"), rule("a2", "句子短促推进动作场面", "rhythm")] },
      { sourceId: "b", sourceName: "乙", rules: [rule("b1", "句子短促推进动作", "scene")] },
      { sourceId: "a", sourceName: "甲（重复传入）", rules: [rule("a9", "句子短促推进动作", "scene")] },
    ]);
    expect(result.common).toEqual([]);
    expect(result.sources.map((source) => source.sourceId)).toEqual(["a", "b"]);
  });

  it("相似度对完全相同为 1、无交集为 0；比较前走与证据比对同一套归一（引号、全角、繁简）", () => {
    expect(styleRuleSimilarity("雨夜收伞", "雨夜收伞")).toBe(1);
    expect(styleRuleSimilarity("雨夜收伞", "刀光剑影")).toBe(0);
    expect(styleRuleSimilarity("對話裡少說廢話", "对话里少说廢话")).toBe(1);
    expect(normalizeStyleRuleText("「Ａ」用一個動作，收住。")).toBe("a用一个动作收住");
  });

  it("阈值标定样例：同一技法的不同说法 ≥ 阈值，同类别不同技法 < 阈值", () => {
    const same: [string, string][] = [
      ["用具体的身体感受开场，先写冷和湿", "用具体的身体感受开场，先写冷"],
      ["叙述贴近人物视角，不跳出评论", "叙述紧贴人物视角，不跳出来评论"],
      ["对白里少用称谓，靠语气区分说话人", "对话少用称谓，用语气区分谁在说话"],
      ["用一个小动作收住情绪", "以细小动作收束情绪"],
    ];
    const different: [string, string][] = [
      ["对白里少用称谓，靠语气区分说话人", "对白之间插入动作，代替说话标签"],
      ["用一个小动作收住情绪", "用环境声音烘托人物情绪"],
      ["叙述贴近人物视角，不跳出评论", "人物内心独白用短句"],
    ];
    for (const [a, b] of same) expect(styleRuleSimilarity(a, b)).toBeGreaterThanOrEqual(STYLE_COMPARISON_SIMILARITY_THRESHOLD);
    for (const [a, b] of different) expect(styleRuleSimilarity(a, b)).toBeLessThan(STYLE_COMPARISON_SIMILARITY_THRESHOLD);
  });

  it("每个成员带任务、证据与出处；共同技法覆盖三个来源时三处都列出；同类别才合并", () => {
    const withEvidence = (id: string, text: string, evidence: string, category: StyleComparisonSourceInput["rules"][number]["category"], transfer: "transferable" | "source-only" = "transferable") =>
      ({ ...rule(id, text, category, transfer), evidence });
    const result = compareStyleSources([
      { sourceId: "a", sourceName: "甲", jobId: "job-a", adoptedRuleIds: ["a1"], rules: [withEvidence("a1", "用一个小动作收住情绪", "第1章：她把杯子转了半圈", "scene")] },
      { sourceId: "b", sourceName: "乙", jobId: "job-b", rules: [
        withEvidence("b1", "以细小动作收束情绪", "第2章：他把烟按灭", "scene"),
        withEvidence("b2", "用一个小动作收住情绪", "第3章：同句不同类", "voice"),
      ] },
      { sourceId: "c", sourceName: "丙", jobId: "job-c", rules: [
        withEvidence("c1", "用一个小动作收住情绪。", "第5章：她笑了一下", "scene"),
        withEvidence("c2", "师门口号「青云归我」反复出现", "第6章原话", "voice", "source-only"),
      ] },
    ]);
    expect(result.threshold).toBe(STYLE_COMPARISON_SIMILARITY_THRESHOLD);
    expect(result.common).toHaveLength(1);
    expect(result.common[0]!.sourceIds.sort()).toEqual(["a", "b", "c"]);
    expect(result.common[0]!.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: "甲", jobId: "job-a", ruleId: "a1", evidence: "第1章：她把杯子转了半圈" }),
      expect.objectContaining({ sourceName: "乙", jobId: "job-b", ruleId: "b1", evidence: "第2章：他把烟按灭" }),
    ]));
    expect(result.differences).toEqual([{ sourceId: "b", sourceName: "乙", rules: [expect.objectContaining({ ruleId: "b2", jobId: "job-b", category: "voice" })] }]);
    expect(result.nonTransferable).toEqual([expect.objectContaining({ ruleId: "c2", sourceName: "丙", jobId: "job-c", evidence: "第6章原话" })]);
    expect(result.sources[0]).toMatchObject({ jobId: "job-a", adoptedRuleIds: ["a1"], adoptedSampleIds: [] });
  });

  it("统计基线规则不参与合并：数字不同的同模板文案不进共同技法 / 来源差异，按来源并列在统计对比", () => {
    const baseline = (id: string, text: string, category: StyleComparisonSourceInput["rules"][number]["category"], origin?: "baseline") =>
      ({ id, text, evidence: `统计：${text}`, category, transfer: "transferable" as const, status: "needs-review" as const, ...(origin ? { origin } : {}) });
    const result = compareStyleSources([
      { sourceId: "a", sourceName: "甲", jobId: "job-a", fingerprint: { dialogueRatio: 0, avgSentenceLength: 9.3, sentenceLengthBuckets: [1, 2] }, rules: [
        baseline("dialogue-1", "对话约占文本 0%，用对白推进信息或冲突。", "dialogue", "baseline"),
        baseline("rhythm-0", "句长以约 9.3 字为参照，保留长短变化。", "rhythm", "baseline"),
        rule("a1", "用一个小动作收住情绪", "scene"),
      ] },
      { sourceId: "b", sourceName: "乙", jobId: "job-b", fingerprint: { dialogueRatio: 0.19, avgSentenceLength: 14.8 }, rules: [
        // 旧任务文件没有 origin 字段：按基线处理。
        baseline("dialogue-1", "对话约占文本 19%，用对白推进信息或冲突。", "dialogue"),
        baseline("rhythm-0", "句长以约 14.8 字为参照，保留长短变化。", "rhythm"),
        rule("b1", "以细小动作收束情绪", "scene"),
      ] },
    ]);
    // 只剩模型规则的那一组共同技法。
    expect(result.common).toHaveLength(1);
    expect(result.common[0]!.members.map((member) => member.ruleId).sort()).toEqual(["a1", "b1"]);
    expect(result.differences).toEqual([]);
    expect(result.nonTransferable).toEqual([]);
    expect(result.statistics).toEqual([
      {
        sourceId: "a", sourceName: "甲", jobId: "job-a",
        metrics: { dialogueRatio: 0, avgSentenceLength: 9.3 },
        baselineRules: [
          expect.objectContaining({ ruleId: "dialogue-1", text: "对话约占文本 0%，用对白推进信息或冲突。", evidence: expect.stringContaining("统计") }),
          expect.objectContaining({ ruleId: "rhythm-0" }),
        ],
      },
      {
        sourceId: "b", sourceName: "乙", jobId: "job-b",
        metrics: { dialogueRatio: 0.19, avgSentenceLength: 14.8 },
        baselineRules: [expect.objectContaining({ ruleId: "dialogue-1" }), expect.objectContaining({ ruleId: "rhythm-0" })],
      },
    ]);
  });

  it("分组是确定性的：输入相同则输出相同", () => {
    const input: StyleComparisonSourceInput[] = [
      { sourceId: "a", sourceName: "甲", rules: [rule("a1", "用一个小动作收住情绪", "scene"), rule("a2", "短句推进打斗", "rhythm")] },
      { sourceId: "b", sourceName: "乙", rules: [rule("b1", "以细小动作收束情绪", "scene")] },
    ];
    expect(compareStyleSources(input)).toEqual(compareStyleSources(input));
  });
});
