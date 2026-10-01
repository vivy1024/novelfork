import { describe, expect, it } from "vitest";

import { proposeSelectionCandidate } from "./selection-candidate-tools.js";

const selection = {
  requestId: "6a1f8c26-20b2-4dda-9d5d-96c191e0932b",
  chapterNumber: 7,
  from: 12,
  to: 21,
  sourceText: "雨落在窗沿。",
  candidateText: "雨点敲在窗沿，他没抬头。",
  action: "rewrite",
};

describe("选区候选工具", () => {
  it("只返回绑定当前书的候选，不采用模型伪造的书籍 ID", () => {
    const result = proposeSelectionCandidate({ ...selection, bookId: "other-book" }, "trusted-book");
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ artifact: {
      kind: "selection-candidate",
      id: selection.requestId,
      bookId: "trusted-book",
      chapterNumber: 7,
      sourceText: selection.sourceText,
      candidateText: selection.candidateText,
    } });
    expect(result).not.toHaveProperty("written");
  });

  it("拒绝无效位置、空候选和过大的输入", () => {
    for (const invalid of [
      { ...selection, to: 12 },
      { ...selection, candidateText: "  " },
      { ...selection, sourceText: "a".repeat(10_001) },
      { ...selection, action: "delete" },
    ]) {
      const result = proposeSelectionCandidate(invalid, "trusted-book");
      expect(result).toMatchObject({ ok: false, error: "invalid-selection-candidate" });
    }
  });

  it("from/to 可同时省略（按原文定位）；只给一半会被拒绝", () => {
    const { from: _from, to: _to, ...withoutRange } = selection;
    const located = proposeSelectionCandidate(withoutRange, "trusted-book");
    expect(located.ok).toBe(true);
    expect(located.data).toMatchObject({ artifact: { kind: "selection-candidate", sourceText: selection.sourceText } });
    expect((located.data as { artifact: Record<string, unknown> }).artifact).not.toHaveProperty("from");

    const halfRange = proposeSelectionCandidate({ ...selection, to: undefined }, "trusted-book");
    expect(halfRange).toMatchObject({ ok: false, error: "invalid-selection-candidate" });
  });
});
