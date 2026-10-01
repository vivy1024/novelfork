import { describe, expect, it } from "vitest";

import { resolveChapterLoop } from "./chapter-loop-state";

describe("章节循环当前步", () => {
  it("新书还没有写完的章：停在写，改与收尾不可用", () => {
    const model = resolveChapterLoop({ nextChapter: 1, nextAlreadyWritten: false, freshness: [{ chapterNumber: 1, status: "unsettled" }] });
    expect(model.defaultStep).toBe("write");
    expect(model.lastWritten).toBeUndefined();
    expect(model.steps.find((step) => step.id === "close")?.available).toBe(false);
    expect(model.steps.find((step) => step.id === "write")?.chapterNumber).toBe(1);
  });

  it("AI 刚写完第 3 章、作者还没改：停在改，针对第 3 章", () => {
    const model = resolveChapterLoop({
      nextChapter: 4,
      nextAlreadyWritten: false,
      freshness: [{ chapterNumber: 3, title: "入城", status: "unsettled" }],
      vault: [{ chapterNumber: 3, hasAiDraft: true, share: { authorRatio: 0 } }],
    });
    expect(model.defaultStep).toBe("revise");
    expect(model.lastWritten).toMatchObject({ chapterNumber: 3, title: "入城", hasAiDraft: true, authorRatio: 0, needsClose: true });
    expect(model.steps.find((step) => step.id === "revise")).toMatchObject({ chapterNumber: 3, attention: true });
    expect(model.steps.find((step) => step.id === "write")?.chapterNumber).toBe(4);
  });

  it("作者改过但还没结算：停在收尾", () => {
    const model = resolveChapterLoop({
      nextChapter: 4,
      nextAlreadyWritten: false,
      freshness: [{ chapterNumber: 3, status: "unsettled" }],
      vault: [{ chapterNumber: 3, hasAiDraft: true, share: { authorRatio: 0.4 } }],
    });
    expect(model.defaultStep).toBe("close");
  });

  it("结算后正文又被改过：停在收尾", () => {
    const model = resolveChapterLoop({ nextChapter: 4, nextAlreadyWritten: false, freshness: [{ chapterNumber: 3, status: "stale" }] });
    expect(model.defaultStep).toBe("close");
    expect(model.lastWritten?.needsClose).toBe(true);
  });

  it("已结算但还有待确认的章后提议：停在收尾", () => {
    const model = resolveChapterLoop({
      nextChapter: 4,
      nextAlreadyWritten: false,
      freshness: [{ chapterNumber: 3, status: "fresh" }],
      pendingByChapter: new Map([[3, 2]]),
    });
    expect(model.defaultStep).toBe("close");
    expect(model.lastWritten?.pendingCount).toBe(2);
  });

  it("结算新鲜、没有提议：回到写下一章", () => {
    const model = resolveChapterLoop({
      nextChapter: 4,
      nextAlreadyWritten: false,
      freshness: [{ chapterNumber: 3, status: "fresh" }],
      vault: [{ chapterNumber: 3, hasAiDraft: true, share: { authorRatio: 0 } }],
    });
    expect(model.defaultStep).toBe("write");
  });

  it("推荐章本身已有正文：改与收尾针对推荐章，写仍指向推荐章", () => {
    const model = resolveChapterLoop({ nextChapter: 5, nextAlreadyWritten: true, freshness: [{ chapterNumber: 5, status: "unsettled" }] });
    expect(model.lastWritten?.chapterNumber).toBe(5);
    expect(model.steps.find((step) => step.id === "write")?.chapterNumber).toBe(5);
  });

  it("推荐章的前一章不在章节索引里：不强行收尾", () => {
    const model = resolveChapterLoop({ nextChapter: 4, nextAlreadyWritten: false, freshness: [{ chapterNumber: 1, status: "fresh" }] });
    expect(model.lastWritten).toBeUndefined();
    expect(model.defaultStep).toBe("write");
  });
});
