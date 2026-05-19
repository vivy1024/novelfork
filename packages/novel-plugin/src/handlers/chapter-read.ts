import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceRepository } from "../engine/writing-resource/repository.js";

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
 * 读取指定章节文件内容。
 * 按 `{chapterNumber padded to 4}.md` 模式匹配 chapters 目录下的文件。
 */
export async function handleChapterRead(input: ChapterReadInput, booksDir: string): Promise<ChapterReadResult> {
  const { bookId, chapterNumber } = input;
  try {
    const repository = createWritingResourceRepository(getStorageDatabase());
    const resource = repository.findAcceptedChapter(bookId, chapterNumber);
    if (resource) {
      return {
        ok: true,
        summary: `已读取第 ${chapterNumber} 章（${resource.wordCount} 字）。`,
        data: { bookId, chapterNumber, fileName: `${resource.id}.md`, content: resource.content, wordCount: resource.wordCount },
      };
    }
  } catch {
    // Fall back to legacy file storage below.
  }

  const chaptersDir = join(booksDir, bookId, "chapters");

  let chapterFile: string | undefined;
  try {
    const files = readdirSync(chaptersDir);
    const padded = String(chapterNumber).padStart(4, "0");
    chapterFile = files.find(f => f.startsWith(padded) && f.endsWith(".md"));
  } catch {
    /* chapters dir may not exist */
  }

  if (!chapterFile) {
    return { ok: false, error: "chapter-not-found", summary: `第 ${chapterNumber} 章文件未找到。` };
  }

  try {
    const content = await readFile(join(chaptersDir, chapterFile), "utf-8");
    return {
      ok: true,
      summary: `已读取第 ${chapterNumber} 章（${content.length} 字）。`,
      data: { bookId, chapterNumber, fileName: chapterFile, content, wordCount: content.length },
    };
  } catch (error) {
    return { ok: false, error: "read-failed", summary: `读取章节失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
