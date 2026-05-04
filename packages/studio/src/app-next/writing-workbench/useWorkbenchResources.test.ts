import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { WorkspaceResourceSnapshot } from "../../shared/contracts";
import { buildWorkbenchResourceTree, flattenWorkbenchResourceTree, useWorkbenchResources } from "./useWorkbenchResources";

const book = {
  id: "book-1",
  title: "灵潮纪元",
  status: "drafting",
  platform: "qidian",
  genre: "xuanhuan",
  targetChapters: 100,
  chapters: 1,
  chapterCount: 1,
  lastChapterNumber: 1,
  totalWords: 3000,
  approvedChapters: 0,
  pendingReview: 1,
  pendingReviewChapters: 1,
  failedReview: 0,
  failedChapters: 0,
  updatedAt: "2026-05-04T00:00:00.000Z",
  createdAt: "2026-05-01T00:00:00.000Z",
  chapterWordCount: 3000,
  language: "zh" as const,
} satisfies WorkspaceResourceSnapshot["book"];

const snapshot: WorkspaceResourceSnapshot = {
  book,
  chapters: [
    { number: 1, title: "第一章 灵潮初起", status: "draft", wordCount: 3000, auditIssueCount: 1, updatedAt: "2026-05-04T01:00:00.000Z", fileName: "001.md" },
  ],
  generatedChapters: [
    { id: "candidate-1", bookId: "book-1", title: "第二章 候选稿", source: "write-next", createdAt: "2026-05-04T02:00:00.000Z", status: "candidate", content: "候选正文" },
  ],
  drafts: [
    { id: "draft-1", bookId: "book-1", title: "城门片段", content: "草稿正文", updatedAt: "2026-05-04T03:00:00.000Z", wordCount: 4 },
  ],
  bibleCounts: { characters: 1, foreshadowing: 1 },
  bibleEntries: [
    { id: "char-1", category: "characters", title: "沈舟", summary: "主角" },
  ],
  storyFiles: [
    { id: "story-1", title: "pending_hooks.md", path: "story/pending_hooks.md", fileType: "markdown" },
  ],
  truthFiles: [
    { id: "truth-1", title: "chapter_summaries.md", path: "truth/chapter_summaries.md", fileType: "markdown" },
  ],
  materials: [],
  publishReports: [],
};

describe("buildWorkbenchResourceTree", () => {
  it("从 contract 资源快照构造章节、候选稿、草稿、story/truth、经纬和叙事线节点", () => {
    const tree = buildWorkbenchResourceTree(snapshot);
    const flat = flattenWorkbenchResourceTree(tree);

    expect(flat.get("chapter:book-1:1")).toMatchObject({ kind: "chapter", title: "第一章 灵潮初起", capabilities: expect.objectContaining({ edit: true, readonly: false }) });
    expect(flat.get("candidate:candidate-1")).toMatchObject({ kind: "candidate", capabilities: expect.objectContaining({ apply: true, delete: true }) });
    expect(flat.get("draft:draft-1")).toMatchObject({ kind: "draft", capabilities: expect.objectContaining({ edit: true, delete: true }) });
    expect(flat.get("story-file:story-1")).toMatchObject({ kind: "story", capabilities: expect.objectContaining({ readonly: true }) });
    expect(flat.get("truth-file:truth-1")).toMatchObject({ kind: "truth", capabilities: expect.objectContaining({ readonly: true }) });
    expect(flat.get("bible-entry:characters:char-1")).toMatchObject({ kind: "bible-entry", title: "沈舟" });
    expect(flat.get("storyline:foreshadowing")).toMatchObject({ kind: "storyline", title: "伏笔线", capabilities: expect.objectContaining({ readonly: true }) });
  });

  it("useWorkbenchResources 返回可打开资源索引和顶层树", () => {
    const { result } = renderHook(() => useWorkbenchResources(snapshot));

    expect(result.current.tree[0]).toMatchObject({ kind: "book", title: "灵潮纪元" });
    expect(result.current.resourceMap.get("draft:draft-1")?.content).toBe("草稿正文");
    expect(result.current.openableNodes.map((node) => node.id)).toContain("candidate:candidate-1");
  });
});
