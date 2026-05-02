/**
 * HttpStorageAdapter — calls existing /api/* endpoints via fetch.
 * Used by the current Studio web runtime.
 */

import type {
  ClientStorageAdapter,
  BookSummary,
  BookData,
  ChapterDetail,
  TruthFileEntry,
  TruthFileContent,
  CreateBookParams,
  BookUpdates,
  ProjectConfig,
} from "./adapter.js";
import { fetchJson, postApi, putApi } from "../hooks/use-api.js";

export class HttpStorageAdapter implements ClientStorageAdapter {
  async listBooks(): Promise<ReadonlyArray<BookSummary>> {
    const res = await fetchJson<{ books: BookSummary[] }>("/books");
    return res.books;
  }

  async loadBook(bookId: string): Promise<BookData> {
    return fetchJson<BookData>(`/books/${bookId}`);
  }

  async createBook(params: CreateBookParams): Promise<{ status: string; bookId: string }> {
    return postApi<{ status: string; bookId: string }>("/books/create", params);
  }

  async updateBook(bookId: string, updates: BookUpdates): Promise<void> {
    await putApi(`/books/${bookId}`, updates);
  }

  async deleteBook(bookId: string): Promise<void> {
    await fetchJson(`/books/${bookId}`, { method: "DELETE" });
  }

  async loadChapter(bookId: string, num: number): Promise<ChapterDetail> {
    return fetchJson<ChapterDetail>(`/books/${bookId}/chapters/${num}`);
  }

  async saveChapter(bookId: string, num: number, content: string): Promise<void> {
    await putApi(`/books/${bookId}/chapters/${num}`, { content });
  }

  async approveChapter(bookId: string, num: number): Promise<void> {
    await postApi(`/books/${bookId}/chapters/${num}/approve`);
  }

  async rejectChapter(bookId: string, num: number): Promise<void> {
    await postApi(`/books/${bookId}/chapters/${num}/reject`);
  }

  async listTruthFiles(bookId: string): Promise<ReadonlyArray<TruthFileEntry>> {
    const res = await fetchJson<{ files: TruthFileEntry[] }>(`/books/${bookId}/truth`);
    return res.files;
  }

  async loadTruthFile(bookId: string, file: string): Promise<TruthFileContent> {
    return fetchJson<TruthFileContent>(`/books/${bookId}/truth/${file}`);
  }

  async saveTruthFile(bookId: string, file: string, content: string): Promise<void> {
    await putApi(`/books/${bookId}/truth/${file}`, { content });
  }

  async loadProject(): Promise<ProjectConfig> {
    return fetchJson<ProjectConfig>("/project");
  }

  async updateProject(updates: Record<string, unknown>): Promise<void> {
    await putApi("/project", updates);
  }
}
