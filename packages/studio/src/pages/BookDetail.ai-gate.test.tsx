import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { BookDetail } from "./BookDetail";

describe("BookDetail AI gate", () => {
  const writeNextMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useNovelForkMock.mockReturnValue({
      ai: {
        writeNext: writeNextMock,
        draft: vi.fn(),
        rewrite: vi.fn(),
        revise: vi.fn(),
        resync: vi.fn(),
        audit: vi.fn(async () => ({ passed: true, issues: [] })),
      },
      storage: {
        exportBook: vi.fn(),
        deleteBook: vi.fn(),
        approveChapter: vi.fn(),
        rejectChapter: vi.fn(),
        updateBook: vi.fn(),
      },
    });
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books/book-1") {
        return {
          data: {
            book: {
              id: "book-1",
              title: "烟测样书",
              genre: "xianxia",
              status: "active",
              chapterWordCount: 3000,
              targetChapters: 10,
              language: "zh",
              fanficMode: "disabled",
            },
            chapters: [],
            nextChapter: 1,
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/providers/status") {
        return {
          data: { status: { hasUsableModel: false } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("blocks write-next when no model is configured", async () => {
    render(
      <BookDetail
        bookId="book-1"
        nav={{ toDashboard: vi.fn(), toChapter: vi.fn(), toAnalytics: vi.fn(), toDetect: vi.fn(), toPublishReadiness: vi.fn(), toAdmin: vi.fn() }}
        theme="light"
        t={((key: string) => key) as never}
        sse={{ messages: [] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "book.writeNext" }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(writeNextMock).not.toHaveBeenCalled();
  });

  it("opens publish readiness from the book toolbar", () => {
    const toPublishReadiness = vi.fn();

    render(
      <BookDetail
        bookId="book-1"
        nav={{ toDashboard: vi.fn(), toChapter: vi.fn(), toAnalytics: vi.fn(), toDetect: vi.fn(), toPublishReadiness, toAdmin: vi.fn() }}
        theme="light"
        t={((key: string) => key) as never}
        sse={{ messages: [] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发布就绪检查" }));

    expect(toPublishReadiness).toHaveBeenCalledWith("book-1");
  });
});
