import type { NarrativeLineSnapshot } from "../../shared/agent-native-workspace";
import type { BookDetailResponse, BookListResponse, ChapterContentResponse, SaveChapterPayload, SaveChapterResponse } from "../../shared/contracts";
import { BOOK_CREATE_API_PATH, BOOKS_API_PATH, appendApiQuery, buildBookApiPath, buildWorktreeStatusApiPath } from "./api-paths";
import type { ContractClient } from "./contract-client";

export interface SaveDraftPayload {
  readonly id?: string;
  readonly [key: string]: unknown;
}

export interface SaveJingweiEntryPayload {
  readonly title?: string;
  readonly contentMd?: string;
  readonly sectionId?: string;
  readonly [key: string]: unknown;
}

export interface CreateBookPayload {
  readonly title: string;
  readonly genre?: string;
  readonly language?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
  readonly [key: string]: unknown;
}

export interface CreateBookResponse {
  readonly bookId: string;
  readonly [key: string]: unknown;
}

export interface WorktreeStatusResponse {
  readonly status: {
    readonly modified?: readonly unknown[];
    readonly added?: readonly unknown[];
    readonly deleted?: readonly unknown[];
    readonly untracked?: readonly unknown[];
  };
}

export function createResourceClient(contract: ContractClient) {
  return {
    listBooks: <T = BookListResponse>() => contract.get<T>(BOOKS_API_PATH, { capability: { id: "books.list", status: "current" } }),
    createBook: <T = CreateBookResponse>(payload: CreateBookPayload) => contract.post<T>(BOOK_CREATE_API_PATH, payload, { capability: { id: "books.create", status: "current" } }),
    getWorktreeStatus: <T = WorktreeStatusResponse>(worktreePath: string) => contract.get<T>(buildWorktreeStatusApiPath(worktreePath), { capability: { id: "worktree.status", status: "current" } }),
    getBook: <T = BookDetailResponse>(bookId: string) => contract.get<T>(buildBookApiPath(bookId), { capability: { id: "books.detail", status: "current" } }),
    getBookCreateStatus: <T = { status: "creating" | "error" | "ready"; error?: string }>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "create-status"), { capability: { id: "books.create-status", status: "process-memory" } }),
    getChapter: <T = ChapterContentResponse>(bookId: string, chapterNumber: number | string) =>
      contract.get<T>(buildBookApiPath(bookId, "chapters", chapterNumber), { capability: { id: "chapters.detail", status: "current" } }),
    saveChapter: <T = SaveChapterResponse>(bookId: string, chapterNumber: number | string, payload: SaveChapterPayload) =>
      contract.put<T>(buildBookApiPath(bookId, "chapters", chapterNumber), payload, { capability: { id: "chapters.save", status: "current" } }),
    previewRewind: <T = unknown>(bookId: string, checkpointId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "checkpoints", checkpointId, "rewind", "preview"), { capability: { id: "resources.rewind.preview", status: "current" } }),
    applyRewind: <T = unknown>(bookId: string, checkpointId: string, payload: unknown) =>
      contract.post<T>(buildBookApiPath(bookId, "checkpoints", checkpointId, "rewind", "apply"), payload, { capability: { id: "resources.rewind.apply", status: "current" } }),
    listCheckpoints: <T = unknown>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "checkpoints"), { capability: { id: "resources.checkpoints.list", status: "current" } }),
    listCandidates: <T = unknown>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "candidates"), { capability: { id: "candidates.list", status: "current" } }),
    acceptCandidate: <T = unknown>(bookId: string, candidateId: string, payload: unknown) =>
      contract.post<T>(buildBookApiPath(bookId, "candidates", candidateId, "accept"), payload, { capability: { id: "candidates.accept", status: "current" } }),
    rejectCandidate: <T = unknown>(bookId: string, candidateId: string) =>
      contract.post<T>(buildBookApiPath(bookId, "candidates", candidateId, "reject"), {}, { capability: { id: "candidates.reject", status: "current" } }),
    archiveCandidate: <T = unknown>(bookId: string, candidateId: string) =>
      contract.post<T>(buildBookApiPath(bookId, "candidates", candidateId, "archive"), {}, { capability: { id: "candidates.archive", status: "current" } }),
    deleteCandidate: <T = unknown>(bookId: string, candidateId: string) =>
      contract.delete<T>(buildBookApiPath(bookId, "candidates", candidateId), { capability: { id: "candidates.delete", status: "current" } }),
    listDrafts: <T = unknown>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "drafts"), { capability: { id: "drafts.list", status: "current" } }),
    getDraft: <T = unknown>(bookId: string, draftId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "drafts", draftId), { capability: { id: "drafts.detail", status: "current" } }),
    saveDraft: <T = unknown>(bookId: string, payload: SaveDraftPayload) => {
      const draftId = payload && typeof payload === "object" && "id" in payload ? payload.id : undefined;
      if (typeof draftId === "string" && draftId.length > 0) {
        return contract.put<T>(buildBookApiPath(bookId, "drafts", draftId), payload, { capability: { id: "drafts.save", status: "current" } });
      }
      return contract.post<T>(buildBookApiPath(bookId, "drafts"), payload, { capability: { id: "drafts.save", status: "current" } });
    },
    deleteDraft: <T = unknown>(bookId: string, draftId: string) =>
      contract.delete<T>(buildBookApiPath(bookId, "drafts", draftId), { capability: { id: "drafts.delete", status: "current" } }),
    listStoryFiles: <T = unknown>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "story-files"), { capability: { id: "story-files.list", status: "current" } }),
    getStoryFile: <T = { file: string; content: string | null }>(bookId: string, fileName: string) =>
      contract.get<T>(buildBookApiPath(bookId, "story-files", fileName), { capability: { id: "story-files.detail", status: "current" } }),
    deleteStoryFile: <T = { ok: true; file: string }>(bookId: string, fileName: string) =>
      contract.delete<T>(buildBookApiPath(bookId, "story-files", fileName), { capability: { id: "story-files.delete", status: "current" } }),
    listJingweiFiles: <T = unknown>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "jingwei-files"), { capability: { id: "jingwei-files.list", status: "current" } }),
    getJingweiFile: <T = { file: string; content: string | null }>(bookId: string, fileName: string) =>
      contract.get<T>(buildBookApiPath(bookId, "jingwei-files", fileName), { capability: { id: "jingwei-files.detail", status: "current" } }),
    saveJingweiFile: <T = { ok: true }>(bookId: string, fileName: string, payload: { content: string }) =>
      contract.put<T>(buildBookApiPath(bookId, "truth", fileName), payload, { capability: { id: "jingwei-files.save", status: "current" } }),
    deleteJingweiFile: <T = { ok: true; file: string }>(bookId: string, fileName: string) =>
      contract.delete<T>(buildBookApiPath(bookId, "jingwei-files", fileName), { capability: { id: "jingwei-files.delete", status: "current" } }),
    listJingweiSections: <T = unknown>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "jingwei", "sections"), { capability: { id: "jingwei.sections", status: "current" } }),
    listJingweiEntries: <T = unknown>(bookId: string, sectionId?: string) => {
      const query = sectionId ? `sectionId=${encodeURIComponent(sectionId)}` : "";
      return contract.get<T>(appendApiQuery(buildBookApiPath(bookId, "jingwei", "entries"), query), { capability: { id: "jingwei.entries", status: "current" } });
    },
    saveJingweiEntry: <T = unknown>(bookId: string, entryId: string, payload: SaveJingweiEntryPayload) =>
      contract.put<T>(buildBookApiPath(bookId, "jingwei", "entries", entryId), payload, { capability: { id: "jingwei.entries.update", status: "current" } }),
    createJingweiEntry: <T = unknown>(bookId: string, payload: SaveJingweiEntryPayload) =>
      contract.post<T>(buildBookApiPath(bookId, "jingwei", "entries"), payload, { capability: { id: "jingwei.entries.create", status: "current" } }),
    deleteJingweiEntry: <T = unknown>(bookId: string, entryId: string) =>
      contract.delete<T>(buildBookApiPath(bookId, "jingwei", "entries", entryId), { capability: { id: "jingwei.entries.delete", status: "current" } }),
    getNarrativeLine: <T = { snapshot: NarrativeLineSnapshot }>(bookId: string) =>
      contract.get<T>(buildBookApiPath(bookId, "narrative-line"), { capability: { id: "narrative-line.read", status: "current" } }),
  };
}
