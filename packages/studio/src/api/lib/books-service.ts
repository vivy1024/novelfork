import { normalizeBookStatus, normalizeChapterStatus } from "@vivy1024/novelfork-core";
import type { StateManager } from "@vivy1024/novelfork-core";

export interface BooksReadServiceOptions {
  readonly state: Pick<StateManager, "listBooks" | "loadBookConfig" | "loadChapterIndex" | "getNextChapterNumber">;
  readonly syncBookScaffold: (bookConfig: Record<string, unknown>) => Promise<void>;
}

function numericField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeApiChapter(chapter: Record<string, unknown>): Record<string, unknown> {
  return {
    ...chapter,
    status: normalizeChapterStatus(chapter.status),
  };
}

export function normalizeApiChapters(chapters: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<Record<string, unknown>> {
  return chapters.map(normalizeApiChapter);
}

export function normalizeApiBook(book: Record<string, unknown>, chapters: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  const normalizedChapters = normalizeApiChapters(chapters);
  const approvedChapters = normalizedChapters.filter((chapter) => chapter.status === "approved" || chapter.status === "published").length;
  const pendingReviewChapters = normalizedChapters.filter((chapter) => chapter.status === "ready-for-review").length;
  return {
    ...book,
    status: normalizeBookStatus(book.status),
    chapters: normalizedChapters.length,
    chapterCount: normalizedChapters.length,
    totalChapters: normalizedChapters.length,
    totalWords: normalizedChapters.reduce((sum, chapter) => sum + numericField(chapter.wordCount), 0),
    approvedChapters,
    pendingReview: pendingReviewChapters,
    pendingReviewChapters,
    failedReview: 0,
    failedChapters: 0,
    progress: approvedChapters,
  };
}

export function createBooksReadService(options: BooksReadServiceOptions) {
  const { state, syncBookScaffold } = options;

  return {
    async listBooks(): Promise<{ readonly books: ReadonlyArray<Record<string, unknown>> }> {
      const bookIds = await state.listBooks();
      const books = await Promise.all(
        bookIds.map(async (id) => {
          const book = await state.loadBookConfig(id) as unknown as Record<string, unknown>;
          await syncBookScaffold(book);
          const chapters = await state.loadChapterIndex(id).catch(() => []) as unknown as ReadonlyArray<Record<string, unknown>>;
          return normalizeApiBook(book, chapters);
        }),
      );

      return { books };
    },

    async getBookDetail(id: string): Promise<{
      readonly book: Record<string, unknown>;
      readonly chapters: ReadonlyArray<Record<string, unknown>>;
      readonly nextChapter: number;
    }> {
      const book = await state.loadBookConfig(id) as unknown as Record<string, unknown>;
      await syncBookScaffold(book);
      const chapters = await state.loadChapterIndex(id) as unknown as ReadonlyArray<Record<string, unknown>>;
      const nextChapter = await state.getNextChapterNumber(id);
      return {
        book: normalizeApiBook(book, chapters),
        chapters: normalizeApiChapters(chapters),
        nextChapter,
      };
    },
  };
}
