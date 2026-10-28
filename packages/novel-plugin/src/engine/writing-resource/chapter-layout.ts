import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { countChapterLength, type LengthCountingMode } from "@vivy1024/novelfork-core";

import { chapterContentFingerprint } from "../narrative-memory/settlement-idempotency.js";
import { writeFileAtomic } from "./atomic-write.js";
import { parseChapterFileName, type ParsedChapterFile } from "./chapter-file-name.js";
import { createChapterFileResolver } from "./chapter-path-guard.js";

// 文件名约定在不依赖 node:fs 的 chapter-file-name.ts，前端显示名也从那里解析。
export { CHAPTER_FILE_PATTERN, parseChapterFileName, type ParsedChapterFile } from "./chapter-file-name.js";

export const CHAPTERS_DIRECTORY = "chapters";
export const CHAPTER_INDEX_FILE = "index.json";
export const DEFAULT_VOLUME_DIRECTORY = "卷01";

export type ChapterIndexRecord = Record<string, unknown> & {
  number: number;
  title: string;
  fileName: string;
  wordCount: number;
  updatedAt: string;
  /** 正文指纹（与结算台账同一算法）；旧索引没有，对账时补上。 */
  contentHash?: string;
  /** 上次观察到的文件修改时间（毫秒，取整）。对账只拿它判断文件是否被动过，不影响 updatedAt 的含义。 */
  fileModifiedAt?: number;
};

export interface ChapterFileEntry extends ParsedChapterFile {
  /** Relative to the book root, e.g. chapters/卷01/0001_标题.md. */
  readonly relativePath: string;
  /** Relative to the chapters directory, e.g. 卷01/0001_标题.md. */
  readonly chapterRelativePath: string;
}

export interface ChapterLayoutMigrationResult {
  readonly migrated: number;
  readonly indexed: number;
  readonly conflicts: readonly string[];
}

export type ChapterVolumeDirectoryResolver = (
  bookId: string,
  chapterNumber: number,
) => string | Promise<string>;

export function padChapterNumber(number: number, length = 4): string {
  return String(number).padStart(length, "0");
}

export function sanitizeChapterTitle(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/gu, "")
    .trim()
    .slice(0, 80) || "未命名";
}

export function volumeDirectoryName(volumeNumber: number): string {
  const normalized = Number.isSafeInteger(volumeNumber) && volumeNumber > 0 ? volumeNumber : 1;
  return `卷${String(normalized).padStart(2, "0")}`;
}

export function normalizeChapterRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

export function chapterFileName(chapterNumber: number, title: string): string {
  return `${padChapterNumber(chapterNumber)}_${sanitizeChapterTitle(title)}.md`;
}

export function chapterRelativePath(volumeDirectory: string, chapterNumber: number, title: string): string {
  const normalizedVolume = normalizeChapterRelativePath(volumeDirectory) || DEFAULT_VOLUME_DIRECTORY;
  return normalizeChapterRelativePath(join(normalizedVolume, chapterFileName(chapterNumber, title)));
}

export function chapterTitleFromContent(file: ParsedChapterFile, content: string): string {
  return /^#\s+(.+)$/mu.exec(content)?.[1]?.trim() || file.title || `第 ${file.number} 章`;
}

/** 章节字数：按书籍计数方式只数正文（去掉 frontmatter、标题行、代码块），所有写入入口共用。 */
export function chapterWordCount(content: string, countingMode: LengthCountingMode = "zh_chars"): number {
  return countChapterLength(content, countingMode);
}

export async function listChapterFiles(bookRoot: string): Promise<ChapterFileEntry[]> {
  const chaptersRoot = join(bookRoot, CHAPTERS_DIRECTORY);
  const result: ChapterFileEntry[] = [];

  const walk = async (chapterRelativeDirectory: string): Promise<void> => {
    const absoluteDirectory = join(chaptersRoot, chapterRelativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === CHAPTER_INDEX_FILE || entry.name === "_discarded") continue;
      const nextRelativePath = normalizeChapterRelativePath(join(chapterRelativeDirectory, entry.name));
      if (entry.isDirectory()) {
        await walk(nextRelativePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const parsed = parseChapterFileName(entry.name);
      if (!parsed) continue;
      result.push({
        ...parsed,
        relativePath: normalizeChapterRelativePath(join(CHAPTERS_DIRECTORY, nextRelativePath)),
        chapterRelativePath: nextRelativePath,
      });
    }
  };

  await walk("");
  return result.sort((left, right) => left.number - right.number || left.chapterRelativePath.localeCompare(right.chapterRelativePath, "zh-CN"));
}

export interface ChapterStoreExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export type ChapterStoreErrorCode =
  | "CHAPTER_INDEX_UNREADABLE"
  | "CHAPTER_INDEX_CORRUPT"
  | "CHAPTER_FILE_DELETE_FAILED";

/**
 * 章节存储拒绝继续的错误：读写半途不安全时直接抛出，不按空处理、不覆写。
 * HTTP 层（routes/writing-resource.ts）按 statusCode 返回，并原样带上 explanation。
 */
export class ChapterStoreError extends Error {
  readonly code: ChapterStoreErrorCode;
  readonly statusCode: number;
  readonly explanation: ChapterStoreExplanation;

  constructor(code: ChapterStoreErrorCode, statusCode: number, explanation: ChapterStoreExplanation, options?: { cause?: unknown }) {
    super(explanation.whatHappened, options);
    this.name = "ChapterStoreError";
    this.code = code;
    this.statusCode = statusCode;
    this.explanation = explanation;
  }
}

export function errnoCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

export function describeFsError(error: unknown): string {
  const code = errnoCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return code && !message.includes(code) ? `${code}: ${message}` : message;
}

/** 坏索引改名留底：index.json → index.json.corrupt-<时间戳>，之后的对账从空索引重建也不会抹掉原文件。 */
async function quarantineCorruptIndex(indexPath: string, reason: string): Promise<never> {
  const backupName = `${CHAPTER_INDEX_FILE}.corrupt-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  const backupPath = join(dirname(indexPath), backupName);
  try {
    await rename(indexPath, backupPath);
  } catch (renameError) {
    throw new ChapterStoreError("CHAPTER_INDEX_CORRUPT", 409, {
      whatHappened: `章节索引 chapters/${CHAPTER_INDEX_FILE} 无法解析（${reason}），尝试改名留底也失败了（${describeFsError(renameError)}），文件保持原样。`,
      whyItMatters: "索引里记着每章的状态、导入来源和审计问题；在它修好之前继续读写章节，这些元数据可能被重建的空索引覆盖。",
      suggestedAction: `关闭可能占用该文件的编辑器或同步盘后重试；或手动把 chapters/${CHAPTER_INDEX_FILE} 改名备份，NovelFork 会按磁盘上的章节文件重建索引。`,
    }, { cause: renameError });
  }
  throw new ChapterStoreError("CHAPTER_INDEX_CORRUPT", 409, {
    whatHappened: `章节索引 chapters/${CHAPTER_INDEX_FILE} 无法解析（${reason}），原文件已改名留底为 chapters/${backupName}。`,
    whyItMatters: "索引里记着每章的状态、导入来源和审计问题。下次打开章节时会按磁盘上的章节正文重建索引，正文不受影响，但这些元数据只保存在留底文件里。",
    suggestedAction: `需要找回章节状态或审计记录时，打开 chapters/${backupName} 修好 JSON 后改回 ${CHAPTER_INDEX_FILE}；不需要的话直接重试，索引会自动重建。`,
  });
}

export async function readChapterIndex(bookRoot: string): Promise<ChapterIndexRecord[]> {
  const indexPath = join(bookRoot, CHAPTERS_DIRECTORY, CHAPTER_INDEX_FILE);
  let raw: string;
  try {
    raw = await readFile(indexPath, "utf8");
  } catch (error) {
    // 只有「文件确实不存在」才等于空索引；EBUSY/EPERM 等读不到的情况必须抛出，否则对账会把空索引写回去。
    if (errnoCode(error) === "ENOENT") return [];
    throw new ChapterStoreError("CHAPTER_INDEX_UNREADABLE", 503, {
      whatHappened: `读取章节索引 chapters/${CHAPTER_INDEX_FILE} 失败（${describeFsError(error)}），本次操作已中止，索引没有被改动。`,
      whyItMatters: "读不到索引时如果当成空继续，章节状态、导入来源和审计问题等元数据会被覆盖丢失。",
      suggestedAction: "多半是文件被同步盘、杀毒软件或其他编辑器临时占用；稍后重试即可。反复出现时检查该文件的权限与占用进程。",
    }, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return quarantineCorruptIndex(indexPath, `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) return quarantineCorruptIndex(indexPath, "顶层不是数组");
  // S1.1：fileName 越出章节目录的条目视为无效，既不读也不写回（见 chapter-path-guard.ts）。
  // 整份索引共用一个解析器：章节目录的 realpath 只算一次，不随条目数重复同步 IO（T-01）。
  const resolveChapterFile = createChapterFileResolver(join(bookRoot, CHAPTERS_DIRECTORY));
  return parsed.filter(isChapterIndexRecord).filter((record) => resolveChapterFile(record.fileName) !== null);
}

export async function writeChapterIndex(bookRoot: string, entries: readonly ChapterIndexRecord[]): Promise<void> {
  // 索引原子替换：中途失败时保留上一版完整 index.json，不留半截文件。
  const chaptersRoot = join(bookRoot, CHAPTERS_DIRECTORY);
  await mkdir(chaptersRoot, { recursive: true });
  await writeFileAtomic(join(chaptersRoot, CHAPTER_INDEX_FILE), `${JSON.stringify(entries, null, 2)}\n`);
}

export function isChapterIndexRecord(value: unknown): value is ChapterIndexRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.number === "number"
    && Number.isSafeInteger(record.number)
    && record.number > 0
    && typeof record.title === "string"
    && typeof record.fileName === "string"
    && typeof record.wordCount === "number"
    && typeof record.updatedAt === "string";
}

/**
 * 将 chapters 根下的旧扁平章节迁移到卷目录，并为新目录中缺少索引的文件补索引。
 * 迁移只移动没有同名目标的文件；冲突会保留源文件，不覆盖任何用户内容。
 */
export async function synchronizeChapterLayout(
  bookId: string,
  bookRoot: string,
  resolveVolumeDirectory: ChapterVolumeDirectoryResolver,
  options: { readonly countingMode?: LengthCountingMode } = {},
): Promise<ChapterLayoutMigrationResult> {
  const chaptersRoot = join(bookRoot, CHAPTERS_DIRECTORY);
  await mkdir(chaptersRoot, { recursive: true });
  let index = await readChapterIndex(bookRoot);
  const byNumber = new Map(index.map((entry) => [entry.number, entry]));
  const conflicts: string[] = [];
  let migrated = 0;
  let changed = false;

  const directEntries = await readdir(chaptersRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of directEntries) {
    if (!entry.isFile() || entry.name === CHAPTER_INDEX_FILE || !entry.name.toLowerCase().endsWith(".md")) continue;
    const parsed = parseChapterFileName(entry.name);
    if (!parsed) continue;

    const sourcePath = join(chaptersRoot, entry.name);
    const volumeDirectory = normalizeChapterRelativePath(await resolveVolumeDirectory(bookId, parsed.number)) || DEFAULT_VOLUME_DIRECTORY;
    const targetRelativePath = chapterRelativePath(volumeDirectory, parsed.number, parsed.title);
    const targetPath = join(chaptersRoot, targetRelativePath);
    if (sourcePath !== targetPath) {
      const targetInfo = await stat(targetPath).catch(() => null);
      if (targetInfo) {
        conflicts.push(`${entry.name} -> ${targetRelativePath}`);
        continue;
      }
      const content = await readFile(sourcePath, "utf8");
      await mkdir(dirname(targetPath), { recursive: true });
      await rename(sourcePath, targetPath);
      migrated += 1;
      changed = true;
      const previous = byNumber.get(parsed.number);
      byNumber.set(parsed.number, {
        ...(previous ?? {}),
        number: parsed.number,
        title: previous?.title || chapterTitleFromContent(parsed, content),
        fileName: targetRelativePath,
        wordCount: previous?.wordCount || chapterWordCount(content, options.countingMode),
        updatedAt: previous?.updatedAt || new Date().toISOString(),
      });
      changed = true;
    }
  }

  const files = await listChapterFiles(bookRoot);
  for (const file of files) {
    const existing = byNumber.get(file.number);
    if (existing) {
      if (normalizeChapterRelativePath(existing.fileName) !== file.chapterRelativePath && !existing.fileName.includes("/")) {
        byNumber.set(file.number, { ...existing, fileName: file.chapterRelativePath });
        changed = true;
      }
      continue;
    }
    const content = await readFile(join(bookRoot, file.relativePath), "utf8").catch(() => "");
    const info = await stat(join(bookRoot, file.relativePath)).catch(() => null);
    byNumber.set(file.number, {
      number: file.number,
      title: chapterTitleFromContent(file, content),
      fileName: file.chapterRelativePath,
      wordCount: chapterWordCount(content, options.countingMode),
      updatedAt: info?.mtime.toISOString() ?? new Date().toISOString(),
      contentHash: chapterContentFingerprint(content),
      ...(info ? { fileModifiedAt: Math.floor(info.mtimeMs) } : {}),
    });
    changed = true;
  }

  index = Array.from(byNumber.values()).sort((left, right) => left.number - right.number);
  if (changed) await writeChapterIndex(bookRoot, index);
  return { migrated, indexed: index.length, conflicts };
}
