import type { BookDetailResponse, BookListResponse, ChapterContentResponse, SaveChapterPayload, SaveChapterResponse } from "../../shared/contracts";
import type { ContractClient } from "./contract-client";

export interface SaveDraftPayload {
  readonly id?: string;
  readonly [key: string]: unknown;
}

export function createResourceClient(contract: ContractClient) {
  return {
    listBooks: <T = BookListResponse>() => contract.get<T>("/api/books", { capability: { id: "books.list", status: "current" } }),
    getBook: <T = BookDetailResponse>(bookId: string) => contract.get<T>(`/api/books/${encodeURIComponent(bookId)}`, { capability: { id: "books.detail", status: "current" } }),
    getBookCreateStatus: <T = { status: "creating" | "error" | "ready"; error?: string }>(bookId: string) =>
      contract.get<T>(`/api/books/${encodeURIComponent(bookId)}/create-status`, { capability: { id: "books.create-status", status: "process-memory" } }),
    getChapter: <T = ChapterContentResponse>(bookId: string, chapterNumber: number | string) =>
      contract.get<T>(`/api/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(String(chapterNumber))}`, { capability: { id: "chapters.detail", status: "current" } }),
    saveChapter: <T = SaveChapterResponse>(bookId: string, chapterNumber: number | string, payload: SaveChapterPayload) =>
      contract.put<T>(`/api/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(String(chapterNumber))}`, payload, { capability: { id: "chapters.save", status: "current" } }),
    listCandidates: <T = unknown>(bookId: string) =>
      contract.get<T>(`/api/books/${encodeURIComponent(bookId)}/candidates`, { capability: { id: "candidates.list", status: "current" } }),
    acceptCandidate: <T = unknown>(bookId: string, candidateId: string, payload: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/candidates/${encodeURIComponent(candidateId)}/accept`, payload, { capability: { id: "candidates.accept", status: "current" } }),
    listDrafts: <T = unknown>(bookId: string) =>
      contract.get<T>(`/api/books/${encodeURIComponent(bookId)}/drafts`, { capability: { id: "drafts.list", status: "current" } }),
    getDraft: <T = unknown>(bookId: string, draftId: string) =>
      contract.get<T>(`/api/books/${encodeURIComponent(bookId)}/drafts/${encodeURIComponent(draftId)}`, { capability: { id: "drafts.detail", status: "current" } }),
    saveDraft: <T = unknown>(bookId: string, payload: SaveDraftPayload) => {
      const draftId = payload && typeof payload === "object" && "id" in payload ? payload.id : undefined;
      if (typeof draftId === "string" && draftId.length > 0) {
        return contract.put<T>(`/api/books/${encodeURIComponent(bookId)}/drafts/${encodeURIComponent(draftId)}`, payload, { capability: { id: "drafts.save", status: "current" } });
      }
      return contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/drafts`, payload, { capability: { id: "drafts.save", status: "current" } });
    },
    deleteDraft: <T = unknown>(bookId: string, draftId: string) =>
      contract.delete<T>(`/api/books/${encodeURIComponent(bookId)}/drafts/${encodeURIComponent(draftId)}`, { capability: { id: "drafts.delete", status: "current" } }),
  };
}
