import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChapterWriteInput {
  bookId: string;
  chapterNumber: number;
  content: string;
}

export interface TrustedChapterWriteOptions {
  /** Absolute root supplied by the trusted Runtime resource binding. */
  bookRoot: string;
}

export type ChapterWriteResult =
  | {
      ok: true;
      summary: string;
      data: {
        bookId: string;
        chapterNumber: number;
        fileName: string;
        wordCount: number;
        updatedAt: string;
      };
    }
  | { ok: false; error: string; summary: string };

const CHAPTER_FILE_PATTERN = /^(\d{1,9})[_-].+\.md$/iu;
const MAX_CONTENT_LENGTH = 2_000_000;

function chapterNumberFromFileName(fileName: string): number | null {
  const match = CHAPTER_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const chapterNumber = Number(match[1]);
  return Number.isSafeInteger(chapterNumber) && chapterNumber > 0 ? chapterNumber : null;
}

function countWords(content: string): number {
  return (content.trim().match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

async function updateChapterIndex(
  bookRoot: string,
  chapterNumber: number,
  content: string,
  updatedAt: string,
): Promise<void> {
  const indexPath = join(bookRoot, "chapters", "index.json");
  const raw = await readFile(indexPath, "utf8").catch(() => "[]");
  let index: unknown;
  try {
    index = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(index)) return;
  const nextIndex = index.map((entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry) && Number((entry as Record<string, unknown>).number) === chapterNumber
      ? { ...(entry as Record<string, unknown>), wordCount: countWords(content), updatedAt }
      : entry
  ));
  await writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
}

/**
 * Write one existing chapter selected by its numeric resource identity.
 * The caller supplies a trusted root, and this function selects a directory entry
 * itself rather than accepting a client/model path.
 */
export async function handleChapterWrite(
  input: ChapterWriteInput,
  options: TrustedChapterWriteOptions,
): Promise<ChapterWriteResult> {
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) {
    return { ok: false, error: "invalid-input", summary: "chapterNumber 必须是正整数。" };
  }
  if (typeof input.content !== "string" || input.content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: "invalid-input", summary: `章节正文必须是长度不超过 ${MAX_CONTENT_LENGTH} 的字符串。` };
  }

  try {
    const entries = await readdir(join(options.bookRoot, "chapters"), { withFileTypes: true });
    const matched = entries.find((entry) => entry.isFile() && chapterNumberFromFileName(entry.name) === input.chapterNumber);
    if (!matched) {
      return { ok: false, error: "chapter-not-found", summary: `章节 ${input.chapterNumber} 不存在，拒绝写入。` };
    }

    const chapterPath = join(options.bookRoot, "chapters", matched.name);
    const updatedAt = new Date().toISOString();
    await writeFile(chapterPath, input.content, "utf8");
    await updateChapterIndex(options.bookRoot, input.chapterNumber, input.content, updatedAt);

    return {
      ok: true,
      summary: `已写入第 ${input.chapterNumber} 章，等待 Runtime 权限确认记录完成。`,
      data: {
        bookId: input.bookId,
        chapterNumber: input.chapterNumber,
        fileName: matched.name,
        wordCount: countWords(input.content),
        updatedAt,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: "chapter-write-failed",
      summary: `章节写入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
