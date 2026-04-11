import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";

export type ChapterStatus = "draft" | "pending_audit" | "approved" | "rejected";

export interface TruthFilesData {
  readonly currentState: string;
  readonly particleLedger: string;
  readonly pendingHooks: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
}

export interface ControlDocuments {
  readonly authorIntent: string;
  readonly currentFocus: string;
  readonly runtimeDir: string;
}

export interface WriteSnapshot {
  readonly bookConfig: BookConfig;
  readonly chapterIndex: ReadonlyArray<ChapterMeta>;
  readonly recentChapters: ReadonlyArray<{
    readonly num: number;
    readonly summary: string;
    readonly content?: string;
  }>;
  readonly truthFiles: TruthFilesData;
  readonly controlDocs: ControlDocuments;
  readonly outline: string;
  readonly styleProfile?: string;
}

export interface MutationOp {
  readonly path: string;
  readonly op: "create" | "update" | "delete";
  readonly content?: string;
}

export interface ChapterUpdate {
  readonly num: number;
  readonly status: ChapterStatus;
  readonly meta?: Partial<ChapterMeta>;
}

export interface MutationSet {
  readonly operations: ReadonlyArray<MutationOp>;
  readonly chapterUpdates?: ReadonlyArray<ChapterUpdate>;
}

export interface WriteLockHandle {
  readonly lockId: string;
  release(): void;
}

export interface StorageAdapter {
  listBooks(): Promise<string[]>;
  loadBookConfig(bookId: string): Promise<BookConfig>;
  saveBookConfig(bookId: string, config: BookConfig): Promise<void>;
  deleteBook(bookId: string): Promise<void>;

  loadChapterIndex(bookId: string): Promise<ChapterMeta[]>;
  loadChapterContent(bookId: string, num: number): Promise<string>;
  saveChapterContent(
    bookId: string,
    num: number,
    content: string,
    meta: ChapterMeta,
  ): Promise<void>;

  loadTruthFiles(bookId: string): Promise<TruthFilesData>;
  saveTruthFile(
    bookId: string,
    file: string,
    content: string,
  ): Promise<void>;
  loadControlDocuments(bookId: string): Promise<ControlDocuments>;

  prepareWriteSnapshot(bookId: string): Promise<WriteSnapshot>;

  applyMutationSet(
    bookId: string,
    mutations: MutationSet,
    lockId: string,
  ): Promise<void>;

  acquireWriteLock(bookId: string): Promise<WriteLockHandle>;
}
