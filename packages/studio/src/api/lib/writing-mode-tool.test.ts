import { describe, expect, it, vi } from "vitest";

import { executeWritingModeTool, type WritingModeInput } from "@vivy1024/novelfork-novel-plugin/handlers";

describe("writing mode tool", () => {
  it("executes continue mode and returns generated text", async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      content: "林远深吸一口气，灵力在经脉中奔涌。他知道，这一战避无可避。",
    });

    const result = await executeWritingModeTool({
      mode: "continue",
      context: "林远站在悬崖边，身后是追兵的脚步声。",
      bookId: "book-1",
      chapterId: "ch-5",
      generate,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.generatedText).toContain("林远深吸一口气");
    expect(result.data?.mode).toBe("continue");
    expect(result.data?.wordCount).toBeGreaterThan(0);
  });

  it("executes rewrite mode with selection", async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      content: "他的目光如鹰隼般锐利，扫过在场每一个人。",
    });

    const result = await executeWritingModeTool({
      mode: "rewrite",
      context: "前文...",
      selection: "他看了看周围的人。",
      bookId: "book-1",
      chapterId: "ch-3",
      generate,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.generatedText).toContain("鹰隼");
    expect(result.data?.mode).toBe("rewrite");
  });

  it("executes expand mode", async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      content: "那柄剑通体漆黑，剑身上隐约可见古老的符文在流转。剑柄处镶嵌着一颗暗红色的宝石，仿佛封印着某种远古的力量。",
    });

    const result = await executeWritingModeTool({
      mode: "expand",
      context: "前文...",
      selection: "他拔出了那柄黑剑。",
      bookId: "book-1",
      chapterId: "ch-7",
      generate,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.mode).toBe("expand");
  });

  it("handles generation failure gracefully", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Model timeout"));

    const result = await executeWritingModeTool({
      mode: "continue",
      context: "...",
      bookId: "book-1",
      chapterId: "ch-1",
      generate,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
  });
});
