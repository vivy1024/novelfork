import type { ContractClient } from "./contract-client";

export function createResourceClient(contract: ContractClient) {
  return {
    listBooks: () => contract.get("/api/books", { capability: { id: "books.list", status: "current" } }),
    getBook: (bookId: string) => contract.get(`/api/books/${encodeURIComponent(bookId)}`, { capability: { id: "books.detail", status: "current" } }),
    getBookCreateStatus: (bookId: string) =>
      contract.get(`/api/books/${encodeURIComponent(bookId)}/create-status`, { capability: { id: "books.create-status", status: "process-memory" } }),
    listCandidates: (bookId: string) =>
      contract.get(`/api/books/${encodeURIComponent(bookId)}/candidates`, { capability: { id: "candidates.list", status: "current" } }),
    listDrafts: (bookId: string) =>
      contract.get(`/api/books/${encodeURIComponent(bookId)}/drafts`, { capability: { id: "drafts.list", status: "current" } }),
  };
}
