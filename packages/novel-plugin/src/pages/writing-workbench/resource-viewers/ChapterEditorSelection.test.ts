import { describe, expect, it } from "vitest";
import { buildSelectionInstruction } from "./ChapterEditor";

describe("buildSelectionInstruction 划词 AI prompt 组装 (Task A5)", () => {
  const sampleText = "薛行之握紧手中的断剑，周围的风声突然停了。";

  it("无文风指纹时，组装结果与原有逻辑逐字完全一致（零回归）", () => {
    const prompt = buildSelectionInstruction("continue", sampleText, 3);

    expect(prompt).toBe(
      [
        "请在选中位置之后自然续写 500-1500 字，保持人称、时态与文风一致。",
        "目标章节：第 3 章。",
        "",
        "选中原文：",
        sampleText,
        "",
        "改完请把结果给我确认，不要直接覆盖正文。",
      ].join("\n"),
    );
  });

  it("无文风指纹且带规则 manualFlags 时，格式与原有保持一致", () => {
    const flags = [
      {
        rule: "ai-taste-adverb",
        excerpt: "突然",
        reason: "副词修饰过于生硬",
        instruction: "换为具体动作细节",
      },
    ];
    const prompt = buildSelectionInstruction("polish", sampleText, 5, flags);

    expect(prompt).toContain("本地规则已标出以下需要语义判断的问题，请一并处理：");
    expect(prompt).toContain("- 「突然」：副词修饰过于生硬。换为具体动作细节");
    expect(prompt).not.toContain("全书文风基准：");
  });

  it("提供文风指纹摘要时，准确注入「全书文风基准：」提示", () => {
    const styleProfile = "短句为主，叙事节奏紧凑，少用生僻形容词，主角冷静果决，动作描写偏写实。";
    const prompt = buildSelectionInstruction("rewrite", sampleText, 10, [], styleProfile);

    expect(prompt).toContain("全书文风基准：");
    expect(prompt).toContain(styleProfile);

    // 验证行顺序：在原文之后、修改确认提示之前
    const lines = prompt.split("\n");
    const styleHeaderIndex = lines.indexOf("全书文风基准：");
    const styleContentIndex = lines.indexOf(styleProfile);
    const confirmPromptIndex = lines.indexOf("改完请把结果给我确认，不要直接覆盖正文。");

    expect(styleHeaderIndex).toBeGreaterThan(0);
    expect(styleContentIndex).toBe(styleHeaderIndex + 1);
    expect(confirmPromptIndex).toBeGreaterThan(styleContentIndex);
  });

  it("空文风指纹字符串或纯空格时不注入多余换行与标题", () => {
    const promptWithEmpty = buildSelectionInstruction("expand", sampleText, 2, [], "   ");
    const promptWithout = buildSelectionInstruction("expand", sampleText, 2, []);

    expect(promptWithEmpty).toBe(promptWithout);
  });
});
