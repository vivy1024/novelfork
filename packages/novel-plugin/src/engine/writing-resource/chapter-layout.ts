import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CHAPTERS_DIRECTORY = "chapters";
export const CHAPTER_INDEX_FILE = "index.json";
export const DEFAULT_VOLUME_DIRECTORY = "卷01";

export const CHAPTER_FILE_PATTERN = /^(\d{1,9})[_-](.+)\.md$/iu;

export type ChapterIndexRecord = Record<string, unknown> & {
  number: number;
  title: string;
  fileName: string;
  wordCount: number;
  updatedAt: string;
};

export interface ParsedChapterFile {
  readonly number: number;
  readonly fileName: string;
  readonly title: string;
}

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

export function parseChapterFileName(fileName: string): ParsedChapterFile | null {
  const baseName = fileName.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? fileName;
  const match = CHAPTER_FILE_PATTERN.exec(baseName);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return {
    number,
    fileName: baseName,
    title: match[2]!.replace(/[_-]+/gu, " ").trim() || `第 ${number} 章`,
  };
}

export function chapterTitleFromContent(file: ParsedChapterFile, content: string): string {
  return /^#\s+(.+)$/mu.exec(content)?.[1]?.trim() || file.title || `第 ${file.number} 章`;
}

export function chapterWordCount(content: string): number {
  return content.replace(/\s+/gu, "").trim().length;
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

export async function readChapterIndex(bookRoot: string): Promise<ChapterIndexRecord[]> {
  const indexPath = join(bookRoot, CHAPTERS_DIRECTORY, CHAPTER_INDEX_FILE);
  const raw = await readFile(indexPath, "utf8").catch(() => "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isChapterIndexRecord);
}

export async function writeChapterIndex(bookRoot: string, entries: readonly ChapterIndexRecord[]): Promise<void> {
  const chaptersRoot = join(bookRoot, CHAPTERS_DIRECTORY);
  await mkdir(chaptersRoot, { recursive: true });
  await writeFile(join(chaptersRoot, CHAPTER_INDEX_FILE), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
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
        wordCount: previous?.wordCount || chapterWordCount(content),
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
      wordCount: chapterWordCount(content),
      updatedAt: info?.mtime.toISOString() ?? new Date().toISOString(),
    });
    changed = true;
  }

  index = Array.from(byNumber.values()).sort((left, right) => left.number - right.number);
  if (changed) await writeChapterIndex(bookRoot, index);
  return { migrated, indexed: index.length, conflicts };
}
