import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../hooks/use-api", () => ({
  fetchJson: vi.fn(),
  postApi: vi.fn(),
  useApi: (url: string) => {
    if (url === "/books/book-1") {
      return { data: { book: { id: "book-1", title: "凡人修仙录" }, nextChapter: 5 }, loading: false, error: null, refetch: vi.fn() };
    }
    return { data: undefined, loading: false, error: null, refetch: vi.fn() };
  },
}));

vi.mock("../lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { BibleView } from "./BibleView";

describe("BibleView user-visible naming", () => {
  afterEach(() => cleanup());

  it("uses 故事经纬 / 经纬 as the visible product naming instead of Bible", () => {
    render(<BibleView bookId="book-1" nav={{ toDashboard: vi.fn(), toBook: vi.fn() }} />);

    expect(screen.getAllByText("故事经纬").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("经纬栏目")).toBeTruthy();
    expect(screen.getByText("经纬模式")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bBible\b|Novel Bible|Bible Tabs|bible_mode/);
  });
});
