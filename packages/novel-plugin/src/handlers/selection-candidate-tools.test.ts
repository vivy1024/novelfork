import { beforeEach, describe, expect, it } from "vitest";

import { proposeSelectionCandidate, resetSubmittedSelectionCandidatesForTest } from "./selection-candidate-tools.js";

const selection = {
  requestId: "6a1f8c26-20b2-4dda-9d5d-96c191e0932b",
  chapterNumber: 7,
  from: 12,
  to: 21,
  sourceText: "雨落在窗沿。",
  candidateText: "雨点敲在窗沿，他没抬头。",
  action: "rewrite",
};

const chapterText = "趙太爷走进来。雨落在窗沿。他没说话。";
/** 按原文定位的候选（不带 from/to）。 */
const located = { ...selection, requestId: "located-1", from: undefined, to: undefined };
const readChapter = async (chapterNumber: number) => (chapterNumber === 7 ? chapterText : null);

describe("选区候选工具", () => {
  beforeEach(() => resetSubmittedSelectionCandidatesForTest());

  it("只返回绑定当前书的候选，不采用模型伪造的书籍 ID", async () => {
    const result = await proposeSelectionCandidate({ ...selection, bookId: "other-book" }, "trusted-book");
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

  it("拒绝无效位置、空候选和过大的输入", async () => {
    for (const invalid of [
      { ...selection, to: 12 },
      { ...selection, candidateText: "  " },
      { ...selection, sourceText: "a".repeat(10_001) },
      { ...selection, action: "delete" },
    ]) {
      const result = await proposeSelectionCandidate(invalid, "trusted-book");
      expect(result).toMatchObject({ ok: false, error: "invalid-selection-candidate" });
    }
  });

  it("from/to 可同时省略（按原文定位）；只给一半会被拒绝", async () => {
    const { from: _from, to: _to, ...withoutRange } = selection;
    const located = await proposeSelectionCandidate(withoutRange, "trusted-book", readChapter);
    expect(located.ok).toBe(true);
    expect(located.data).toMatchObject({ artifact: { kind: "selection-candidate", sourceText: selection.sourceText } });
    expect((located.data as { artifact: Record<string, unknown> }).artifact).not.toHaveProperty("from");

    const halfRange = await proposeSelectionCandidate({ ...selection, requestId: "half", to: undefined }, "trusted-book");
    expect(halfRange).toMatchObject({ ok: false, error: "invalid-selection-candidate" });
  });

  it("按原文定位时 sourceText 在正文里找不到逐字原文（如繁体写成简体）就拒绝并提示重读章节", async () => {
    const { from: _from, to: _to, ...withoutRange } = selection;
    const result = await proposeSelectionCandidate({ ...withoutRange, sourceText: "赵太爷走进来。" }, "trusted-book", readChapter);
    expect(result).toMatchObject({ ok: false, error: "source-text-not-found" });
    expect(result.summary).toContain("chapter_read");
  });

  it("按原文定位时 sourceText 在正文里出现多次就拒绝", async () => {
    const { from: _from, to: _to, ...withoutRange } = selection;
    const result = await proposeSelectionCandidate({ ...withoutRange, sourceText: "。" }, "trusted-book", readChapter);
    expect(result).toMatchObject({ ok: false, error: "source-text-ambiguous" });
  });

  it("章节不存在时拒绝", async () => {
    const { from: _from, to: _to, ...withoutRange } = selection;
    const result = await proposeSelectionCandidate({ ...withoutRange, chapterNumber: 99 }, "trusted-book", readChapter);
    expect(result).toMatchObject({ ok: false, error: "chapter-not-found" });
  });

  it("同一 requestId 并发提交（读正文期间）：后到的一次被挡住，不会两次都通过、后者覆盖前者", async () => {
    let release: (text: string) => void = () => undefined;
    const slowRead = () => new Promise<string>((resolve) => { release = resolve; });
    const first = proposeSelectionCandidate(located, "trusted-book", slowRead);
    const second = await proposeSelectionCandidate({ ...located, candidateText: "另一种改法。" }, "trusted-book", slowRead);
    expect(second).toMatchObject({ ok: false, error: "request-in-progress" });
    release(chapterText);
    expect(await first).toMatchObject({ ok: true });
    // 第一条落定后，内容不同的同号提交照常按「编号已用」拒绝
    const later = await proposeSelectionCandidate({ ...located, candidateText: "另一种改法。" }, "trusted-book", readChapter);
    expect(later).toMatchObject({ ok: false, error: "duplicate-request-id" });
  });

  it("按原文定位校验没通过时释放编号：改好原文后可用同一 requestId 重交", async () => {
    const bad = await proposeSelectionCandidate({ ...located, sourceText: "赵太爷走进来。" }, "trusted-book", readChapter);
    expect(bad).toMatchObject({ ok: false });
    const retry = await proposeSelectionCandidate(located, "trusted-book", readChapter);
    expect(retry).toMatchObject({ ok: true });
  });

  it("同一 requestId 重复提交同样内容时幂等返回原候选，内容不同则拒绝", async () => {
    const first = await proposeSelectionCandidate(selection, "trusted-book");
    expect(first.ok).toBe(true);
    const again = await proposeSelectionCandidate(selection, "trusted-book");
    expect(again).toMatchObject({ ok: true, data: { duplicate: true, artifact: { id: selection.requestId } } });
    const changed = await proposeSelectionCandidate({ ...selection, candidateText: "另一种改法。" }, "trusted-book");
    expect(changed).toMatchObject({ ok: false, error: "duplicate-request-id" });
    // 另一本书的同号请求互不影响
    const otherBook = await proposeSelectionCandidate({ ...selection, candidateText: "另一种改法。" }, "book-2");
    expect(otherBook.ok).toBe(true);
  });
});
