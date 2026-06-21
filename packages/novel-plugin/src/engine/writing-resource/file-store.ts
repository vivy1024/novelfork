/**
 * 文件系统存储层 — 替代 SQLite writing_resource 表
 *
 * 章节和草稿都存储为 markdown 文件：
 *   {bookDir}/chapters/0001_标题.md  (accepted 章节)
 *   {bookDir}/drafts/{uuid}.md       (草稿 = 候选稿 + 草稿统一)
 *
 * 每个目录有 index.json 作为元数据索引。
 */
import { readFile, writeFile, mkdir, readdir, unlink, rename } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  WritingResource,
  WritingResourceStatus,
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
} from "./types.js";
import { countChineseWords } from "./types.js";

// ── Types ──

interface ChapterIndexEntry {
  number: number;
  title: string;
  fileName: string;
  wordCount: number;
  updatedAt: string;
}

interface DraftIndexEntry {
  id: string;
  title: string;
  fileName: string;
  chapterNumber: number | null;
  wordCount: number;
  status: WritingResourceStatus;
  source: string | null;
  parentId: string | null;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
}

// ── Helpers ──

function padNumber(n: number, len = 4): string {
  return String(n).padStart(len, "0");
}

function sanitizeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 50) || "未命名";
}

function countWords(content: string): number {
  return content.replace(/\s+/g, "").trim().length;
}

// ── File Store ──

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
  function draftsDir(bookId: string) { return join(resolveBookDir(bookId), "drafts"); }
  function chaptersIndexPath(bookId: string) { return join(chaptersDir(bookId), "index.json"); }
  function draftsIndexPath(bookId: string) { return join(draftsDir(bookId), "index.json"); }

  async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async function readChapterIndex(bookId: string): Promise<ChapterIndexEntry[]> {
    try {
      const raw = await readFile(chaptersIndexPath(bookId), "utf-8");
      return JSON.parse(raw) as ChapterIndexEntry[];
    } catch { return []; }
  }

  async function writeChapterIndex(bookId: string, entries: ChapterIndexEntry[]): Promise<void> {
    await ensureDir(chaptersDir(bookId));
    await writeFile(chaptersIndexPath(bookId), JSON.stringify(entries, null, 2), "utf-8");
  }

  async function readDraftIndex(bookId: string): Promise<DraftIndexEntry[]> {
    try {
      const raw = await readFile(draftsIndexPath(bookId), "utf-8");
      return JSON.parse(raw) as DraftIndexEntry[];
    } catch { return []; }
  }

  async function writeDraftIndex(bookId: string, entries: DraftIndexEntry[]): Promise<void> {
    await ensureDir(draftsDir(bookId));
    await writeFile(draftsIndexPath(bookId), JSON.stringify(entries, null, 2), "utf-8");
  }

  function chapterToResource(bookId: string, entry: ChapterIndexEntry, content: string): WritingResource {
    return {
      id: `chapter:${entry.number}`,
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
      createdAt: new Date(entry.updatedAt).getTime(),
      updatedAt: new Date(entry.updatedAt).getTime(),
      acceptedAt: new Date(entry.updatedAt).getTime(),
      deletedAt: null,
    };
  }

  function draftToResource(bookId: string, entry: DraftIndexEntry, content: string): WritingResource {
    return {
      id: entry.id,
      bookId,
      type: "draft",
      status: entry.status,
      title: entry.title,
      content,
      chapterNumber: entry.chapterNumber,
      wordCount: entry.wordCount,
      parentId: entry.parentId,
      version: entry.version,
      source: entry.source,
      metadata: entry.metadata,
      createdAt: new Date(entry.createdAt).getTime(),
      updatedAt: new Date(entry.updatedAt).getTime(),
      acceptedAt: entry.acceptedAt ? new Date(entry.acceptedAt).getTime() : null,
      deletedAt: null,
    };
  }

  async function listChapters(bookId: string): Promise<WritingResource[]> {
    const entries = await readChapterIndex(bookId);
    const results: WritingResource[] = [];
    for (const entry of entries) {
      try {
        const filePath = join(chaptersDir(bookId), entry.fileName);
        const content = await readFile(filePath, "utf-8");
        results.push(chapterToResource(bookId, entry, content));
      } catch { /* file missing, skip */ }
    }
    return results;
  }

  async function listDrafts(bookId: string): Promise<WritingResource[]> {
    const entries = await readDraftIndex(bookId);
    const results: WritingResource[] = [];
    for (const entry of entries) {
      try {
        const filePath = join(draftsDir(bookId), entry.fileName);
        const content = await readFile(filePath, "utf-8");
        results.push(draftToResource(bookId, entry, content));
      } catch { /* file missing, skip */ }
    }
    return results;
  }

  return {
    async list(bookId, filter = {}) {
      const chapters = await listChapters(bookId);
      const drafts = await listDrafts(bookId);
      let all = [...chapters, ...drafts];

      if (filter.type === "chapter") all = all.filter(r => r.status === "accepted");
      if (filter.status) all = all.filter(r => r.status === filter.status);
      if (typeof filter.chapterNumber === "number") all = all.filter(r => r.chapterNumber === filter.chapterNumber);
      // 排序：按 chapterNumber，然后 updatedAt DESC
      all.sort((a, b) => {
        const an = a.chapterNumber ?? 999999;
        const bn = b.chapterNumber ?? 999999;
        return an !== bn ? an - bn : b.updatedAt - a.updatedAt;
      });
      return all;
    },

    async getById(bookId, id) {
      // 章节 id 格式: chapter:{number}
      if (id.startsWith("chapter:")) {
        const num = parseInt(id.replace("chapter:", ""), 10);
        return this.findAcceptedChapter(bookId, num);
      }
      // 草稿：在 drafts index 里找
      const drafts = await readDraftIndex(bookId);
      const entry = drafts.find(d => d.id === id);
      if (!entry) return null;
      try {
        const content = await readFile(join(draftsDir(bookId), entry.fileName), "utf-8");
        return draftToResource(bookId, entry, content);
      } catch { return null; }
    },

    async create(bookId, input) {
      const now = new Date().toISOString();
      const wordCount = countWords(input.content);
      const id = input.id ?? `draft-${randomUUID()}`;

      if (input.status === "accepted" || input.type === "chapter") {
        // 直接创建正式章节
        const num = input.chapterNumber ?? ((await readChapterIndex(bookId)).reduce((max, e) => Math.max(max, e.number), 0) + 1);
        const fileName = `${padNumber(num)}_${sanitizeTitle(input.title)}.md`;
        await ensureDir(chaptersDir(bookId));
        await writeFile(join(chaptersDir(bookId), fileName), input.content, "utf-8");
        const index = await readChapterIndex(bookId);
        index.push({ number: num, title: input.title, fileName, wordCount, updatedAt: now });
        index.sort((a, b) => a.number - b.number);
        await writeChapterIndex(bookId, index);
        return chapterToResource(bookId, { number: num, title: input.title, fileName, wordCount, updatedAt: now }, input.content);
      }

      // 创建草稿
      const fileName = `${id}.md`;
      await ensureDir(draftsDir(bookId));
      await writeFile(join(draftsDir(bookId), fileName), input.content, "utf-8");
      const entry: DraftIndexEntry = {
        id, title: input.title, fileName,
        chapterNumber: input.chapterNumber ?? null,
        wordCount, status: input.status,
        source: input.source ?? null,
        parentId: input.parentId ?? null,
        version: input.version ?? 1,
        metadata: input.metadata ?? {},
        createdAt: now, updatedAt: now,
        acceptedAt: input.acceptedAt ? new Date(input.acceptedAt).toISOString() : null,
      };
      const index = await readDraftIndex(bookId);
      index.push(entry);
      await writeDraftIndex(bookId, index);
      return draftToResource(bookId, entry, input.content);
    },

    async update(bookId, id, input) {
      const now = new Date(input.updatedAt ?? Date.now()).toISOString();

      // 更新章节
      if (id.startsWith("chapter:")) {
        const num = parseInt(id.replace("chapter:", ""), 10);
        const index = await readChapterIndex(bookId);
        const idx = index.findIndex(e => e.number === num);
        if (idx === -1) return null;
        const entry = index[idx]!;
        if (input.content !== undefined) {
          await writeFile(join(chaptersDir(bookId), entry.fileName), input.content, "utf-8");
        }
        if (input.title !== undefined) {
          const oldPath = join(chaptersDir(bookId), entry.fileName);
          entry.fileName = `${padNumber(num)}_${sanitizeTitle(input.title)}.md`;
          entry.title = input.title;
          if (existsSync(oldPath)) {
            await rename(oldPath, join(chaptersDir(bookId), entry.fileName));
          }
        }
        entry.wordCount = input.wordCount ?? (input.content !== undefined ? countWords(input.content!) : entry.wordCount);
        entry.updatedAt = now;
        index[idx] = entry;
        await writeChapterIndex(bookId, index);
        const content = input.content ?? await readFile(join(chaptersDir(bookId), entry.fileName), "utf-8").catch(() => "");
        return chapterToResource(bookId, entry, content);
      }

      // 更新草稿
      const drafts = await readDraftIndex(bookId);
      const idx = drafts.findIndex(d => d.id === id);
      if (idx === -1) return null;
      const entry = drafts[idx]!;
      if (input.content !== undefined) {
        await writeFile(join(draftsDir(bookId), entry.fileName), input.content, "utf-8");
        entry.wordCount = input.wordCount ?? countWords(input.content!);
      }
      if (input.title !== undefined) entry.title = input.title;
      if (input.status !== undefined) entry.status = input.status;
      if (input.chapterNumber !== undefined) entry.chapterNumber = input.chapterNumber;
      if (input.source !== undefined) entry.source = input.source;
      if (input.parentId !== undefined) entry.parentId = input.parentId;
      if (input.version !== undefined) entry.version = input.version;
      if (input.metadata !== undefined) entry.metadata = input.metadata;
      if (input.acceptedAt !== undefined) entry.acceptedAt = input.acceptedAt ? new Date(input.acceptedAt).toISOString() : null;
      entry.updatedAt = now;
      drafts[idx] = entry;
      await writeDraftIndex(bookId, drafts);
      const content = input.content ?? await readFile(join(draftsDir(bookId), entry.fileName), "utf-8").catch(() => "");
      return draftToResource(bookId, entry, content);
    },

    async softDelete(bookId, id) {
      const now = new Date().toISOString();
      if (id.startsWith("chapter:")) {
        // 章节软删除：从 index 移除，但不删文件（留备份）
        const num = parseInt(id.replace("chapter:", ""), 10);
        const index = await readChapterIndex(bookId);
        const filtered = index.filter(e => e.number !== num);
        if (filtered.length === index.length) return null;
        await writeChapterIndex(bookId, filtered);
        return chapterToResource(bookId, index.find(e => e.number === num)!, "");
      }
      // 草稿软删除：从 index 移除 + 删文件
      const drafts = await readDraftIndex(bookId);
      const entry = drafts.find(d => d.id === id);
      if (!entry) return null;
      const filtered = drafts.filter(d => d.id !== id);
      await writeDraftIndex(bookId, filtered);
      try { await unlink(join(draftsDir(bookId), entry.fileName)); } catch { /* ignore */ }
      return draftToResource(bookId, { ...entry }, "");
    },

    async findAcceptedChapter(bookId, chapterNumber) {
      const index = await readChapterIndex(bookId);
      const entry = index.find(e => e.number === chapterNumber);
      if (!entry) return null;
      try {
        const content = await readFile(join(chaptersDir(bookId), entry.fileName), "utf-8");
        return chapterToResource(bookId, entry, content);
      } catch { return null; }
    },

    async getHistory(bookId, id) {
      // 简化版：只返回当前资源（文件系统没有 SQLite 的 parent_id 链）
      const resource = await this.getById(bookId, id);
      return resource ? [resource] : [];
    },
  };
}
