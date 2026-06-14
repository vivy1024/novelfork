import { describe, it, expect } from "vitest";
import { analyzeWordFrequency, renderWordFrequencyHint } from "../utils/word-frequency.js";

describe("analyzeWordFrequency (P4-1 动态词频)", () => {
  it("识别跨多章反复出现的高频实词", () => {
    // "凝视" 在 4 章里反复高频出现
    const chapters = [
      "他凝视着远方，凝视着天空，凝视着大地，眼神凝视。".repeat(3),
      "她凝视前方，凝视良久，再次凝视，凝视不语。".repeat(3),
      "众人凝视彼此，凝视沉默，凝视如初，凝视依旧。".repeat(3),
      "老者凝视星空，凝视往昔，凝视未来，凝视无言。".repeat(3),
    ];
    const r = analyzeWordFrequency(chapters, { minChapterSpread: 3, minCount: 8 });
    const ningshi = r.find((x) => x.word === "凝视");
    expect(ningshi).toBeDefined();
    expect(ningshi!.chapterSpread).toBe(4);
    expect(ningshi!.count).toBeGreaterThanOrEqual(8);
  });

  it("出现章数不足 minChapterSpread → 不报", () => {
    // "罕见" 只在 1 章出现（即便次数多）
    const chapters = [
      "罕见罕见罕见罕见罕见罕见罕见罕见罕见罕见。",
      "普通内容一段。",
      "另一段普通内容。",
    ];
    const r = analyzeWordFrequency(chapters, { minChapterSpread: 3, minCount: 5 });
    expect(r.find((x) => x.word === "罕见")).toBeUndefined();
  });

  it("过滤停用词", () => {
    const chapters = ["的的的了了了是是是在在在".repeat(5), "的了是在的了是在".repeat(5), "的的了了是是".repeat(5)];
    const r = analyzeWordFrequency(chapters, { minChapterSpread: 1, minCount: 1 });
    // 停用词不应出现在结果
    expect(r.every((x) => !["的了", "了是", "是在"].includes(x.word) || x.word.length === 0)).toBe(true);
  });

  it("空输入 → 空结果", () => {
    expect(analyzeWordFrequency([])).toEqual([]);
    expect(analyzeWordFrequency(["", "", ""])).toEqual([]);
  });

  it("renderWordFrequencyHint: 有结果渲染提示", () => {
    const hint = renderWordFrequencyHint([{ word: "凝视", count: 12, chapterSpread: 4 }], "zh");
    expect(hint).toContain("凝视");
    expect(hint).toContain("高频");
  });

  it("renderWordFrequencyHint: 无结果返回空串", () => {
    expect(renderWordFrequencyHint([])).toBe("");
  });
});
