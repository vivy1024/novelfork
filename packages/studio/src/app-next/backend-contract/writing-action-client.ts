import { buildBookApiPath } from "./api-paths";
import type { ContractClient } from "./contract-client";

export function createWritingActionClient(contract: ContractClient) {
  return {
    previewWritingMode: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(buildBookApiPath(bookId, "inline-write"), payload, {
        capability: { id: "writing-modes.preview", status: "prompt-preview" },
      }),
    applyWritingMode: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(buildBookApiPath(bookId, "writing-modes", "apply"), payload, {
        capability: { id: "writing-modes.apply", status: "current" },
      }),

    generateHooks: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(buildBookApiPath(bookId, "hooks", "generate"), payload, {
        capability: { id: "hooks.generate", status: "current" },
      }),
    applyHook: <T = unknown>(bookId: string, payload: unknown) =>
      contract.post<T>(buildBookApiPath(bookId, "hooks", "apply"), payload, {
        capability: { id: "hooks.apply", status: "current" },
      }),
    auditChapter: <T = unknown>(bookId: string, chapterNumber: number | string) =>
      contract.post<T>(buildBookApiPath(bookId, "audit", chapterNumber), undefined, {
        capability: { id: "ai.audit", status: "current" },
      }),
    detectChapter: <T = unknown>(bookId: string, chapterNumber: number | string) =>
      contract.post<T>(buildBookApiPath(bookId, "detect", chapterNumber), undefined, {
        capability: { id: "ai.detect", status: "current" },
      }),
  };
}
