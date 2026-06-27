/**
 * 文件系统正式章节存储层。
 *
 * 写作结果只落到 {bookDir}/chapters/*.md 和 chapters/index.json。
 * candidate/draft 文件目录不再作为运行时资源模型读取或写入。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
} from "./types.js";

interface ChapterIndexEntry {
  number: number;
  title: string;
  fileName: string;
  wordCount: number;
  updatedAt: string;
}

function padNumber(n: number, len = 4): string {
  return String(n).padStart(len, "0");
}

function sanitizeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 50) || "未命名";
}

function countWords(content: string): number {
  return content.replace(/\s+/g, "").trim().length;
}

function chapterId(number: number): string {
  return `chapter:${number}`;
}

function parseChapterId(id: string): number | null {
  if (!id.startsWith("chapter:")) return null;
  const value = Number.parseInt(id.slice("chapter:".length), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface WritingResourceFileStore {
  readonly list: (bookId: string, filter?: ListWritingResourcesFilter) => Promise<WritingResource[]>;
  readonly getById: (bookId: string, id: string) => Promise<WritingResource | null>;
  readonly create: (bookId: string, input: Omit<CreateWritingResourceInput, "id" | "bookId"> & { readonly id?: string }) => Promise<WritingResource>;
  readonly update: (bookId: string, id: string, input: UpdateWritingResourceInput) => Promise<WritingResource | null>;
  readonly softDelete: (bookId: string, id: string) => Promise<WritingResource | null>;
  readonly findAcceptedChapter: (bookId: string, chapterNumber: number) => Promise<WritingResource | null>;
  readonly getHistory: (bookId: string, id: string) => Promise<WritingResource[]>;
}

export function createWritingResourceFileStore(resolveBookDir: (bookId: string) => string): WritingResourceFileStore {
  function chaptersDir(bookId: string) { return join(resolveBookDir(bookId), "chapters"); }
  function chaptersIndexPath(bookId: string) { return join(chaptersDir(bookId), "index.json"); }

  async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async function readChapterIndex(bookId: string): Promise<ChapterIndexEntry[]> {
    try {
      const raw = await readFile(chaptersIndexPath(bookId), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isChapterIndexEntry) : [];
    } catch {
      return [];
    }
  }

  async function writeChapterIndex(bookId: string, entries: ChapterIndexEntry[]): Promise<void> {
    await ensureDir(chaptersDir(bookId));
    await writeFile(chaptersIndexPath(bookId), JSON.stringify(entries, null, 2), "utf-8");
  }

  function chapterToResource(bookId: string, entry: ChapterIndexEntry, content: string): WritingResource {
    const updatedAt = new Date(entry.updatedAt).getTime();
    return {
      id: chapterId(entry.number),
      bookId,
      type: "chapter",
      status: "accepted",
      title: entry.title,
      content,
      chapterNumber: entry.number,
      wordCount: entry.wordCount,
      parentId: null,
      version: 1,
      source: null,
      metadata: {},
      createdAt: updatedAt,
      updatedAt,
      acceptedAt: updatedAt,
      deletedAt: null,
    };
  }

  async function listChapters(bookId: string): Promise<WritingResource[]> {
    const entries = await readChapterIndex(bookId);
    const results: WritingResource[] = [];
    for (const entry of entries) {
      try {
        const content = await readFile(join(chaptersDir(bookId), entry.fileName), "utf-8");
        results.push(chapterToResource(bookId, entry, content));
      } catch {
        // 文件缺失时跳过，保留真实可读章节。
      }
    }
    return results;
  }

  return {
    async list(bookId, filter = {}) {
      let all = await listChapters(bookId);
      if (filter.type) all = all.filter((resource) => resource.type === filter.type);
      if (filter.status) all = all.filter((resource) => resource.status === filter.status);
      if (typeof filter.chapterNumber === "number") all = all.filter((resource) => resource.chapterNumber === filter.chapterNumber);
      return all.sort((left, right) => (left.chapterNumber ?? 999999) - (right.chapterNumber ?? 999999) || right.updatedAt - left.updatedAt);
    },

    async getById(bookId, id) {
      const chapterNumber = parseChapterId(id);
      return chapterNumber ? this.findAcceptedChapter(bookId, chapterNumber) : null;
    },

    async create(bookId, input) {
      const now = new Date(input.updatedAt ?? Date.now()).toISOString();
      const content = input.content;
      const wordCount = countWords(content);
      const chapterNumber = input.chapterNumber ?? ((await readChapterIndex(bookId)).reduce((max, entry) => Math.max(max, entry.number), 0) + 1);
      const fileName = `${padNumber(chapterNumber)}_${sanitizeTitle(input.title)}.md`;
      const index = (await readChapterIndex(bookId)).filter((entry) => entry.number !== chapterNumber);
      await ensureDir(chaptersDir(bookId));
      await writeFile(join(chaptersDir(bookId), fileName), content, "utf-8");
      index.push({ number: chapterNumber, title: input.title, fileName, wordCount, updatedAt: now });
      index.sort((a, b) => a.number - b.number);
      await writeChapterIndex(bookId, index);
      return chapterToResource(bookId, { number: chapterNumber, title: input.title, fileName, wordCount, updatedAt: now }, content);
    },

    async update(bookId, id, input) {
      const chapterNumber = parseChapterId(id);
      if (!chapterNumber) return null;
      const index = await readChapterIndex(bookId);
      const idx = index.findIndex((entry) => entry.number === chapterNumber);
      if (idx === -1) return null;
      const entry = { ...index[idx]! };
      const now = new Date(input.updatedAt ?? Date.now()).toISOString();
      if (input.content !== undefined) {
        await writeFile(join(chaptersDir(bookId), entry.fileName), input.content, "utf-8");
      }
      if (input.title !== undefined) {
        const oldPath = join(chaptersDir(bookId), entry.fileName);
        entry.fileName = `${padNumber(chapterNumber)}_${sanitizeTitle(input.title)}.md`;
        entry.title = input.title;
        if (existsSync(oldPath)) await rename(oldPath, join(chaptersDir(bookId), entry.fileName));
      }
      const content = input.content ?? await readFile(join(chaptersDir(bookId), entry.fileName), "utf-8").catch(() => "");
      entry.wordCount = input.wordCount ?? countWords(content);
      entry.updatedAt = now;
      index[idx] = entry;
      await writeChapterIndex(bookId, index);
      return chapterToResource(bookId, entry, content);
    },

    async softDelete(bookId, id) {
      const chapterNumber = parseChapterId(id);
      if (!chapterNumber) return null;
      const index = await readChapterIndex(bookId);
      const entry = index.find((item) => item.number === chapterNumber);
      if (!entry) return null;
      await writeChapterIndex(bookId, index.filter((item) => item.number !== chapterNumber));
      try { await unlink(join(chaptersDir(bookId), entry.fileName)); } catch { /* ignore */ }
      return { ...chapterToResource(bookId, entry, ""), status: "archived" };
    },

    async findAcceptedChapter(bookId, chapterNumber) {
      const index = await readChapterIndex(bookId);
      const entry = index.find((item) => item.number === chapterNumber);
      if (!entry) return null;
      try {
        const content = await readFile(join(chaptersDir(bookId), entry.fileName), "utf-8");
        return chapterToResource(bookId, entry, content);
      } catch {
        return null;
      }
    },

    async getHistory(bookId, id) {
      const resource = await this.getById(bookId, id);
      return resource ? [resource] : [];
    },
  };
}

function isChapterIndexEntry(value: unknown): value is ChapterIndexEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.number === "number"
    && typeof record.title === "string"
    && typeof record.fileName === "string"
    && typeof record.wordCount === "number"
    && typeof record.updatedAt === "string";
}
