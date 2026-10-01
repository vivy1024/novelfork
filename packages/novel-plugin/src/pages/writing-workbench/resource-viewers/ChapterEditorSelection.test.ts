import { describe, expect, it } from "vitest";
import { buildSelectionInstruction, type SelectionRequest } from "./ChapterEditor";

function request(overrides: Partial<SelectionRequest> = {}): SelectionRequest {
  return {
    requestId: "req-a5",
    bookId: "book-1",
    chapterNumber: 3,
    from: 10,
    to: 48,
    sourceText: "薛行之握紧手中的断剑，周围的风声突然停了。",
    action: "continue",
    ...overrides,
  };
}

describe("buildSelectionInstruction 划词 AI prompt 组装", () => {
  it("指令包含任务描述、章节、原文与候选工具调用说明", () => {
    const prompt = buildSelectionInstruction(request());

    expect(prompt).toContain("请在选中位置之后自然续写 500-1500 字，保持人称、时态与文风一致。");
    expect(prompt).toContain("目标章节：第 3 章。");
    expect(prompt).toContain("选中原文：");
    expect(prompt).toContain(request().sourceText);
    expect(prompt).toContain("请调用 chapter.propose_selection");
    expect(prompt).toContain(JSON.stringify(request()));
    expect(prompt).toContain("工具只返回候选，不要直接修改章节正文。");
  });

  it("带规则 manualFlags 时保留语义判断段", () => {
    const flags = [
      {
        rule: "ai-taste-adverb",
        excerpt: "突然",
        reason: "副词修饰过于生硬",
        instruction: "换为具体动作细节",
      },
    ];
    const prompt = buildSelectionInstruction(request({ action: "polish" }), flags);

    expect(prompt).toContain("本地规则已标出以下需要语义判断的问题，请一并处理：");
    expect(prompt).toContain("- 「突然」：副词修饰过于生硬。换为具体动作细节");
    expect(prompt).not.toContain("全书文风基准：");
  });

  it("提供文风指纹摘要时，准确注入「全书文风基准：」提示", () => {
    const styleProfile = "短句为主，叙事节奏紧凑，少用生僻形容词，主角冷静果决，动作描写偏写实。";
    const prompt = buildSelectionInstruction(request({ action: "rewrite" }), [], styleProfile);

    expect(prompt).toContain("全书文风基准：");
    expect(prompt).toContain(styleProfile);

    // 行顺序：原文之后、候选工具调用说明之前
    const lines = prompt.split("\n");
    const styleHeaderIndex = lines.indexOf("全书文风基准：");
    const styleContentIndex = lines.indexOf(styleProfile);
    const toolPromptIndex = lines.findIndex((line) => line.startsWith("请调用 chapter.propose_selection"));

    expect(styleHeaderIndex).toBeGreaterThan(0);
    expect(styleContentIndex).toBe(styleHeaderIndex + 1);
    expect(toolPromptIndex).toBeGreaterThan(styleContentIndex);
  });

  it("空文风指纹字符串或纯空格时不注入多余换行与标题", () => {
    const promptWithEmpty = buildSelectionInstruction(request({ action: "expand" }), [], "   ");
    const promptWithout = buildSelectionInstruction(request({ action: "expand" }), []);

    expect(promptWithEmpty).toBe(promptWithout);
    expect(promptWithEmpty).not.toContain("全书文风基准：");
  });
});
