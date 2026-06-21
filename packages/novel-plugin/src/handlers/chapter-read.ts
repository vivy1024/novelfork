import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { resolveBookStorageDir } from "@vivy1024/novelfork-core";
import { createWritingResourceFileStore } from "../engine/writing-resource/file-store.js";

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
 * 优先从文件存储层（绑定目录/默认 books 目录）读，回退到传入 booksDir 下的旧路径。
 */
export async function handleChapterRead(input: ChapterReadInput, booksDir: string): Promise<ChapterReadResult> {
  const { bookId, chapterNumber } = input;

  // projectRoot = booksDir 的父目录（booksDir = {projectRoot}/books）
  const projectRoot = dirname(booksDir);

  try {
    const fileStore = createWritingResourceFileStore((bid) => resolveBookStorageDir(projectRoot, bid));
    const resource = await fileStore.findAcceptedChapter(bookId, chapterNumber);
    if (resource) {
      return {
        ok: true,
        summary: `已读取第 ${chapterNumber} 章（${resource.wordCount} 字）。`,
        data: { bookId, chapterNumber, fileName: `${resource.id}.md`, content: resource.content, wordCount: resource.wordCount },
      };
    }
  } catch {
    // Fall back to legacy file path below.
  }

  // 回退：传入 booksDir 下的旧路径
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
