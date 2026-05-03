import { afterEach, describe, expect, it } from "vitest";
import { SearchIndex } from "../search-index.js";

let searchIndex: SearchIndex;

afterEach(() => {
  searchIndex?.close();
});

function createIndex(): SearchIndex {
  searchIndex = new SearchIndex();
  return searchIndex;
}

describe("SearchIndex (FTS5)", () => {
  it("indexes a document and finds it by search", () => {
    const idx = createIndex();
    idx.index({
      id: "chapter:book-1:1",
      type: "chapter",
      title: "第一章 灵潮初起",
      content: "灵潮从城墙外涌来，主角第一次听见命运的回声。",
      bookId: "book-1",
      timestamp: 1,
      metadata: { chapterNumber: 1 },
    });

    const results = idx.search("灵潮");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "chapter:book-1:1",
      type: "chapter",
      title: "第一章 灵潮初起",
      bookId: "book-1",
    });
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("removes a document so it is no longer searchable", () => {
    const idx = createIndex();
    idx.index({
      id: "chapter:book-1:1",
      type: "chapter",
      title: "第一章",
      content: "灵潮涌来",
      bookId: "book-1",
      timestamp: 1,
    });

    expect(idx.search("灵潮")).toHaveLength(1);

    idx.remove("chapter:book-1:1");

    expect(idx.search("灵潮")).toHaveLength(0);
    expect(idx.get("chapter:book-1:1")).toBeUndefined();
    expect(idx.size()).toBe(0);
  });

  it("searches Chinese text", () => {
    const idx = createIndex();
    idx.index({
      id: "ch1",
      type: "chapter",
      title: "第一章 修仙之路",
      content: "少年踏上修仙之路，灵气充盈天地之间。",
      bookId: "b1",
      timestamp: 1,
    });
    idx.index({
      id: "ch2",
      type: "chapter",
      title: "第二章 灵气觉醒",
      content: "灵气在丹田中汇聚，形成第一缕真元。",
      bookId: "b1",
      timestamp: 2,
    });

    const results = idx.search("灵气");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Both chapters mention 灵气
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ch2");
  });

  it("ranks results by relevance (higher term frequency scores higher)", () => {
    const idx = createIndex();
    // Document with the term repeated many times should rank higher
    idx.index({
      id: "high",
      type: "chapter",
      title: "magic world",
      content: "magic magic magic magic magic magic magic magic magic magic",
      bookId: "b1",
      timestamp: 1,
    });
    idx.index({
      id: "low",
      type: "chapter",
      title: "other chapter",
      content: "the hero encountered magic once on the road",
      bookId: "b1",
      timestamp: 2,
    });

    const results = idx.search("magic");
    expect(results.length).toBe(2);
    // The document with more occurrences should have a higher score
    expect(results[0]!.id).toBe("high");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("returns highlights (snippets) containing the search term", () => {
    const idx = createIndex();
    idx.index({
      id: "ch1",
      type: "chapter",
      title: "第一章 灵潮初起",
      content: "灵潮从城墙外涌来，主角第一次听见命运的回声。这是一个漫长的故事。",
      bookId: "b1",
      timestamp: 1,
    });

    const results = idx.search("灵潮");
    expect(results).toHaveLength(1);
    expect(results[0]!.highlights.length).toBeGreaterThan(0);
    // At least one highlight should contain the search term
    const hasMatch = results[0]!.highlights.some((h) => h.includes("灵潮"));
    expect(hasMatch).toBe(true);
  });

  it("filters by document type", () => {
    const idx = createIndex();
    idx.index({
      id: "ch1",
      type: "chapter",
      title: "第一章",
      content: "灵气修炼",
      bookId: "b1",
      timestamp: 1,
    });
    idx.index({
      id: "s1",
      type: "setting",
      title: "世界观",
      content: "灵气体系设定",
      bookId: "b1",
      timestamp: 2,
    });

    const chapterResults = idx.search("灵气", "chapter");
    expect(chapterResults).toHaveLength(1);
    expect(chapterResults[0]!.type).toBe("chapter");

    const settingResults = idx.search("灵气", "setting");
    expect(settingResults).toHaveLength(1);
    expect(settingResults[0]!.type).toBe("setting");

    const allResults = idx.search("灵气", "all");
    expect(allResults).toHaveLength(2);
  });

  it("updates an existing document", () => {
    const idx = createIndex();
    idx.index({
      id: "ch1",
      type: "chapter",
      title: "Chapter One",
      content: "old content about dragons",
      bookId: "b1",
      timestamp: 1,
    });

    idx.index({
      id: "ch1",
      type: "chapter",
      title: "Chapter One Revised",
      content: "new content about phoenix",
      bookId: "b1",
      timestamp: 2,
    });

    expect(idx.size()).toBe(1);
    expect(idx.search("dragons")).toHaveLength(0);
    expect(idx.search("phoenix")).toHaveLength(1);
    expect(idx.get("ch1")?.title).toBe("Chapter One Revised");
  });

  it("clears all documents", () => {
    const idx = createIndex();
    idx.index({ id: "a", type: "chapter", title: "A", content: "content", bookId: "b1", timestamp: 1 });
    idx.index({ id: "b", type: "setting", title: "B", content: "content", bookId: "b1", timestamp: 2 });

    expect(idx.size()).toBe(2);

    idx.clear();

    expect(idx.size()).toBe(0);
    expect(idx.search("content")).toHaveLength(0);
  });

  it("returns empty results for empty query", () => {
    const idx = createIndex();
    idx.index({ id: "a", type: "chapter", title: "A", content: "content", bookId: "b1", timestamp: 1 });

    expect(idx.search("")).toHaveLength(0);
    expect(idx.search("   ")).toHaveLength(0);
  });

  it("preserves metadata through index and get", () => {
    const idx = createIndex();
    const metadata = { chapterNumber: 5, bookTitle: "灵潮纪元" };
    idx.index({
      id: "ch5",
      type: "chapter",
      title: "第五章",
      content: "内容",
      bookId: "b1",
      timestamp: 1,
      metadata,
    });

    const doc = idx.get("ch5");
    expect(doc?.metadata).toEqual(metadata);
  });

  it("respects the limit parameter", () => {
    const idx = createIndex();
    for (let i = 0; i < 10; i++) {
      idx.index({
        id: `ch${i}`,
        type: "chapter",
        title: `第${i}章 灵气`,
        content: `灵气修炼第${i}段`,
        bookId: "b1",
        timestamp: i,
      });
    }

    const results = idx.search("灵气", undefined, 3);
    expect(results).toHaveLength(3);
  });
});
