/**
 * chapter.discard_range — 试写整段丢弃：抹去范围内正式章结果与章域记忆，并按策略重置伏笔。
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { listChapterFiles } from "../engine/writing-resource/chapter-layout.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";

export type HookResetStrategy = "untouched" | "planned-only" | "none";

export interface ChapterDiscardRangeInput {
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  /** 必须为 true，防止误触 */
  readonly confirm: true;
  readonly deleteMemory?: boolean;
  readonly resetHooks?: HookResetStrategy;
  /** false=归档正文资源（默认）；true=尽量物理删除章节文件 */
  readonly hardDelete?: boolean;
  readonly bookRoot?: string;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
}

export interface ChapterDiscardRangeResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  readonly deletedChapters: number;
  readonly archivedResources: number;
  readonly deletedChapterFiles: number;
  readonly deletedEvents: number;
  readonly deletedFacts: number;
  readonly deletedLogs: number;
  readonly hooksReset: number;
  readonly hooksNotes: readonly string[];
  readonly summary: string;
  readonly error?: string;
  readonly details?: readonly string[];
}

function fail(error: string, summary: string, partial?: Partial<ChapterDiscardRangeResult>): ChapterDiscardRangeResult {
  return {
    ok: false,
    bookId: partial?.bookId ?? "",
    fromChapter: partial?.fromChapter ?? 0,
    toChapter: partial?.toChapter ?? 0,
    deletedChapters: partial?.deletedChapters ?? 0,
    archivedResources: partial?.archivedResources ?? 0,
    deletedChapterFiles: partial?.deletedChapterFiles ?? 0,
    deletedEvents: partial?.deletedEvents ?? 0,
    deletedFacts: partial?.deletedFacts ?? 0,
    deletedLogs: partial?.deletedLogs ?? 0,
    hooksReset: partial?.hooksReset ?? 0,
    hooksNotes: partial?.hooksNotes ?? [],
    summary,
    error,
  };
}

async function archiveOrDeleteChapterFiles(
  bookRoot: string,
  fromChapter: number,
  toChapter: number,
  hardDelete: boolean,
  now: Date,
): Promise<{ deletedChapterFiles: number; details: string[] }> {
  const chaptersDir = join(bookRoot, "chapters");
  const details: string[] = [];
  let deletedChapterFiles = 0;
  const files = await listChapterFiles(bookRoot);
  if (files.length === 0) {
    details.push("chapters 目录不存在或没有章节文件，跳过文件清理。");
  } else {
    const archiveDir = join(bookRoot, "chapters", "_discarded", now.toISOString().replace(/[:.]/gu, "-"));
    if (!hardDelete) {
      await mkdir(archiveDir, { recursive: true });
    }

    for (const file of files) {
      if (file.number < fromChapter || file.number > toChapter) continue;
      const full = join(bookRoot, file.relativePath);
      if (hardDelete) {
        await rm(full, { force: true });
        details.push(`deleted ${file.chapterRelativePath}`);
      } else {
        const archivedPath = join(archiveDir, file.chapterRelativePath);
        await mkdir(dirname(archivedPath), { recursive: true });
        await rename(full, archivedPath);
        details.push(`archived ${file.chapterRelativePath}`);
      }
      deletedChapterFiles += 1;
    }
  }

  // 同步裁剪 index.json 中范围内条目（若存在）
  const indexPath = join(chaptersDir, "index.json");
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const next = parsed.filter((entry) => {
        if (!entry || typeof entry !== "object") return true;
        const number = Number((entry as { number?: unknown }).number);
        return !Number.isFinite(number) || number < fromChapter || number > toChapter;
      });
      if (next.length !== parsed.length) {
        await writeFile(indexPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        details.push(`index.json 移除 ${parsed.length - next.length} 条章节元数据`);
      }
    }
  } catch {
    // index 可选
  }

  return { deletedChapterFiles, details };
}

function deleteMemoryInRange(
  storage: StorageDatabase,
  bookId: string,
  fromChapter: number,
  toChapter: number,
): { deletedEvents: number; deletedFacts: number; deletedLogs: number } {
  ensureNarrativeMemorySchema(storage);
  const deletedEvents = storage.sqlite.prepare(`
    DELETE FROM narrative_event
    WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
  `).run(bookId, fromChapter, toChapter).changes;

  const deletedFacts = storage.sqlite.prepare(`
    DELETE FROM narrative_fact
    WHERE book_id = ?
      AND (
        (source_chapter IS NOT NULL AND source_chapter >= ? AND source_chapter <= ?)
        OR (valid_from_chapter IS NOT NULL AND valid_from_chapter >= ? AND valid_from_chapter <= ?
            AND (valid_until_chapter IS NULL OR valid_until_chapter <= ?))
      )
  `).run(bookId, fromChapter, toChapter, fromChapter, toChapter, toChapter).changes;

  let deletedLogs = 0;
  try {
    deletedLogs = storage.sqlite.prepare(`
      DELETE FROM narrative_retrieval_log
      WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
    `).run(bookId, fromChapter, toChapter).changes;
  } catch {
    deletedLogs = 0;
  }

  return { deletedEvents, deletedFacts, deletedLogs };
}

async function resetHooksInRange(
  storage: StorageDatabase,
  bookId: string,
  fromChapter: number,
  toChapter: number,
  strategy: HookResetStrategy,
  bookRoot: string,
): Promise<{ hooksReset: number; hooksNotes: string[] }> {
  if (strategy === "none") return { hooksReset: 0, hooksNotes: ["resetHooks=none，未修改伏笔。"] };

  const notes: string[] = [];
  let hooksReset = 0;

  // 经纬 foreshadowing：按 related chapter 落在范围内的条目软退役或打回 planned 标记
  try {
    const rows = storage.sqlite.prepare(`
      SELECT id, title, related_chapter_numbers_json, fields_json, lifecycle
      FROM story_jingwei_entry
      WHERE book_id = ?
        AND category IN ('foreshadowing', 'hook', 'pending-hook')
        AND deleted_at IS NULL
    `).all(bookId) as Array<{
      id: string;
      title: string;
      related_chapter_numbers_json: string | null;
      fields_json: string | null;
      lifecycle: string | null;
    }>;

    for (const row of rows) {
      let chapters: number[] = [];
      try {
        const parsed = JSON.parse(row.related_chapter_numbers_json ?? "[]") as unknown;
        chapters = Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : [];
      } catch {
        chapters = [];
      }
      const hit = chapters.some((n) => n >= fromChapter && n <= toChapter);
      if (!hit) continue;

      if (strategy === "planned-only") {
        // 仅把仍 active 的标记为 planned 语义：lifecycle 保持 active，fields 记 reset
        let fields: Record<string, unknown> = {};
        try {
          fields = row.fields_json ? JSON.parse(row.fields_json) as Record<string, unknown> : {};
        } catch {
          fields = {};
        }
        fields.hookStatus = "planned";
        fields.resetByDiscardRange = { fromChapter, toChapter };
        storage.sqlite.prepare(`
          UPDATE story_jingwei_entry
          SET fields_json = ?, updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(fields), new Date().toISOString(), row.id);
      } else {
        // untouched：软归档，避免假「待埋设」继续污染驾驶舱
        storage.sqlite.prepare(`
          UPDATE story_jingwei_entry
          SET lifecycle = 'archived', deleted_at = ?, updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), new Date().toISOString(), row.id);
      }
      hooksReset += 1;
      notes.push(`${strategy}: ${row.title} (${row.id})`);
    }
  } catch (error) {
    notes.push(`经纬伏笔重置跳过：${error instanceof Error ? error.message : String(error)}`);
  }

  // story/pending_hooks.md：移除「第N章」落在范围内的行（MVP 文本启发式）
  try {
    const hooksPath = join(bookRoot, "story", "pending_hooks.md");
    const content = await readFile(hooksPath, "utf8").catch(() => "");
    if (content.trim()) {
      const lines = content.split(/\r?\n/u);
      const next = lines.filter((line) => {
        const match = line.match(/第\s*(\d+)\s*章/u);
        if (!match) return true;
        const n = Number(match[1]);
        return !Number.isFinite(n) || n < fromChapter || n > toChapter;
      });
      if (next.length !== lines.length) {
        await mkdir(dirname(hooksPath), { recursive: true });
        await writeFile(hooksPath, `${next.join("\n").replace(/\n+$/u, "")}\n`, "utf8");
        notes.push(`pending_hooks.md 移除 ${lines.length - next.length} 行范围内伏笔文本`);
      }
    }
  } catch (error) {
    notes.push(`pending_hooks.md 处理跳过：${error instanceof Error ? error.message : String(error)}`);
  }

  return { hooksReset, hooksNotes: notes };
}

export async function handleChapterDiscardRange(input: ChapterDiscardRangeInput): Promise<ChapterDiscardRangeResult> {
  const bookId = input.bookId?.trim();
  if (!bookId) return fail("missing-book-id", "缺少 bookId。");
  if (input.confirm !== true) {
    return fail("confirm-required", "chapter.discard_range 必须 confirm=true。", { bookId });
  }
  if (!input.bookRoot?.trim()) {
    return fail("missing-book-root", "缺少可信 bookRoot。", { bookId });
  }

  const fromChapter = Math.trunc(input.fromChapter);
  const toChapter = Math.trunc(input.toChapter);
  if (!Number.isFinite(fromChapter) || !Number.isFinite(toChapter) || fromChapter < 1 || toChapter < fromChapter) {
    return fail("invalid-range", "fromChapter/toChapter 无效：需满足 1 ≤ from ≤ to。", { bookId, fromChapter, toChapter });
  }
  if (toChapter - fromChapter > 200) {
    return fail("range-too-large", "单次 discard_range 最多 200 章。", { bookId, fromChapter, toChapter });
  }

  const storage = input.storage ?? getStorageDatabase();
  const hardDelete = Boolean(input.hardDelete);
  const deleteMemory = input.deleteMemory !== false;
  const resetHooks = input.resetHooks ?? "untouched";
  const now = input.now?.() ?? new Date();
  const details: string[] = [];

  let archivedResources = 0;
  try {
    const service = createWritingResourceService({
      storage,
      resolveBookDir: () => input.bookRoot!,
      resolveChapterVolumeDirectory: (requestedBookId, chapterNumber) => resolveChapterVolumeDirectory(
        storage,
        requestedBookId,
        chapterNumber,
      ),
    });
    const resources = await service.list(bookId, { type: "chapter" });
    for (const resource of resources) {
      const n = resource.chapterNumber;
      if (typeof n !== "number" || n < fromChapter || n > toChapter) continue;
      // accepted 正式章不可 transition 到 archived；统一 softDelete / 文件归档。
      await service.softDelete(bookId, resource.id);
      details.push(`soft-deleted resource ${resource.id} ch${n}`);
      archivedResources += 1;
    }
  } catch (error) {
    details.push(`writing-resource 清理部分失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const fileResult = await archiveOrDeleteChapterFiles(input.bookRoot!, fromChapter, toChapter, hardDelete, now);
  details.push(...fileResult.details);

  let deletedEvents = 0;
  let deletedFacts = 0;
  let deletedLogs = 0;
  if (deleteMemory) {
    const mem = deleteMemoryInRange(storage, bookId, fromChapter, toChapter);
    deletedEvents = mem.deletedEvents;
    deletedFacts = mem.deletedFacts;
    deletedLogs = mem.deletedLogs;
  }

  const hookResult = await resetHooksInRange(storage, bookId, fromChapter, toChapter, resetHooks, input.bookRoot!);

  const deletedChapters = Math.max(archivedResources, fileResult.deletedChapterFiles);
  return {
    ok: true,
    bookId,
    fromChapter,
    toChapter,
    deletedChapters,
    archivedResources,
    deletedChapterFiles: fileResult.deletedChapterFiles,
    deletedEvents,
    deletedFacts,
    deletedLogs,
    hooksReset: hookResult.hooksReset,
    hooksNotes: hookResult.hooksNotes,
    details,
    summary: `已丢弃第 ${fromChapter}-${toChapter} 章：资源 ${archivedResources}，文件 ${fileResult.deletedChapterFiles}，events ${deletedEvents}，facts ${deletedFacts}，hooks ${hookResult.hooksReset}。后续 write.preflight 应显示无该段近章记忆。`,
  };
}
