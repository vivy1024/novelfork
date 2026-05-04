import { describe, expect, it, vi } from "vitest";

import type { NarrativeLineSnapshot } from "../../shared/agent-native-workspace";
import type { GeneratedChapterCandidate } from "../../shared/contracts";
import { createContractClient } from "./contract-client";
import { createResourceClient } from "./resource-client";
import { flattenContractResourceTree, loadResourceTreeFromContract } from "./resource-tree-adapter";

const book = {
  id: "book/1",
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
};

const candidate = {
  id: "cand/1",
  bookId: "book/1",
  targetChapterId: "1",
  title: "第一章候选稿",
  source: "write-next",
  createdAt: "2026-05-04T02:00:00.000Z",
  status: "candidate",
  content: "候选正文",
} satisfies GeneratedChapterCandidate;

const narrativeSnapshot = {
  bookId: "book/1",
  nodes: [{ id: "n1", bookId: "book/1", type: "chapter", title: "第一章", chapterNumber: 1 }],
  edges: [],
  warnings: [],
  generatedAt: "2026-05-04T03:00:00.000Z",
} satisfies NarrativeLineSnapshot;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = input.toString();
    const responses: Record<string, () => Response | Promise<Response>> = {
      "/api/books/book%2F1": () => json({
        book,
        chapters: [{ number: 1, title: "第一章 灵潮初起", status: "draft", wordCount: 3000, auditIssueCount: 1, updatedAt: "2026-05-04T01:00:00.000Z", fileName: "0001.md" }],
        nextChapter: 2,
      }),
      "/api/books/book%2F1/candidates": () => json({ candidates: [candidate] }),
      "/api/books/book%2F1/drafts": () => json({ drafts: [{ id: "draft/1", bookId: "book/1", title: "城门片段", content: "草稿正文", updatedAt: "2026-05-04T02:30:00.000Z", wordCount: 4 }] }),
      "/api/books/book%2F1/story-files": () => json({ files: [{ name: "pending_hooks.md", label: "待处理伏笔", size: 12, preview: "伏笔" }] }),
      "/api/books/book%2F1/truth-files": () => json({ files: [{ name: "chapter_summaries.md", label: "章节摘要", size: 16, preview: "摘要" }] }),
      "/api/books/book%2F1/jingwei/sections": () => json({ sections: [{ id: "sec-characters", key: "characters", name: "人物", showInSidebar: true, enabled: true }] }),
      "/api/books/book%2F1/jingwei/entries": () => json({ entries: [{ id: "char-1", sectionId: "sec-characters", title: "沈舟", contentMd: "主角", updatedAt: "2026-05-04T02:40:00.000Z" }] }),
      "/api/books/book%2F1/narrative-line": () => json({ snapshot: narrativeSnapshot }),
      ...overrides,
    };
    const resolve = responses[path];
    if (!resolve) return json({ error: `Unhandled path: ${path}` }, 404);
    return resolve();
  });
}

describe("resource tree contract adapter", () => {
  it("loads real resource routes and maps nodes with read/edit/delete/apply capabilities", async () => {
    const fetchMock = createFetch();
    const resource = createResourceClient(createContractClient({ fetch: fetchMock }));

    const result = await loadResourceTreeFromContract(resource, "book/1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected resource tree load success");
    const flat = flattenContractResourceTree(result.tree);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/books/book%2F1",
      "/api/books/book%2F1/candidates",
      "/api/books/book%2F1/drafts",
      "/api/books/book%2F1/story-files",
      "/api/books/book%2F1/truth-files",
      "/api/books/book%2F1/jingwei/sections",
      "/api/books/book%2F1/jingwei/entries",
      "/api/books/book%2F1/narrative-line",
    ]);
    expect(flat.get("chapter:book/1:1")).toMatchObject({
      kind: "chapter",
      title: "第一章 灵潮初起",
      capabilities: {
        read: { status: "current" },
        edit: { status: "current" },
        delete: { status: "current" },
        apply: { status: "unsupported" },
      },
    });
    expect(flat.get("candidate:cand/1")).toMatchObject({
      kind: "candidate",
      title: "第一章候选稿",
      capabilities: {
        read: { status: "current" },
        edit: { status: "unsupported" },
        delete: { status: "current" },
        apply: { status: "current" },
      },
    });
    expect(flat.get("draft:draft/1")).toMatchObject({ capabilities: { edit: { status: "current" }, delete: { status: "current" } } });
    expect(flat.get("story-file:pending_hooks.md")).toMatchObject({ capabilities: { read: { status: "current" }, edit: { status: "unsupported" }, delete: { status: "current" } } });
    expect(flat.get("truth-file:chapter_summaries.md")).toMatchObject({ capabilities: { read: { status: "current" }, edit: { status: "current" }, delete: { status: "current" } } });
    expect(flat.get("jingwei-entry:char-1")).toMatchObject({ capabilities: { read: { status: "current" }, edit: { status: "current" }, delete: { status: "current" } } });
    expect(flat.get("narrative-line:book/1")).toMatchObject({ kind: "narrative-line", capabilities: { read: { status: "current" }, edit: { status: "unsupported" } } });
    expect(result.errors).toEqual([]);
  });

  it("keeps failed optional resources visible as unsupported nodes instead of fabricating empty groups", async () => {
    const resource = createResourceClient(createContractClient({
      fetch: createFetch({
        "/api/books/book%2F1/candidates": () => json({ error: { code: "CANDIDATES_UNAVAILABLE", message: "候选区不可读" } }, 500),
      }),
    }));

    const result = await loadResourceTreeFromContract(resource, "book/1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected partial resource tree success");
    const flat = flattenContractResourceTree(result.tree);
    expect(flat.get("unsupported:candidates.list")).toMatchObject({
      kind: "unsupported",
      title: "候选稿加载失败",
      capabilities: { unsupported: { status: "unsupported", ui: { errorVisible: true } } },
      metadata: { error: { error: { code: "CANDIDATES_UNAVAILABLE", message: "候选区不可读" } } },
    });
    expect(flat.has("candidate:cand/1")).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
