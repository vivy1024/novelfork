import type { ContractClient } from "./contract-client";

export function createWritingActionClient(contract: ContractClient) {
  return {
    previewWritingMode: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/inline-write`, payload, {
        capability: { id: "writing-modes.preview", status: "prompt-preview" },
      }),
    applyWritingMode: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/writing-modes/apply`, payload, {
        capability: { id: "writing-modes.apply", status: "current" },
      }),
    startWriteNext: <T = unknown>(bookId: string, payload?: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/write-next`, payload, {
        capability: { id: "ai.write-next", status: "current" },
      }),
    startDraft: <T = unknown>(bookId: string, payload?: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/draft`, payload, {
        capability: { id: "ai.draft", status: "current" },
      }),
    generateHooks: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/hooks/generate`, payload, {
        capability: { id: "hooks.generate", status: "current" },
      }),
    applyHook: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/hooks/apply`, payload, {
        capability: { id: "hooks.apply", status: "current" },
      }),
    auditChapter: <T = unknown>(bookId: string, chapterNumber: number | string) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/audit/${encodeURIComponent(String(chapterNumber))}`, undefined, {
        capability: { id: "ai.audit", status: "current" },
      }),
    detectChapter: <T = unknown>(bookId: string, chapterNumber: number | string) =>
      contract.post<T>(`/api/books/${encodeURIComponent(bookId)}/detect/${encodeURIComponent(String(chapterNumber))}`, undefined, {
        capability: { id: "ai.detect", status: "current" },
      }),
  };
}
