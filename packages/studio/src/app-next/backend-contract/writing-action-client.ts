import type { ContractClient } from "./contract-client";

export function createWritingActionClient(contract: ContractClient) {
  return {
    previewWritingMode: (bookId: string, payload: unknown) =>
      contract.post(`/api/books/${encodeURIComponent(bookId)}/inline-write`, payload, {
        capability: { id: "writing-modes.preview", status: "prompt-preview" },
      }),
    applyWritingMode: (bookId: string, payload: unknown) =>
      contract.post(`/api/books/${encodeURIComponent(bookId)}/writing-modes/apply`, payload, {
        capability: { id: "writing-modes.apply", status: "current" },
      }),
    startWriteNext: (bookId: string, payload?: unknown) =>
      contract.post(`/api/books/${encodeURIComponent(bookId)}/write-next`, payload, {
        capability: { id: "ai.write-next", status: "current" },
      }),
    startDraft: (bookId: string, payload?: unknown) =>
      contract.post(`/api/books/${encodeURIComponent(bookId)}/draft`, payload, {
        capability: { id: "ai.draft", status: "current" },
      }),
  };
}
