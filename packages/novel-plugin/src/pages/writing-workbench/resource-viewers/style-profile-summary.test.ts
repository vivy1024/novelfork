import { describe, expect, it } from "vitest";

import { summarizeStyleProfile } from "./style-profile-summary";

describe("summarizeStyleProfile", () => {
  it("没有指纹时返回 undefined，调用方据此不注入任何内容", () => {
    expect(summarizeStyleProfile(null)).toBeUndefined();
    expect(summarizeStyleProfile(undefined)).toBeUndefined();
    expect(summarizeStyleProfile([])).toBeUndefined();
    expect(summarizeStyleProfile({})).toBeUndefined();
  });

  it("只有不认得的字段时也返回 undefined，而不是注入一句空约束", () => {
    expect(summarizeStyleProfile({ sampleCharCount: 12000, sourceName: "样文" })).toBeUndefined();
  });

  it("按侧栏同一口径输出认得的指标", () => {
    const summary = summarizeStyleProfile({
      avgSentenceLength: 17.6,
      shortSentenceRatio: 0.318,
      dialogueRatio: 0.41,
      avgParagraphLength: 86.2,
      weakAdverbPer1000: 2.34,
    });
    expect(summary).toContain("平均句长约 18 字");
    expect(summary).toContain("短句占 32%");
    expect(summary).toContain("对话占 41%");
    expect(summary).toContain("段均约 86 字");
    expect(summary).toContain("弱副词每千字约 2.3 个");
    expect(summary).toContain("须贴近以上基准");
  });

  it("字段缺哪项跳哪项，非数值与非有限数被忽略", () => {
    const summary = summarizeStyleProfile({ avgSentenceLength: "18", dialogueRatio: Number.NaN, avgParagraphLength: 60 });
    expect(summary).toBe("段均约 60 字。改写后的句长、对话比例与段落节奏须贴近以上基准，不要换成另一种腔调。");
  });
});
