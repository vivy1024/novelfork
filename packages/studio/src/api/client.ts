/** NovelFork API Client — 统一的前端 API 调用层 */

import { fetchJson, postApi, putApi } from "../hooks/use-api";

// ── Books ──

interface BookListItem {
  id: string; title: string; status?: string; totalChapters?: number;
}

interface BookDetail {
  book: { id: string; title: string; genre?: string; platform?: string; chapterWordCount?: number; targetChapters?: number; language?: string };
  chapters: Array<{ number: number; title?: string; wordCount?: number; status?: string }>;
  nextChapter: number;
}

export const api = {
  books: {
    list: () => fetchJson<{ books: BookListItem[] }>("/books"),
    get: (id: string) => fetchJson<BookDetail>(`/books/${id}`),
    create: (data: { title: string; genre?: string; platform?: string; chapterWordCount?: number; targetChapters?: number }) =>
      postApi<{ bookId: string; status: string }>("/books/create", data),
    delete: (id: string) => fetchJson<{ ok: boolean }>(`/books/${id}`, { method: "DELETE" }),
  },

  chapters: {
    get: (bookId: string, num: number) => fetchJson<{ content: string; chapterNumber: number; filename: string }>(`/books/${bookId}/chapters/${num}`),
    save: (bookId: string, num: number, content: string) =>
      putApi<{ ok: boolean; chapterNumber: number }>(`/books/${bookId}/chapters/${num}`, { content }),
    create: (bookId: string, title?: string) =>
      postApi<{ chapter: { number: number; title: string; wordCount: number; status: string } }>(`/books/${bookId}/chapters`, { title }),
    delete: (bookId: string, num: number) => fetchJson<{ ok: boolean }>(`/books/${bookId}/chapters/${num}`, { method: "DELETE" }),
  },

  candidates: {
    list: (bookId: string) => fetchJson<{ candidates: Array<{ id: string; title: string; source: string; status: string; createdAt: string; metadata?: Record<string, unknown> }> }>(`/books/${bookId}/candidates`),
    accept: (bookId: string, candidateId: string, action: "merge" | "replace" | "draft") =>
      postApi<{ candidate: Record<string, unknown>; draft?: Record<string, unknown> }>(`/books/${bookId}/candidates/${candidateId}/accept`, { action }),
    reject: (bookId: string, candidateId: string) => postApi<{ candidate: Record<string, unknown> }>(`/books/${bookId}/candidates/${candidateId}/reject`),
    delete: (bookId: string, candidateId: string) => fetchJson<{ ok: boolean }>(`/books/${bookId}/candidates/${candidateId}`, { method: "DELETE" }),
  },

  drafts: {
    list: (bookId: string) => fetchJson<{ drafts: Array<{ id: string; title: string; wordCount: number; updatedAt: string }> }>(`/books/${bookId}/drafts`),
    delete: (bookId: string, draftId: string) => fetchJson<{ ok: boolean }>(`/books/${bookId}/drafts/${draftId}`, { method: "DELETE" }),
  },

  progress: {
    get: () => fetchJson<{ progress?: { today: { written: number; target: number; completed: boolean }; streak: number } }>("/progress"),
  },
};
