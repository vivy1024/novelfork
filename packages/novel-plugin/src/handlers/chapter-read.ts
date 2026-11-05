import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveBookStorageDir, type StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { createWritingResourceFileStore } from "../engine/writing-resource/file-store.js";
import { listChapterFiles } from "../engine/writing-resource/chapter-layout.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";
import { proseSha256 } from "../engine/writing-resource/prose-digest.js";

export interface ChapterReadInput {
  bookId: string;
  chapterNumber: number;
  /** 可选：从第几个字符开始读（按码点计，0 起）。缺省读整章。 */
  offset?: number;
  /** 可选：最多读多少个字符。缺省读到结尾。 */
  limit?: number;
}

export interface ChapterReadRange {
  readonly offset: number;
  readonly length: number;
  /** 整章字符数（按码点计）。 */
  readonly totalChars: number;
  /** 后面是否还有没读到的正文。 */
  readonly hasMore: boolean;
}

export interface ChapterReadResult {
  ok: boolean;
  summary: string;
  data?: {
    bookId: string;
    chapterNumber: number;
    fileName: string;
    content: string;
    wordCount: number;
    /** 整章正文（不是本次片段）的 sha256，可直接作为 chapter.write / pipeline.write 的 expectedHash。 */
    sha256: string;
    /** 只在传了 offset / limit 时出现。 */
    range?: ChapterReadRange;
  };
  error?: string;
}

function normalizeRangeInput(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 按码点切片；没传 offset / limit 时原样返回整章。 */
function sliceChapter(content: string, input: ChapterReadInput): { content: string; range?: ChapterReadRange } {
  const offset = normalizeRangeInput(input.offset);
  const limit = normalizeRangeInput(input.limit);
  if (offset === undefined && limit === undefined) return { content };
  const codePoints = Array.from(content);
  const start = Math.min(offset ?? 0, codePoints.length);
  const end = limit === undefined ? codePoints.length : Math.min(codePoints.length, start + limit);
  return {
    content: codePoints.slice(start, end).join(""),
    range: { offset: start, length: end - start, totalChars: codePoints.length, hasMore: end < codePoints.length },
  };
}

function rangeSummary(range: ChapterReadRange | undefined): string {
  if (!range) return "";
  return `本次读取第 ${range.offset + 1}-${range.offset + range.length} 字（共 ${range.totalChars} 字${range.hasMore ? "，后面还有" : ""}）。`;
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
      const sliced = sliceChapter(resource.content, input);
      return {
        ok: true,
        summary: `已读取第 ${chapterNumber} 章（${resource.wordCount} 字）。${rangeSummary(sliced.range)}`,
        data: {
          bookId,
          chapterNumber,
          fileName: typeof resource.metadata.fileName === "string" ? resource.metadata.fileName : `${resource.id}.md`,
          content: sliced.content,
          wordCount: resource.wordCount,
          sha256: proseSha256(resource.content),
          ...(sliced.range ? { range: sliced.range } : {}),
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
    const sliced = sliceChapter(content, input);
    return {
      ok: true,
      summary: `已读取第 ${chapterNumber} 章（${content.length} 字）。${rangeSummary(sliced.range)}`,
      data: {
        bookId,
        chapterNumber,
        fileName: chapterFile.chapterRelativePath,
        content: sliced.content,
        wordCount: content.length,
        sha256: proseSha256(content),
        ...(sliced.range ? { range: sliced.range } : {}),
      },
    };
  } catch (error) {
    return { ok: false, error: "read-failed", summary: `读取章节失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
