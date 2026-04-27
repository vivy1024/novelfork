import { describe, expect, it } from "vitest";

import { buildStudioResourceTree, type StudioResourceNode } from "./resource-adapter";

const book = {
  id: "book-1",
  title: "灵潮纪元",
  status: "active",
  platform: "qidian",
  genre: "xuanhuan",
  targetChapters: 100,
  chapters: 2,
  chapterCount: 2,
  lastChapterNumber: 2,
  totalWords: 6200,
  approvedChapters: 1,
  pendingReview: 1,
  pendingReviewChapters: 1,
  failedReview: 0,
  failedChapters: 0,
  updatedAt: "2026-04-27T00:00:00.000Z",
  createdAt: "2026-04-20T00:00:00.000Z",
  chapterWordCount: 3000,
  language: "zh" as const,
};

const chapters = [
  { number: 1, title: "第一章 灵潮初起", status: "approved", wordCount: 3100, auditIssueCount: 0, updatedAt: "2026-04-27T00:00:00.000Z", fileName: "001.md" },
  { number: 2, title: "第二章 入城", status: "ready-for-review", wordCount: 3100, auditIssueCount: 2, updatedAt: "2026-04-27T01:00:00.000Z", fileName: "002.md" },
];

function findNode(nodes: readonly StudioResourceNode[], id: string): StudioResourceNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

describe("buildStudioResourceTree", () => {
  it("maps an existing book into formal chapters, generated candidates, drafts and bible groups", () => {
    const tree = buildStudioResourceTree({
      book,
      chapters,
      generatedChapters: [
        { id: "gen-1", bookId: "book-1", targetChapterId: "2", title: "第二章 AI 候选", source: "write-next", createdAt: "2026-04-27T02:00:00.000Z", status: "candidate" },
      ],
      drafts: [{ id: "draft-1", bookId: "book-1", title: "城门冲突片段", updatedAt: "2026-04-27T03:00:00.000Z", wordCount: 800 }],
      bibleCounts: { characters: 3, locations: 2, factions: 1, items: 4, foreshadowing: 5, worldRules: 6 },
    });

    expect(tree[0]?.kind).toBe("book");
    expect(findNode(tree, "chapter:book-1:1")).toMatchObject({ kind: "chapter", title: "第一章 灵潮初起", status: "approved" });
    expect(findNode(tree, "generated:gen-1")).toMatchObject({ kind: "generated-chapter", title: "第二章 AI 候选", badge: "write-next" });
    expect(findNode(tree, "draft:draft-1")).toMatchObject({ kind: "draft", title: "城门冲突片段" });
    expect(findNode(tree, "bible:characters")).toMatchObject({ kind: "bible-category", title: "人物", count: 3 });
    expect(findNode(tree, "group:formal-chapters")?.children).toHaveLength(2);
  });

  it("provides actionable empty-state CTAs when the book has no chapters or bible data", () => {
    const tree = buildStudioResourceTree({ book: { ...book, chapters: 0, chapterCount: 0, lastChapterNumber: 0, totalWords: 0 }, chapters: [] });

    expect(findNode(tree, "group:formal-chapters")?.emptyState).toMatchObject({ actionLabel: "创建章节" });
    expect(findNode(tree, "group:generated-chapters")?.emptyState).toMatchObject({ actionLabel: "生成下一章" });
    expect(findNode(tree, "group:drafts")?.emptyState).toMatchObject({ actionLabel: "导入章节" });
    expect(findNode(tree, "group:bible")?.emptyState).toMatchObject({ actionLabel: "创建经纬条目" });
  });
});
