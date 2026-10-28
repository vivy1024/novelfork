/**
 * 文件系统正式章节存储层。
 *
 * 正式章节文件落在 {bookDir}/chapters/卷NN/*.md；chapters/index.json
 * 保存相对于 chapters/ 的 fileName，candidate/draft 不进入文件存储。
 */
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { LengthCountingMode } from "@vivy1024/novelfork-core";

import { chapterContentFingerprint } from "../narrative-memory/settlement-idempotency.js";
import { writeFileAtomic } from "./atomic-write.js";
import { withChapterIndexLock } from "./chapter-index-lock.js";
import { requireChapterFile } from "./chapter-path-guard.js";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
} from "./types.js";
import {
  CHAPTERS_DIRECTORY,
  ChapterStoreError,
  DEFAULT_VOLUME_DIRECTORY,
  describeFsError as describeError,
  errnoCode,
  type ChapterIndexRecord,
  type ChapterStoreExplanation,
  type ChapterVolumeDirectoryResolver,
  chapterRelativePath,
  chapterWordCount,
  normalizeChapterRelativePath,
  readChapterIndex,
  synchronizeChapterLayout,
  volumeDirectoryName,
  writeChapterIndex,
} from "./chapter-layout.js";

export interface ChapterStoreWarning {
  readonly code: "CHAPTER_OLD_FILE_NOT_REMOVED";
  readonly explanation: ChapterStoreExplanation;
}

/** 写入已成功但有收尾告警时挂在 metadata.warnings 上，调用方原样转给作者。 */
function withWarnings(resource: WritingResource, warnings: readonly ChapterStoreWarning[]): WritingResource {
  return warnings.length ? { ...resource, metadata: { ...resource.metadata, warnings } } : resource;
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

export function createWritingResourceFileStore(
  resolveBookDir: (bookId: string) => string,
  options?: {
    readonly resolveChapterVolumeDirectory?: ChapterVolumeDirectoryResolver;
    /** 书籍计数方式；缺省按中文字符计。 */
    readonly countingMode?: LengthCountingMode;
  },
): WritingResourceFileStore {
  const resolveVolumeDirectory = options?.resolveChapterVolumeDirectory
    ?? (() => volumeDirectoryName(1));
  const countingMode = options?.countingMode;

  /** 写完后记下文件修改时间，对账据此判断之后有没有别人动过这个文件。 */
  async function observedModifiedAt(path: string): Promise<number | undefined> {
    const info = await stat(path).catch(() => null);
    return info ? Math.floor(info.mtimeMs) : undefined;
  }

  /** 读正文：不存在返回 undefined；其他读错误（EBUSY/EPERM）抛出，不当成空正文写回。 */
  async function readChapterBody(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  /** 新正文与索引都落盘后删旧文件名的正文；失败只告警不回滚，返回带 explanation 的告警交给调用方。 */
  async function removeSupersededFile(bookId: string, oldFileName: string, nextFileName: string): Promise<ChapterStoreWarning[]> {
    try {
      await unlink(chapterPath(bookId, oldFileName));
      return [];
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return [];
      const warning: ChapterStoreWarning = {
        code: "CHAPTER_OLD_FILE_NOT_REMOVED",
        explanation: {
          whatHappened: `章节已改存为 chapters/${normalizeChapterRelativePath(nextFileName)}，但旧文件 chapters/${normalizeChapterRelativePath(oldFileName)} 没能删除（${describeError(error)}）。`,
          whyItMatters: "新正文和索引都已保存，内容不会丢；旧文件留在磁盘上，同一章在文件夹里会看到两个文件。",
          suggestedAction: "关闭占用旧文件的编辑器或同步盘后，手动删除这个旧文件即可。",
        },
      };
      console.warn(`[chapter-store] ${warning.explanation.whatHappened}`);
      return [warning];
    }
  }

  function chaptersDir(bookId: string) {
    return join(resolveBookDir(bookId), CHAPTERS_DIRECTORY);
  }

  function chapterPath(bookId: string, fileName: string) {
    // S1.1：索引里的 fileName 不可信，越出章节目录的一律拒绝（抛错，不静默读写别处）。
    return requireChapterFile(chaptersDir(bookId), fileName);
  }

  async function ensureLayout(bookId: string): Promise<void> {
    const bookRoot = resolveBookDir(bookId);
    await withChapterIndexLock(bookRoot, () => synchronizeChapterLayout(bookId, bookRoot, resolveVolumeDirectory, { countingMode }));
  }

  /** index.json 的读改写全程持锁，防并发写入方互相覆盖（见 chapter-index-lock.ts）；锁可重入。 */
  function locked<T>(bookId: string, task: () => Promise<T>): Promise<T> {
    return withChapterIndexLock(resolveBookDir(bookId), task);
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
      return locked(bookId, async () => {
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const content = input.content;
      const wordCount = chapterWordCount(content, countingMode);
      const contentHash = chapterContentFingerprint(content);
      const index = await readChapterIndex(bookRoot);
      const chapterNumber = input.chapterNumber ?? (index.reduce((max, entry) => Math.max(max, entry.number), 0) + 1);
      const volumeDirectory = normalizeChapterRelativePath(await resolveVolumeDirectory(bookId, chapterNumber)) || DEFAULT_VOLUME_DIRECTORY;
      const fileName = chapterRelativePath(volumeDirectory, chapterNumber, input.title);
      const previous = index.find((entry) => entry.number === chapterNumber);
      const supersededFileName = previous && normalizeChapterRelativePath(previous.fileName) !== fileName
        ? previous.fileName
        : null;
      await mkdir(dirname(chapterPath(bookId, fileName)), { recursive: true });
      // 顺序：新正文原子写 → 索引原子写 → 两步都成功才删旧文件名的正文。
      // 任何一步失败都还留着旧正文；删旧文件失败只告警不回滚（对账会把残留文件按章号合并，不会丢正文）。
      await writeFileAtomic(chapterPath(bookId, fileName), content);
      const now = new Date(input.updatedAt ?? Date.now()).toISOString();
      const fileModifiedAt = await observedModifiedAt(chapterPath(bookId, fileName));
      const record: ChapterIndexRecord = {
        number: chapterNumber,
        title: input.title,
        fileName,
        wordCount,
        updatedAt: now,
        contentHash,
        ...(fileModifiedAt === undefined ? {} : { fileModifiedAt }),
      };
      const nextIndex = index.filter((entry) => entry.number !== chapterNumber);
      nextIndex.push(record);
      nextIndex.sort((a, b) => a.number - b.number);
      await writeChapterIndex(bookRoot, nextIndex);
      const warnings = supersededFileName ? await removeSupersededFile(bookId, supersededFileName, fileName) : [];
      return withWarnings(await chapterToResource(bookId, record, content), warnings);
      });
    },

    async update(bookId, id, input) {
      return locked(bookId, async () => {
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const chapterNumber = parseChapterId(id);
      if (!chapterNumber) return null;
      const index = await readChapterIndex(bookRoot);
      const idx = index.findIndex((entry) => entry.number === chapterNumber);
      if (idx === -1) return null;
      const entry = { ...index[idx]! };
      const oldFileName = entry.fileName;
      const oldPath = chapterPath(bookId, oldFileName);
      let nextFileName = oldFileName;
      if (input.title !== undefined) {
        const oldVolume = normalizeChapterRelativePath(dirname(entry.fileName));
        const volumeDirectory = oldVolume && oldVolume !== "." ? oldVolume : normalizeChapterRelativePath(await resolveVolumeDirectory(bookId, chapterNumber)) || DEFAULT_VOLUME_DIRECTORY;
        nextFileName = chapterRelativePath(volumeDirectory, chapterNumber, input.title);
      }
      const nextPath = chapterPath(bookId, nextFileName);
      const moving = nextPath !== oldPath;
      // 改标题换文件名不再用 rename 搬旧文件：先把正文原子写进新文件名，再写索引，最后删旧文件。
      // 只改标题时正文取自旧文件；旧文件不存在就只改索引（与此前行为一致），读不到（EBUSY 等）直接抛出。
      let content = input.content;
      if (content === undefined && moving) content = await readChapterBody(oldPath);
      if (content !== undefined) {
        await mkdir(dirname(nextPath), { recursive: true });
        await writeFileAtomic(nextPath, content);
      }
      entry.fileName = nextFileName;
      if (input.title !== undefined) entry.title = input.title;
      content = content ?? await readChapterBody(nextPath) ?? "";
      entry.wordCount = input.wordCount ?? chapterWordCount(content, countingMode);
      entry.contentHash = chapterContentFingerprint(content);
      entry.updatedAt = new Date(input.updatedAt ?? Date.now()).toISOString();
      const fileModifiedAt = await observedModifiedAt(nextPath);
      if (fileModifiedAt !== undefined) entry.fileModifiedAt = fileModifiedAt;
      index[idx] = entry;
      await writeChapterIndex(bookRoot, index);
      const warnings = moving ? await removeSupersededFile(bookId, oldFileName, nextFileName) : [];
      return withWarnings(await chapterToResource(bookId, entry, content), warnings);
      });
    },

    async softDelete(bookId, id) {
      return locked(bookId, async () => {
      await ensureLayout(bookId);
      const bookRoot = resolveBookDir(bookId);
      const chapterNumber = parseChapterId(id);
      if (!chapterNumber) return null;
      const index = await readChapterIndex(bookRoot);
      const entry = index.find((item) => item.number === chapterNumber);
      if (!entry) return null;
      // 先删正文再改索引：正文删不掉时索引保持原样并抛错，避免「索引里没了、文件还在，下次对账又被收录回来」。
      // 留底由调用方负责（chapter-discard-range.ts 在调用前已把正文复制进 chapters/_discarded）。
      try {
        await unlink(chapterPath(bookId, entry.fileName));
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") {
          throw new ChapterStoreError("CHAPTER_FILE_DELETE_FAILED", 409, {
            whatHappened: `删除第 ${chapterNumber} 章正文 chapters/${normalizeChapterRelativePath(entry.fileName)} 失败（${describeError(error)}），章节索引没有改动，这一章仍然保留。`,
            whyItMatters: "如果只从索引里去掉而文件还在，下次打开章节列表时这一章会被重新收录，看起来像删了又回来。",
            suggestedAction: "关闭正在打开该文件的编辑器、同步盘或杀毒软件后重试删除；仍失败时检查文件权限。",
          }, { cause: error });
        }
      }
      await writeChapterIndex(bookRoot, index.filter((item) => item.number !== chapterNumber));
      return { ...(await chapterToResource(bookId, entry, "")), status: "archived" };
      });
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
