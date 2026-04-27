import { describe, it, expect } from "vitest";
import {
  buildVariantPrompts,
  parseVariantResult,
  type VariantInput,
} from "../agents/variant-generator.js";
import type { InlineWriteContext } from "../agents/inline-writer.js";

const CTX: InlineWriteContext = {
  bookId: "book-1",
  chapterNumber: 7,
  beforeText: "他走进了房间。",
};

describe("buildVariantPrompts", () => {
  const input: VariantInput = {
    mode: "variant",
    selectedText: "月光洒在地上，他沉默不语。",
  };

  it("生成指定数量的 prompt", () => {
    const prompts = buildVariantPrompts(input, CTX, 3);
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(p).toContain("多版本改写");
      expect(p).toContain(input.selectedText);
    }
  });

  it("每个 prompt 有不同的风格提示", () => {
    const prompts = buildVariantPrompts(input, CTX, 3);
    expect(prompts[0]).toContain("变体 1/3");
    expect(prompts[1]).toContain("变体 2/3");
    expect(prompts[2]).toContain("变体 3/3");
  });

  it("默认生成 3 个", () => {
    const prompts = buildVariantPrompts(input, CTX);
    expect(prompts).toHaveLength(3);
  });
});

describe("parseVariantResult", () => {
  it("正确解析并附带 variantIndex", () => {
    const result = parseVariantResult("改写后的内容", 0);
    expect(result.mode).toBe("variant");
    expect(result.variantIndex).toBe(0);
    expect(result.content).toBe("改写后的内容");
    expect(result.styleTags).toHaveLength(1);
  });
});
