import { describe, it, expect } from "vitest";
import {
  buildDialoguePrompt,
  parseDialogueResult,
  type DialogueInput,
  type DialogueCharacter,
} from "../agents/dialogue-generator.js";
import type { InlineWriteContext } from "../agents/inline-writer.js";

const CTX: InlineWriteContext = {
  bookId: "book-1",
  chapterNumber: 3,
  beforeText: "两人在酒楼相遇。",
  styleGuide: "武侠风",
};

describe("buildDialoguePrompt", () => {
  const characters: DialogueCharacter[] = [
    { name: "张三", personality: "豪爽", speechStyle: "江湖气" },
    { name: "李四", personality: "阴沉" },
  ];
  const input: DialogueInput = {
    characters,
    scene: "酒楼二楼包间",
    purpose: "试探对方底细",
    turns: 5,
  };

  it("包含角色和场景信息", () => {
    const prompt = buildDialoguePrompt(input, CTX);
    expect(prompt).toContain("对话生成");
    expect(prompt).toContain("张三");
    expect(prompt).toContain("李四");
    expect(prompt).toContain("豪爽");
    expect(prompt).toContain("酒楼二楼包间");
    expect(prompt).toContain("试探对方底细");
    expect(prompt).toContain("5 轮");
  });
});

describe("parseDialogueResult", () => {
  it("解析标准对话格式", () => {
    const response = [
      '张三「兄台，喝一杯？」（端起酒杯）',
      '李四「不必了。」',
      '',
      '张三「何必如此见外。」（笑着摇头）',
    ].join("\n");

    const result = parseDialogueResult(response);
    expect(result.mode).toBe("dialogue");
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0].character).toBe("张三");
    expect(result.lines[0].line).toBe("兄台，喝一杯？");
    expect(result.lines[0].action).toBe("端起酒杯");
    expect(result.lines[1].character).toBe("李四");
    expect(result.lines[1].action).toBeUndefined();
  });

  it("空响应返回空 lines", () => {
    const result = parseDialogueResult("");
    expect(result.lines).toHaveLength(0);
  });
});
