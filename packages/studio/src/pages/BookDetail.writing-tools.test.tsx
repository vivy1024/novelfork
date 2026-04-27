import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.fn();
const useNovelForkMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: vi.fn(),
  postApi: vi.fn(),
}));

vi.mock("../providers/novelfork-context", () => ({
  useNovelFork: () => useNovelForkMock(),
}));

vi.mock("@/lib/notify", () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/writing-tools/DailyProgressTracker", () => ({
  DailyProgressTracker: () => <section>日更进度追踪</section>,
}));

vi.mock("@/components/writing-tools/PovDashboard", () => ({
  PovDashboard: ({ dashboard }: { dashboard: { characters: ReadonlyArray<{ name: string }> } }) => (
    <section>POV 视角仪表盘：{dashboard.characters.map((character) => character.name).join("、")}</section>
  ),
}));

import { BookDetail } from "./BookDetail";

describe("BookDetail writing tools integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNovelForkMock.mockReturnValue({
      ai: { writeNext: vi.fn(), draft: vi.fn(), rewrite: vi.fn(), revise: vi.fn(), resync: vi.fn(), audit: vi.fn() },
      storage: { exportBook: vi.fn(), deleteBook: vi.fn(), approveChapter: vi.fn(), rejectChapter: vi.fn(), updateBook: vi.fn() },
    });
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books/book-1") {
        return {
          data: {
            book: { id: "book-1", title: "烟测样书", genre: "xianxia", status: "active", chapterWordCount: 3000, targetChapters: 10 },
            chapters: [],
            nextChapter: 1,
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/books/book-1/pov") {
        return {
          data: {
            currentChapter: 12,
            characters: [
              { name: "林月", totalChapters: 5, lastAppearanceChapter: 11, gapSinceLastAppearance: 1, chapterNumbers: [1, 3, 5, 9, 11] },
              { name: "沈舟", totalChapters: 3, lastAppearanceChapter: 4, gapSinceLastAppearance: 8, chapterNumbers: [2, 3, 4] },
            ],
            warnings: [],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/providers/status") {
        return { data: { status: { hasUsableModel: true } }, loading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("renders POV dashboard and daily progress on the book overview", () => {
    render(
      <BookDetail
        bookId="book-1"
        nav={{ toDashboard: vi.fn(), toChapter: vi.fn(), toAnalytics: vi.fn(), toDetect: vi.fn(), toPublishReadiness: vi.fn(), toAdmin: vi.fn() }}
        theme="light"
        t={((key: string) => key) as never}
        sse={{ messages: [] }}
      />,
    );

    expect(screen.getByText("日更进度追踪")).toBeTruthy();
    expect(screen.getByText("POV 视角仪表盘：林月、沈舟")).toBeTruthy();
  });
});
