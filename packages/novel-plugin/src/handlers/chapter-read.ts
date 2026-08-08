import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveBookStorageDir, type StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { createWritingResourceFileStore } from "../engine/writing-resource/file-store.js";
import { listChapterFiles } from "../engine/writing-resource/chapter-layout.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";

export interface ChapterReadInput {
  bookId: string;
  chapterNumber: number;
}

export interface ChapterReadResult {
  ok: boolean;
  summary: string;
  data?: { bookId: string; chapterNumber: number; fileName: string; content: string; wordCount: number };
  error?: string;
}

/**
 * Optional trusted resolver for hosts that have already bound a book resource.
 * Supplying either option intentionally bypasses resolveBookStorageDir, whose
 * legacy binding record may point outside the host-approved resource root.
 */
export interface TrustedChapterReadOptions {
  readonly bookRoot?: string;
  readonly resolveBookRoot?: (bookId: string) => string | undefined;
  readonly storage?: StorageDatabase;
}

/**
 * 读取指定章节文件内容。
 *
 * The legacy `(input, booksDir)` signature remains supported. Portable Runtime
 * callers pass a trusted root/resolver so `.novelfork-project-init.json` cannot
 * redirect the read to an external directory.
 */
export async function handleChapterRead(
  input: ChapterReadInput,
  booksDir?: string,
  trusted?: TrustedChapterReadOptions,
): Promise<ChapterReadResult> {
  const { bookId, chapterNumber } = input;
  const trustedBookRoot = trusted?.bookRoot ?? trusted?.resolveBookRoot?.(bookId);
  const bookRoot = trustedBookRoot
    ?? (booksDir ? resolveBookStorageDir(dirname(booksDir), bookId) : undefined);

  if (!bookRoot) {
    return { ok: false, error: "missing-book-root", summary: "缺少书籍存储目录，无法读取章节。" };
  }

  try {
    const resource = trusted?.storage
      ? await createWritingResourceService({
          storage: trusted.storage,
          resolveBookDir: () => bookRoot,
          resolveChapterVolumeDirectory: (requestedBookId, requestedChapterNumber) => (
            resolveChapterVolumeDirectory(trusted.storage!, requestedBookId, requestedChapterNumber)
          ),
        }).findAcceptedChapter(bookId, chapterNumber)
      : await createWritingResourceFileStore(() => bookRoot).findAcceptedChapter(bookId, chapterNumber);
    if (resource) {
      return {
        ok: true,
        summary: `已读取第 ${chapterNumber} 章（${resource.wordCount} 字）。`,
        data: {
          bookId,
          chapterNumber,
          fileName: typeof resource.metadata.fileName === "string" ? resource.metadata.fileName : `${resource.id}.md`,
          content: resource.content,
          wordCount: resource.wordCount,
        },
      };
    }
  } catch {
    // Fall back to the bound/legacy chapter path below.
  }

  const chapterFile = (await listChapterFiles(bookRoot)).find((file) => file.number === chapterNumber);
  if (!chapterFile) {
    return { ok: false, error: "chapter-not-found", summary: `第 ${chapterNumber} 章文件未找到。` };
  }

  try {
    const content = await readFile(join(bookRoot, chapterFile.relativePath), "utf-8");
    return {
      ok: true,
      summary: `已读取第 ${chapterNumber} 章（${content.length} 字）。`,
      data: { bookId, chapterNumber, fileName: chapterFile.chapterRelativePath, content, wordCount: content.length },
    };
  } catch (error) {
    return { ok: false, error: "read-failed", summary: `读取章节失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
