/**
 * 文件系统正式章节存储层。
 *
 * 正式章节文件落在 {bookDir}/chapters/卷NN/*.md；chapters/index.json
 * 保存相对于 chapters/ 的 fileName，candidate/draft 不进入文件存储。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
} from "./types.js";
import {
  CHAPTERS_DIRECTORY,
  DEFAULT_VOLUME_DIRECTORY,
  type ChapterIndexRecord,
  type ChapterVolumeDirectoryResolver,
  chapterRelativePath,
  chapterWordCount,
  normalizeChapterRelativePath,
  readChapterIndex,
  synchronizeChapterLayout,
  volumeDirectoryName,
  writeChapterIndex,
} from "./chapter-layout.js";

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

export function createWritingResourceFileStore(
  resolveBookDir: (bookId: string) => string,
  options?: { readonly resolveChapterVolumeDirectory?: ChapterVolumeDirectoryResolver },
): WritingResourceFileStore {
  const resolveVolumeDirectory = options?.resolveChapterVolumeDirectory
    ?? (() => volumeDirectoryName(1));

  function chaptersDir(bookId: string) {
    return join(resolveBookDir(bookId), CHAPTERS_DIRECTORY);
  }

  function chapterPath(bookId: string, fileName: string) {
    return join(chaptersDir(bookId), fileName);
  }

  async function ensureLayout(bookId: string): Promise<void> {
    await synchronizeChapterLayout(bookId, resolveBookDir(bookId), resolveVolumeDirectory);
  }

  async function chapterToResource(bookId: string, entry: ChapterIndexRecord, content: string): Promise<WritingResource> {
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
      metadata: {
        fileName: normalizeChapterRelativePath(entry.fileName),
        chapterPath: normalizeChapterRelativePath(join(CHAPTERS_DIRECTORY, entry.fileName)),
      },
      createdAt: updatedAt,
      updatedAt,
      acceptedAt: updatedAt,
      deletedAt: null,
    };
  }

  async function listChapters(bookId: string): Promise<WritingResource[]> {
    await ensureLayout(bookId);
    const entries = await readChapterIndex(resolveBookDir(bookId));
    const results: WritingResource[] = [];
    for (const entry of entries) {
      try {
        const content = await readFile(chapterPath(bookId, entry.fileName), "utf-8");
        results.push(await chapterToResource(bookId, entry, content));
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
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const now = new Date(input.updatedAt ?? Date.now()).toISOString();
      const content = input.content;
      const wordCount = chapterWordCount(content);
      const index = await readChapterIndex(bookRoot);
      const chapterNumber = input.chapterNumber ?? (index.reduce((max, entry) => Math.max(max, entry.number), 0) + 1);
      const volumeDirectory = normalizeChapterRelativePath(await resolveVolumeDirectory(bookId, chapterNumber)) || DEFAULT_VOLUME_DIRECTORY;
      const fileName = chapterRelativePath(volumeDirectory, chapterNumber, input.title);
      const previous = index.find((entry) => entry.number === chapterNumber);
      if (previous && normalizeChapterRelativePath(previous.fileName) !== fileName) {
        await unlink(chapterPath(bookId, previous.fileName)).catch(() => undefined);
      }
      await mkdir(dirname(chapterPath(bookId, fileName)), { recursive: true });
      await writeFile(chapterPath(bookId, fileName), content, "utf-8");
      const nextIndex = index.filter((entry) => entry.number !== chapterNumber);
      nextIndex.push({ number: chapterNumber, title: input.title, fileName, wordCount, updatedAt: now });
      nextIndex.sort((a, b) => a.number - b.number);
      await writeChapterIndex(bookRoot, nextIndex);
      return chapterToResource(bookId, { number: chapterNumber, title: input.title, fileName, wordCount, updatedAt: now }, content);
    },

    async update(bookId, id, input) {
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const chapterNumber = parseChapterId(id);
      if (!chapterNumber) return null;
      const index = await readChapterIndex(bookRoot);
      const idx = index.findIndex((entry) => entry.number === chapterNumber);
      if (idx === -1) return null;
      const entry = { ...index[idx]! };
      const now = new Date(input.updatedAt ?? Date.now()).toISOString();
      const oldPath = chapterPath(bookId, entry.fileName);
      let content = input.content;
      if (content !== undefined) {
        await mkdir(dirname(oldPath), { recursive: true });
        await writeFile(oldPath, content, "utf-8");
      }
      if (input.title !== undefined) {
        const oldVolume = normalizeChapterRelativePath(dirname(entry.fileName));
        const volumeDirectory = oldVolume && oldVolume !== "." ? oldVolume : normalizeChapterRelativePath(await resolveVolumeDirectory(bookId, chapterNumber)) || DEFAULT_VOLUME_DIRECTORY;
        const nextFileName = chapterRelativePath(volumeDirectory, chapterNumber, input.title);
        const nextPath = chapterPath(bookId, nextFileName);
        entry.fileName = nextFileName;
        entry.title = input.title;
        if (oldPath !== nextPath && existsSync(oldPath)) {
          await mkdir(dirname(nextPath), { recursive: true });
          await rename(oldPath, nextPath);
        }
      }
      content = content ?? await readFile(chapterPath(bookId, entry.fileName), "utf-8").catch(() => "");
      entry.wordCount = input.wordCount ?? chapterWordCount(content);
      entry.updatedAt = now;
      index[idx] = entry;
      await writeChapterIndex(bookRoot, index);
      return chapterToResource(bookId, entry, content);
    },

    async softDelete(bookId, id) {
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const chapterNumber = parseChapterId(id);
      if (!chapterNumber) return null;
      const index = await readChapterIndex(bookRoot);
      const entry = index.find((item) => item.number === chapterNumber);
      if (!entry) return null;
      await writeChapterIndex(bookRoot, index.filter((item) => item.number !== chapterNumber));
      try { await unlink(chapterPath(bookId, entry.fileName)); } catch { /* ignore */ }
      return { ...(await chapterToResource(bookId, entry, "")), status: "archived" };
    },

    async findAcceptedChapter(bookId, chapterNumber) {
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const index = await readChapterIndex(bookRoot);
      const entry = index.find((item) => item.number === chapterNumber);
      if (!entry) return null;
      try {
        const content = await readFile(chapterPath(bookId, entry.fileName), "utf-8");
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
