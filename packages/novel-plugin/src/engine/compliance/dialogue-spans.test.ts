import { describe, expect, it } from "vitest";
import { DIALOGUE_MASK_CHAR, findDialogueRanges, fragmentOnlyInDialogue, maskDialogue, overlapsDialogue } from "./dialogue-spans.js";

describe("对白区间", () => {
  it("识别四种中文引号与半角双引号，含引号本身", () => {
    const text = "甲“一”乙「二」丙『三』丁‘四’戊\"五\"己";
    const ranges = findDialogueRanges(text);
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(["“一”", "「二」", "『三』", "‘四’", "\"五\""]);
  });

  it("嵌套引号随外层一起覆盖，同种嵌套按深度配对", () => {
    const text = "「他說『好』呢」後；“甲“乙”丙”丁";
    expect(findDialogueRanges(text).map((range) => text.slice(range.start, range.end))).toEqual(["「他說『好』呢」", "“甲“乙”丙”"]);
  });

  it("未闭合引号只到行尾", () => {
    const text = "“没说完\n他走了。";
    const ranges = findDialogueRanges(text);
    expect(ranges).toEqual([{ start: 0, end: 4 }]);
    expect(overlapsDialogue(ranges, text.indexOf("他"), text.length)).toBe(false);
  });

  it("遮罩等长，偏移不变", () => {
    const text = "他说“好……”。";
    const masked = maskDialogue(text);
    expect(masked).toHaveLength(text.length);
    expect(masked).toBe(`他说${DIALOGUE_MASK_CHAR.repeat(5)}。`);
  });

  it("命中文字是否只出现在对白里", () => {
    expect(fragmentOnlyInDialogue("“我不禁想笑。”她说。", "不禁")).toBe(true);
    expect(fragmentOnlyInDialogue("他不禁抬头，“不禁”", "不禁")).toBe(false);
    expect(fragmentOnlyInDialogue("他不禁抬头。", "不禁")).toBe(false);
    expect(fragmentOnlyInDialogue("“好。”", "")).toBe(false);
  });
});
