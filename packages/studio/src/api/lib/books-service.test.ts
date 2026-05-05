import { describe, expect, it, vi } from "vitest";

import { createBooksReadService } from "./books-service";

function buildState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listBooks: vi.fn(async () => ["book-1"]),
    loadBookConfig: vi.fn(async () => ({
      id: "book-1",
      title: "灵潮纪元",
      platform: "qidian" as const,
      genre: "xuanhuan",
      status: "active" as const,
      targetChapters: 120,
      chapterWordCount: 3000,
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
    })),
    loadChapterIndex: vi.fn(async () => [
      { number: 1, title: "第一章", status: "approved" as const, wordCount: 1200, createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z", auditIssues: [], lengthWarnings: [] },
      { number: 2, title: "第二章", status: "ready-for-review" as const, wordCount: 800, createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z", auditIssues: [], lengthWarnings: [] },
    ]),
    getNextChapterNumber: vi.fn(async () => 3),
    ...overrides,
  };
}

describe("books read service", () => {
  it("lists books with normalized chapter metrics without depending on Hono", async () => {
    const state = buildState();
    const syncBookScaffold = vi.fn(async () => undefined);
    const service = createBooksReadService({ state, syncBookScaffold });

    await expect(service.listBooks()).resolves.toEqual({
      books: [expect.objectContaining({
        id: "book-1",
        title: "灵潮纪元",
        chapters: 2,
        chapterCount: 2,
        totalChapters: 2,
        totalWords: 2000,
        approvedChapters: 1,
        pendingReview: 1,
        pendingReviewChapters: 1,
        progress: 1,
      })],
    });
    expect(syncBookScaffold).toHaveBeenCalledWith(expect.objectContaining({ id: "book-1" }));
  });

  it("reads book detail with normalized chapters and next chapter", async () => {
    const state = buildState();
    const service = createBooksReadService({ state, syncBookScaffold: vi.fn(async () => undefined) });

    await expect(service.getBookDetail("book-1")).resolves.toMatchObject({
      book: { id: "book-1", chapterCount: 2, totalWords: 2000 },
      chapters: [
        { number: 1, status: "approved" },
        { number: 2, status: "ready-for-review" },
      ],
      nextChapter: 3,
    });
  });

  it("propagates missing book failures so route adapters can preserve 404 behavior", async () => {
    const state = buildState({
      loadBookConfig: vi.fn(async () => {
        throw new Error("missing book");
      }),
    });
    const service = createBooksReadService({ state, syncBookScaffold: vi.fn(async () => undefined) });

    await expect(service.getBookDetail("missing")).rejects.toThrow("missing book");
  });
});
