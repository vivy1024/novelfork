import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterMeta, StateManager } from "@vivy1024/novelfork-core";
import { isSafeStoryFileName } from "./story-file-service.js";

export interface StorageDestructiveServiceState {
  readonly bookDir: Pick<StateManager, "bookDir">["bookDir"];
  readonly loadChapterIndex: Pick<StateManager, "loadChapterIndex">["loadChapterIndex"];
  readonly saveChapterIndex: Pick<StateManager, "saveChapterIndex">["saveChapterIndex"];
}

export interface StorageDestructiveServiceOptions {
  readonly state: StorageDestructiveServiceState;
  readonly deleteBookRecord: (bookId: string) => unknown;
}

export function createStorageDestructiveService(options: StorageDestructiveServiceOptions) {
  const { state, deleteBookRecord } = options;

  return {
    async deleteBook(bookId: string) {
      await rm(state.bookDir(bookId), { recursive: true, force: true });
      deleteBookRecord(bookId);
      return { ok: true, bookId, mode: "hard-delete" as const };
    },

    async deleteChapter(bookId: string, chapterNumber: number) {
      const chaptersDir = join(state.bookDir(bookId), "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNumber).padStart(4, "0");
      const match = files.find((file) => file.startsWith(paddedNum) && file.endsWith(".md"));
      if (!match) return { error: "Chapter not found" as const };

      await rm(join(chaptersDir, match));
      const index = await state.loadChapterIndex(bookId);
      const updated = (index as ReadonlyArray<ChapterMeta>).filter((chapter) => chapter.number !== chapterNumber);
      await state.saveChapterIndex(bookId, updated);
      return { ok: true, chapterNumber, mode: "hard-delete" as const };
    },

    async deleteStoryFile(bookId: string, file: string) {
      if (!isSafeStoryFileName(file)) return { error: "Invalid file name" as const };
      await rm(join(state.bookDir(bookId), "story", file));
      return { ok: true, file, mode: "hard-delete" as const };
    },
  };
}
