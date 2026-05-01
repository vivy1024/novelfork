import { describe, expect, it, vi } from "vitest";

const { fetchJsonMock, postApiMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(async () => ({})),
  postApiMock: vi.fn(async () => ({})),
}));

vi.mock("../hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
  postApi: postApiMock,
  putApi: async () => ({}),
}));

import { api } from "./client";

describe("api client", () => {
  it("api.books.list calls /books", async () => {
    fetchJsonMock.mockResolvedValue({ books: [{ id: "b1", title: "Test" }] });
    const result = await api.books.list();
    expect(fetchJsonMock).toHaveBeenCalledWith("/books");
    expect(result.books[0].id).toBe("b1");
  });

  it("api.books.get calls /books/:id", async () => {
    fetchJsonMock.mockResolvedValue({ book: { id: "b1", title: "T" }, chapters: [], nextChapter: 1 });
    const result = await api.books.get("b1");
    expect(fetchJsonMock).toHaveBeenCalledWith("/books/b1");
    expect(result.book.id).toBe("b1");
  });

  it("api.chapters.get calls /books/:id/chapters/:num", async () => {
    fetchJsonMock.mockResolvedValue({ content: "text", chapterNumber: 1, filename: "0001.md" });
    const result = await api.chapters.get("b1", 1);
    expect(fetchJsonMock).toHaveBeenCalledWith("/books/b1/chapters/1");
    expect(result.content).toBe("text");
  });

  it("api.chapters.delete calls DELETE", async () => {
    fetchJsonMock.mockResolvedValue({ ok: true });
    await api.chapters.delete("b1", 1);
    expect(fetchJsonMock).toHaveBeenCalledWith("/books/b1/chapters/1", { method: "DELETE" });
  });

  it("api.progress.get calls /progress", async () => {
    fetchJsonMock.mockResolvedValue({ progress: { today: { written: 3000, target: 3000, completed: true }, streak: 5 } });
    const result = await api.progress.get();
    expect(result.progress?.streak).toBe(5);
  });
});
