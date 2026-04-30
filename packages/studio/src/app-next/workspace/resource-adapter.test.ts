import { describe, expect, it } from "vitest";

import type { WorkspaceResourceSnapshot } from "../../shared/contracts";
import { buildStudioResourceTree, type StudioResourceNode } from "./resource-adapter";

const book = {
  id: "book-1",
  title: "灵潮纪元",
  status: "drafting",
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
} satisfies WorkspaceResourceSnapshot["book"];

const chapters = [
  { number: 1, title: "第一章 灵潮初起", status: "approved", wordCount: 3100, auditIssueCount: 0, updatedAt: "2026-04-27T00:00:00.000Z", fileName: "001.md" },
  { number: 2, title: "第二章 入城", status: "ready-for-review", wordCount: 3100, auditIssueCount: 2, updatedAt: "2026-04-27T01:00:00.000Z", fileName: "002.md" },
] satisfies WorkspaceResourceSnapshot["chapters"];

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
    const snapshot: WorkspaceResourceSnapshot = {
      book,
      chapters,
      generatedChapters: [
        { id: "gen-1", bookId: "book-1", targetChapterId: "2", title: "第二章 AI 候选", source: "write-next", createdAt: "2026-04-27T02:00:00.000Z", status: "candidate" },
      ],
      drafts: [{ id: "draft-1", bookId: "book-1", title: "城门冲突片段", content: "草稿正文", updatedAt: "2026-04-27T03:00:00.000Z", wordCount: 800 }],
      bibleCounts: { characters: 3, locations: 2, factions: 1, items: 4, foreshadowing: 5, worldRules: 6 },
      bibleEntries: [],
      storyFiles: [],
      truthFiles: [],
      materials: [],
      publishReports: [],
    };

    const tree = buildStudioResourceTree(snapshot);

    expect(tree[0]?.kind).toBe("book");
    expect(findNode(tree, "chapter:book-1:1")).toMatchObject({ kind: "chapter", title: "第一章 灵潮初起", status: "approved" });
    expect(findNode(tree, "generated:gen-1")).toMatchObject({ kind: "generated-chapter", title: "第二章 AI 候选", badge: "write-next" });
    expect(findNode(tree, "draft:draft-1")).toMatchObject({ kind: "draft", title: "城门冲突片段" });
    expect(findNode(tree, "bible:characters")).toMatchObject({ kind: "bible-category", title: "人物", count: 3 });
    expect(findNode(tree, "group:formal-chapters")?.children).toHaveLength(2);
  });

  it("derives resource tree statistics and badges from the snapshot data", () => {
    const snapshot: WorkspaceResourceSnapshot = {
      book: { ...book, chapterCount: 99, chapters: 99, totalWords: 99999, status: "active" as never },
      chapters,
      generatedChapters: [
        { id: "gen-1", bookId: "book-1", title: "候选一", source: "write-next", createdAt: "2026-04-27T02:00:00.000Z", status: "candidate" },
        { id: "gen-2", bookId: "book-1", title: "已接受候选", source: "rewrite", createdAt: "2026-04-27T03:00:00.000Z", status: "accepted" },
      ],
      drafts: [
        { id: "draft-1", bookId: "book-1", title: "草稿一", content: "甲乙", updatedAt: "2026-04-27T03:00:00.000Z", wordCount: 2 },
      ],
      bibleCounts: { characters: 0 },
      bibleEntries: [
        { id: "char-1", category: "characters", title: "沈舟", summary: "主角" },
        { id: "char-2", category: "characters", title: "林月", summary: "搭档" },
      ],
      storyFiles: [],
      truthFiles: [],
      materials: [
        { id: "material-1", title: "素材一" },
        { id: "material-2", title: "素材二" },
      ],
      publishReports: [
        { id: "publish-1", title: "报告一", status: "blocked" },
      ],
    };

    const tree = buildStudioResourceTree(snapshot);

    expect(findNode(tree, "book:book-1")).toMatchObject({ status: "drafting", count: 2, badge: "6200 字" });
    expect(findNode(tree, "group:generated-chapters")).toMatchObject({ count: 2, badge: "2 个" });
    expect(findNode(tree, "group:drafts")).toMatchObject({ count: 1, badge: "2 字" });
    expect(findNode(tree, "bible:characters")).toMatchObject({ count: 2, badge: "2 条" });
    expect(findNode(tree, "group:materials")).toMatchObject({ count: 2, badge: "2 个" });
    expect(findNode(tree, "group:publish-reports")).toMatchObject({ count: 1, badge: "1 份" });
  });

  it("provides actionable empty-state CTAs when the book has no chapters or bible data", () => {
    const snapshot: WorkspaceResourceSnapshot = {
      book: { ...book, chapters: 0, chapterCount: 0, lastChapterNumber: 0, totalWords: 0 },
      chapters: [],
      generatedChapters: [],
      drafts: [],
      bibleCounts: {},
      bibleEntries: [],
      storyFiles: [],
      truthFiles: [],
      materials: [],
      publishReports: [],
    };

    const tree = buildStudioResourceTree(snapshot);

    expect(findNode(tree, "group:formal-chapters")?.emptyState).toMatchObject({ actionLabel: "创建章节" });
    expect(findNode(tree, "group:generated-chapters")?.emptyState).toMatchObject({ actionLabel: "生成下一章" });
    expect(findNode(tree, "group:drafts")?.emptyState).toMatchObject({ actionLabel: "导入章节" });
    expect(findNode(tree, "group:bible")?.emptyState).toMatchObject({ actionLabel: "创建经纬条目" });
  });

  it("maps resource snapshot style inputs into bible entries, story files, truth files, materials and publish reports", () => {
    const snapshot: WorkspaceResourceSnapshot = {
      book,
      chapters,
      generatedChapters: [],
      drafts: [],
      bibleCounts: { characters: 1 },
      bibleEntries: [
        { id: "char-1", category: "characters", title: "沈舟", summary: "主角，灵潮调查员" },
      ],
      storyFiles: [
        { id: "story-1", title: "pending_hooks.md", path: "story/pending_hooks.md", fileType: "markdown" },
      ],
      truthFiles: [
        { id: "truth-1", title: "chapter_summaries.md", path: "truth/chapter_summaries.md", fileType: "markdown" },
      ],
      materials: [
        { id: "material-1", title: "城门设定摘录", source: "web-capture", updatedAt: "2026-04-27T04:00:00.000Z" },
      ],
      publishReports: [
        { id: "publish-1", title: "起点发布就绪报告", channel: "qidian", updatedAt: "2026-04-27T05:00:00.000Z", status: "ready", content: "敏感词：0\n连续性：unknown" },
      ],
    };

    const tree = buildStudioResourceTree(snapshot);

    expect(findNode(tree, "bible-entry:characters:char-1")).toMatchObject({ kind: "bible-entry", title: "沈舟" });
    expect(findNode(tree, "story-file:story-1")).toMatchObject({ kind: "story-file", title: "pending_hooks.md" });
    expect(findNode(tree, "truth-file:truth-1")).toMatchObject({ kind: "truth-file", title: "chapter_summaries.md" });
    expect(findNode(tree, "material:material-1")).toMatchObject({ kind: "material", title: "城门设定摘录" });
    expect(findNode(tree, "publish-report:publish-1")).toMatchObject({
      kind: "publish-report",
      title: "起点发布就绪报告",
      metadata: expect.objectContaining({ content: "敏感词：0\n连续性：unknown" }),
    });
  });
});
