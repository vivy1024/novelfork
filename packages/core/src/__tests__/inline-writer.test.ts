import { describe, it, expect } from "vitest";
import {
  buildContinuationPrompt,
  parseContinuationResult,
  buildExpansionPrompt,
  parseExpansionResult,
  buildBridgePrompt,
  parseBridgeResult,
  type ContinuationInput,
  type ExpansionInput,
  type BridgeInput,
  type InlineWriteContext,
} from "../agents/inline-writer.js";

const CTX: InlineWriteContext = {
  bookId: "book-1",
  chapterNumber: 5,
  beforeText: "前文内容".repeat(100),
  afterText: "后文内容",
  styleGuide: "简洁有力，短句为主",
  bookRules: "主角不能飞",
};

// ---------------------------------------------------------------------------
// Continuation
// ---------------------------------------------------------------------------

describe("buildContinuationPrompt", () => {
  const input: ContinuationInput = {
    mode: "continuation",
    selectedText: "他站在悬崖边，风吹过他的衣袍。",
    direction: "增加紧张感",
  };

  it("包含关键字段", () => {
    const prompt = buildContinuationPrompt(input, CTX);
    expect(prompt).toContain("选段续写");
    expect(prompt).toContain(input.selectedText);
    expect(prompt).toContain("增加紧张感");
    expect(prompt).toContain("第 5 章");
    expect(prompt).toContain("500-1500");
    expect(prompt).toContain("简洁有力");
    expect(prompt).toContain("主角不能飞");
  });

  it("无 direction 时不包含续写方向段", () => {
    const noDir: ContinuationInput = { ...input, direction: undefined };
    const prompt = buildContinuationPrompt(noDir, CTX);
    expect(prompt).not.toContain("续写方向");
  });
});

describe("parseContinuationResult", () => {
  it("正确解析", () => {
    const result = parseContinuationResult("  续写内容在这里  ");
    expect(result.content).toBe("续写内容在这里");
    expect(result.wordCount).toBe(7);
    expect(result.mode).toBe("continuation");
  });
});

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

describe("buildExpansionPrompt", () => {
  const input: ExpansionInput = {
    mode: "expansion",
    selectedText: "他挥了挥手。",
    expansionDirection: "action",
  };

  it("包含扩写方向", () => {
    const prompt = buildExpansionPrompt(input, CTX);
    expect(prompt).toContain("场景扩写");
    expect(prompt).toContain("动作描写");
    expect(prompt).toContain(input.selectedText);
    expect(prompt).toContain("1.5x - 3x");
  });
});

describe("parseExpansionResult", () => {
  it("计算扩写比例", () => {
    const input: ExpansionInput = {
      mode: "expansion",
      selectedText: "短文",
      expansionDirection: "sensory",
    };
    const result = parseExpansionResult("这是一段更长的扩写内容，包含了丰富的感官细节。", input);
    expect(result.mode).toBe("expansion");
    expect(result.originalWordCount).toBe(2);
    expect(result.expandedWordCount).toBeGreaterThan(2);
    expect(result.expansionRatio).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

describe("buildBridgePrompt", () => {
  const input: BridgeInput = {
    mode: "bridge",
    selectedText: "【此处需要过渡】",
    purpose: "time-skip",
  };

  it("包含补写目的", () => {
    const prompt = buildBridgePrompt(input, CTX);
    expect(prompt).toContain("段落补写");
    expect(prompt).toContain("时间跳跃");
    expect(prompt).toContain("200-800");
  });
});

describe("parseBridgeResult", () => {
  it("正确解析", () => {
    const result = parseBridgeResult("三天后，他终于到达了目的地。");
    expect(result.mode).toBe("bridge");
    expect(result.content).toBe("三天后，他终于到达了目的地。");
  });
});
