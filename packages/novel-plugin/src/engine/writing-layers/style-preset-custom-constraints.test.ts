import { describe, expect, it } from "vitest";
import {
  composeCustomConstraintsSection,
  CUSTOM_CONSTRAINT_MAX_ITEM_CHARS,
  CUSTOM_CONSTRAINT_MAX_ITEMS,
  CUSTOM_CONSTRAINTS_SECTION_TITLE,
  CustomConstraintsSchema,
  extractCustomConstraints,
  hasCustomConstraintsField,
  prepareCustomConstraints,
} from "./style-preset-custom-constraints.js";

const repeat = (text: string, count: number) => Array.from({ length: count }, (_, index) => `${text}${index + 1}`);

describe("作者硬约束字段", () => {
  it("存储校验：合法字段通过，超 200 字或超 30 条拒绝", () => {
    expect(CustomConstraintsSchema.safeParse(["对话必须口语化", "章节结尾留钩子"]).success).toBe(true);
    expect(CustomConstraintsSchema.safeParse([]).success).toBe(true);
    expect(CustomConstraintsSchema.safeParse(["一".repeat(CUSTOM_CONSTRAINT_MAX_ITEM_CHARS)]).success).toBe(true);
    expect(CustomConstraintsSchema.safeParse(["一".repeat(CUSTOM_CONSTRAINT_MAX_ITEM_CHARS + 1)]).success).toBe(false);
    expect(CustomConstraintsSchema.safeParse(repeat("约束", CUSTOM_CONSTRAINT_MAX_ITEMS)).success).toBe(true);
    expect(CustomConstraintsSchema.safeParse(repeat("约束", CUSTOM_CONSTRAINT_MAX_ITEMS + 1)).success).toBe(false);
    expect(CustomConstraintsSchema.safeParse(["  "]).success).toBe(false);
  });

  it("归一化：修剪空白、丢弃无效条目并计数", () => {
    const prepared = prepareCustomConstraints(["  对话口语化  ", "", "   ", 42, null, "章节结尾留钩子"]);
    expect(prepared.constraints).toEqual(["对话口语化", "章节结尾留钩子"]);
    expect(prepared.droppedItems).toBe(4);
    expect(prepared.clampedItems).toBe(0);
    expect(prepared.truncatedItems).toBe(0);
    expect(prepareCustomConstraints(undefined).droppedItems).toBe(0);
    expect(prepareCustomConstraints("不是数组").droppedItems).toBe(1);
  });

  it("归一化：单条超 200 字收短、超过 30 条丢弃，计数交给界面提示", () => {
    const longEntry = "面".repeat(CUSTOM_CONSTRAINT_MAX_ITEM_CHARS + 50);
    const prepared = prepareCustomConstraints([longEntry]);
    expect(prepared.constraints).toEqual(["面".repeat(CUSTOM_CONSTRAINT_MAX_ITEM_CHARS)]);
    expect(prepared.clampedItems).toBe(1);
    const over = prepareCustomConstraints(repeat("约束", CUSTOM_CONSTRAINT_MAX_ITEMS + 5));
    expect(over.constraints).toHaveLength(CUSTOM_CONSTRAINT_MAX_ITEMS);
    expect(over.constraints.at(-1)).toBe(`约束${CUSTOM_CONSTRAINT_MAX_ITEMS}`);
    expect(over.truncatedItems).toBe(5);
  });

  it("字段未启用时返回 null，启用后按归一化读取（含手改出的脏数据）", () => {
    expect(hasCustomConstraintsField(undefined)).toBe(false);
    expect(hasCustomConstraintsField({})).toBe(false);
    expect(extractCustomConstraints({ name: "预设" })).toBeNull();
    expect(hasCustomConstraintsField({ customConstraints: [] })).toBe(true);
    expect(extractCustomConstraints({ customConstraints: [] })?.constraints).toEqual([]);
    const dirty = extractCustomConstraints({ customConstraints: [" 甲 ", "面".repeat(300)] });
    expect(dirty?.constraints).toEqual(["甲", "面".repeat(CUSTOM_CONSTRAINT_MAX_ITEM_CHARS)]);
    expect([dirty?.droppedItems, dirty?.clampedItems]).toEqual([0, 1]);
    expect(extractCustomConstraints({ customConstraints: "损坏" })?.droppedItems).toBe(1);
  });

  it("注入段：空列表返回空，调用方输出保持逐字不变；非空带标题与条目", () => {
    expect(composeCustomConstraintsSection(undefined)).toEqual([]);
    expect(composeCustomConstraintsSection([])).toEqual([]);
    expect(composeCustomConstraintsSection(["  ", ""])).toEqual([]);
    expect(composeCustomConstraintsSection(["对话必须口语化", " 章节结尾留钩子 "])).toEqual([
      `${CUSTOM_CONSTRAINTS_SECTION_TITLE}（作者设定，必须逐条遵守，优先于人文化手法与工具流程）：`,
      "- 对话必须口语化",
      "- 章节结尾留钩子",
    ]);
    expect(CUSTOM_CONSTRAINTS_SECTION_TITLE).toBe("本书硬约束");
  });
});
