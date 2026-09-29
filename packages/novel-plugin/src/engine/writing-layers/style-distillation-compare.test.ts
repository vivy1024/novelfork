import { describe, expect, it } from "vitest";

import { compareStyleSources, styleRuleSimilarity, type StyleComparisonSourceInput } from "./style-distillation-compare.js";

const rule = (
  id: string,
  text: string,
  category: StyleComparisonSourceInput["rules"][number]["category"],
  transfer: "transferable" | "source-only" = "transferable",
) => ({ id, text, category, transfer, status: "needs-review" as const });

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

  it("相似度对完全相同为 1、无交集为 0", () => {
    expect(styleRuleSimilarity("雨夜收伞", "雨夜收伞")).toBe(1);
    expect(styleRuleSimilarity("雨夜收伞", "刀光剑影")).toBe(0);
  });
});
