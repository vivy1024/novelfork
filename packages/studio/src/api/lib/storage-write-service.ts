import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BookConfig, ChapterMeta, StateManager } from "@vivy1024/novelfork-core";
import { isTruthFileName } from "./story-file-service.js";
import type { CreateResourceCheckpointInput, ResourceCheckpointResult } from "./resource-checkpoint-service.js";

export type ExportFormat = "markdown" | "txt";

export interface StorageWriteServiceState {
  readonly bookDir: Pick<StateManager, "bookDir">["bookDir"];
  readonly loadBookConfig: Pick<StateManager, "loadBookConfig">["loadBookConfig"];
  readonly saveBookConfig: Pick<StateManager, "saveBookConfig">["saveBookConfig"];
  readonly loadChapterIndex: Pick<StateManager, "loadChapterIndex">["loadChapterIndex"];
  readonly saveChapterIndex: Pick<StateManager, "saveChapterIndex">["saveChapterIndex"];
  readonly getNextChapterNumber: Pick<StateManager, "getNextChapterNumber">["getNextChapterNumber"];
}

export interface StorageWriteCheckpointService {
  readonly createCheckpoint: (input: CreateResourceCheckpointInput) => Promise<ResourceCheckpointResult>;
}

export interface StorageWriteCheckpointContext {
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly toolUseId?: string;
}

export interface StorageWriteServiceOptions {
  readonly state: StorageWriteServiceState;
  readonly now?: () => string;
  readonly checkpoint?: StorageWriteCheckpointService;
}

export interface CreateChapterInput {
  readonly title?: string;
  readonly afterChapterNumber?: number;
}

export interface BuildExportInput {
  readonly format?: unknown;
  readonly approvedOnly?: boolean;
}

interface ExportChapter {
  readonly number: number;
  readonly fileName: string;
  readonly content: string;
}

function currentIso(options: StorageWriteServiceOptions): string {
  return options.now?.() ?? new Date().toISOString();
}

export function sanitizeChapterFileTitle(title: string): string {
  const sanitized = title.replace(/[\\/?%*:|"<>]/g, "").replace(/\s+/g, "_").slice(0, 50);
  return sanitized || "chapter";
}

export function countChapterWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}

export function normalizeExportFormat(value: unknown): ExportFormat | null {
  if (value === undefined || value === null || value === "" || value === "txt") return "txt";
  if (value === "markdown" || value === "md") return "markdown";
  return null;
}

export function exportContentType(format: ExportFormat): string {
  return format === "markdown" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
}

export function exportFileName(bookId: string, format: ExportFormat): string {
  return `${bookId}.${format === "markdown" ? "md" : "txt"}`;
}

async function listExistingChapterNumbers(chaptersDir: string): Promise<number[]> {
  try {
    const files = await readdir(chaptersDir);
    return files.flatMap((file) => {
      const match = file.match(/^(\d{4})/);
      return match ? [Number.parseInt(match[1]!, 10)] : [];
    });
  } catch {
    return [];
  }
}

async function resolveChapterFileName(chaptersDir: string, chapterNumber: number, meta: Record<string, unknown>): Promise<string> {
  if (typeof meta.fileName === "string" && meta.fileName.trim()) return meta.fileName;
  if (typeof meta.filename === "string" && meta.filename.trim()) return meta.filename;
  const prefix = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir);
  const matched = files.find((file) => file.startsWith(prefix) && file.endsWith(".md"));
  if (!matched) throw new Error(`Chapter ${chapterNumber} has no saved markdown file`);
  return matched;
}

async function loadExportChapters(chaptersDir: string, index: ReadonlyArray<Record<string, unknown>>, approvedOnly: boolean): Promise<ReadonlyArray<ExportChapter>> {
  const selected = approvedOnly ? index.filter((chapter) => chapter.status === "approved") : index;
  return Promise.all(selected.map(async (meta) => {
    const number = typeof meta.number === "number" ? meta.number : 0;
    const fileName = await resolveChapterFileName(chaptersDir, number, meta);
    try {
      return {
        number,
        fileName,
        content: await readFile(join(chaptersDir, fileName), "utf-8"),
      };
    } catch (error) {
      throw new Error(`Failed to read chapter file ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}

function buildExportContent(chapters: ReadonlyArray<ExportChapter>, format: ExportFormat): string {
  return chapters
    .slice()
    .sort((left, right) => left.number - right.number)
    .map((chapter) => chapter.content)
    .join(format === "markdown" ? "\n\n---\n\n" : "\n\n");
}

async function createCheckpointIfConfigured(
  options: StorageWriteServiceOptions,
  input: Omit<CreateResourceCheckpointInput, "sessionId"> & { readonly sessionId?: string },
): Promise<{ readonly checkpointId?: string } | { readonly error: string }> {
  if (!options.checkpoint) return {};
  const result = await options.checkpoint.createCheckpoint({ ...input, sessionId: input.sessionId ?? "workbench" });
  if (!result.ok) return { error: result.error };
  return { checkpointId: result.checkpoint.id };
}

export function createStorageWriteService(options: StorageWriteServiceOptions) {
  const { state } = options;

  return {
    async updateBook(bookId: string, updates: { readonly chapterWordCount?: number; readonly targetChapters?: number; readonly status?: string; readonly language?: string }) {
      const book = await state.loadBookConfig(bookId);
      const updated: BookConfig = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as BookConfig["status"] } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" } : {}),
        updatedAt: currentIso(options),
      };
      await state.saveBookConfig(bookId, updated);
      return { ok: true, book: updated };
    },

    async createChapter(bookId: string, input: CreateChapterInput) {
      const book = await state.loadBookConfig(bookId);
      const chaptersDir = join(state.bookDir(bookId), "chapters");
      const existingIndex = [...await state.loadChapterIndex(bookId)] as ChapterMeta[];
      const existingFileNumbers = await listExistingChapterNumbers(chaptersDir);
      const nextFromIndex = Math.max(0, ...existingIndex.map((chapter) => chapter.number)) + 1;
      const nextFromFiles = Math.max(0, ...existingFileNumbers) + 1;
      const nextFromState = await state.getNextChapterNumber(bookId).catch(() => 1);
      const requestedAfterChapterNumber = input.afterChapterNumber;
      const afterChapterNumber = typeof requestedAfterChapterNumber === "number"
        && Number.isInteger(requestedAfterChapterNumber)
        && requestedAfterChapterNumber > 0
        ? requestedAfterChapterNumber + 1
        : 1;
      const chapterNumber = Math.max(nextFromIndex, nextFromFiles, nextFromState, afterChapterNumber);
      const defaultTitle = book.language === "en" ? `Chapter ${chapterNumber}` : `第 ${chapterNumber} 章`;
      const title = input.title?.trim() || defaultTitle;
      const fileName = `${String(chapterNumber).padStart(4, "0")}_${sanitizeChapterFileTitle(title)}.md`;
      const now = currentIso(options);
      const content = `# ${title}\n\n`;
      const entry: ChapterMeta = {
        number: chapterNumber,
        title,
        status: "drafting",
        wordCount: countChapterWords(content.replace(/^# .*\n\n/, "")),
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      };

      await mkdir(chaptersDir, { recursive: true });
      await writeFile(join(chaptersDir, fileName), content, "utf-8");
      await state.saveChapterIndex(bookId, [...existingIndex, entry].sort((left, right) => left.number - right.number));

      return {
        chapter: {
          number: entry.number,
          title: entry.title,
          status: entry.status,
          wordCount: entry.wordCount,
          auditIssueCount: entry.auditIssues.length,
          updatedAt: entry.updatedAt,
          fileName,
        },
      };
    },

    async updateChapterContent(bookId: string, chapterNumber: number, content: string, checkpointContext: StorageWriteCheckpointContext = {}) {
      const chaptersDir = join(state.bookDir(bookId), "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNumber).padStart(4, "0");
      const match = files.find((file) => file.startsWith(paddedNum) && file.endsWith(".md"));
      if (!match) return { error: "Chapter not found" as const };
      const checkpoint = await createCheckpointIfConfigured(options, {
        bookId,
        sessionId: checkpointContext.sessionId,
        messageId: checkpointContext.messageId,
        toolUseId: checkpointContext.toolUseId,
        reason: "chapter-write",
        resources: [{ kind: "chapter", id: `chapter:${chapterNumber}`, path: `chapters/${match}`, required: true }],
      });
      if ("error" in checkpoint) return { error: checkpoint.error };
      await writeFile(join(chaptersDir, match), content, "utf-8");
      return { ok: true, chapterNumber, ...(checkpoint.checkpointId ? { checkpointId: checkpoint.checkpointId } : {}) };
    },

    async writeTruthFile(bookId: string, file: string, content: string, checkpointContext: StorageWriteCheckpointContext = {}) {
      if (!isTruthFileName(file)) {
        return { error: "Invalid truth file" as const };
      }
      const storyDir = join(state.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      const checkpoint = await createCheckpointIfConfigured(options, {
        bookId,
        sessionId: checkpointContext.sessionId,
        messageId: checkpointContext.messageId,
        toolUseId: checkpointContext.toolUseId,
        reason: "truth-write",
        resources: [{ kind: "truth", id: `truth:${file}`, path: `story/${file}` }],
      });
      if ("error" in checkpoint) return { error: checkpoint.error };
      await writeFile(join(storyDir, file), content, "utf-8");
      return { ok: true, ...(checkpoint.checkpointId ? { checkpointId: checkpoint.checkpointId } : {}) };
    },

    async buildExport(bookId: string, input: BuildExportInput) {
      const format = normalizeExportFormat(input.format);
      if (!format) return { error: `Unsupported export format: ${String(input.format)}` };
      const chaptersDir = join(state.bookDir(bookId), "chapters");
      await state.loadBookConfig(bookId);
      const index = await state.loadChapterIndex(bookId) as unknown as ReadonlyArray<Record<string, unknown>>;
      const chapters = await loadExportChapters(chaptersDir, index, Boolean(input.approvedOnly));
      return {
        fileName: exportFileName(bookId, format),
        contentType: exportContentType(format),
        content: buildExportContent(chapters, format),
        chapterCount: chapters.length,
      };
    },
  };
}
