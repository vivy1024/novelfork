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
  };
}
