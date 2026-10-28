/**
 * 长篇召回测试夹具：造一本只含经纬章摘要条目与卷纲条目的书（默认 300 章 / 6 卷）。
 *
 * 只在测试里用；不进生产路径。章摘要走 chapter-summaries 分类（权威源），
 * 卷纲走 outline 分类「卷纲」条目的 fields_json.volumes（权威源）。
 * updated_at 故意与章号逆序（旧章后更新），复现「按 updated_at 粗筛会挤掉近章」的问题。
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";

export const LONG_BOOK_ID = "book-long";
const baseTime = new Date("2026-06-22T00:00:00.000Z").getTime();

export interface LongBookHandle {
  readonly storage: StorageDatabase;
  readonly cleanup: () => Promise<void>;
}

export async function createLongBookStorage(prefix = "novelfork-long-book"): Promise<LongBookHandle> {
  const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date(baseTime);
  await createBookRepository(storage).create({
    id: LONG_BOOK_ID,
    name: "长篇测试书",
    jingweiMode: "dynamic",
    currentChapter: 300,
    createdAt: now,
    updatedAt: now,
  });
  return {
    storage,
    cleanup: async () => {
      try {
        storage.close();
      } catch {
        // already closed
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function ensureSection(storage: StorageDatabase, id: string, key: string, name: string): Promise<void> {
  const existing = storage.sqlite.prepare(`SELECT id FROM story_jingwei_section WHERE id = ?`).get(id);
  if (existing) return;
  const now = new Date(baseTime);
  await createStoryJingweiSectionRepository(storage).create({
    id,
    bookId: LONG_BOOK_ID,
    key,
    name,
    description: "",
    icon: null,
    order: 1,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "global",
    fieldsJson: [],
    builtinKind: key,
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** 第 N 章摘要正文：首句带章号标记，便于断言「哪一章的内容进了召回」。 */
export function longBookSummaryText(chapter: number): string {
  return `第${chapter}章要事：主角在第${chapter}章完成关键一步。此后局势继续发酵，各方势力暗中调整布局，细节铺陈若干。`;
}

/**
 * updatedOrder：
 *   - "old-first"（默认）旧章 updated_at 更晚，模拟「回头修改旧章摘要」后的分布；
 *   - "new-first" 新章 updated_at 更晚，模拟「顺写到 300 章后回头修第 120 章」。
 */
export async function seedChapterSummaries(
  storage: StorageDatabase,
  totalChapters: number,
  updatedOrder: "old-first" | "new-first" = "old-first",
): Promise<void> {
  await ensureSection(storage, "sec-summary", "chapter-summary", "章节摘要");
  const repo = createStoryJingweiEntryRepository(storage);
  for (let chapter = 1; chapter <= totalChapters; chapter += 1) {
    const offset = updatedOrder === "old-first" ? totalChapters - chapter : chapter;
    const updatedAt = new Date(baseTime + offset * 60_000);
    await repo.create({
      id: `sum-${chapter}`,
      bookId: LONG_BOOK_ID,
      sectionId: "sec-summary",
      title: `第${chapter}章`,
      contentMd: longBookSummaryText(chapter),
      summaryMd: longBookSummaryText(chapter),
      tags: [],
      aliases: [],
      customFields: {},
      relatedChapterNumbers: [chapter],
      relatedEntryIds: [],
      visibilityRule: { type: "nested" },
      participatesInAi: true,
      tokenBudget: null,
      priorityTier: "reference",
      importance: 40,
      summaryL0: "",
      createdAt: updatedAt,
      updatedAt,
      category: "chapter-summaries",
      fields: { chapterNumber: chapter, title: `章${chapter}`, summary: longBookSummaryText(chapter) },
    });
  }
}

export async function seedVolumeOutline(storage: StorageDatabase, volumeCount: number, chaptersPerVolume: number): Promise<void> {
  await ensureSection(storage, "sec-outline", "outline", "卷纲/大纲");
  const volumes = Array.from({ length: volumeCount }, (_, index) => ({
    id: `vol-${index + 1}`,
    title: `第${index + 1}卷`,
    chapterRange: { from: index * chaptersPerVolume + 1, to: (index + 1) * chaptersPerVolume },
    goal: `第${index + 1}卷目标`,
    status: "planned",
  }));
  const now = new Date(baseTime);
  await createStoryJingweiEntryRepository(storage).create({
    id: "outline-volumes",
    bookId: LONG_BOOK_ID,
    sectionId: "sec-outline",
    title: "卷纲",
    contentMd: "",
    summaryMd: "",
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "global" },
    participatesInAi: true,
    tokenBudget: null,
    priorityTier: "reference",
    importance: 40,
    summaryL0: "",
    createdAt: now,
    updatedAt: now,
    category: "outline",
    fields: { volumes },
  });
}

/** 一本 300 章 / 6 卷（每卷 50 章）的书。 */
export async function seedLongBook(storage: StorageDatabase, updatedOrder: "old-first" | "new-first" = "old-first"): Promise<void> {
  await seedChapterSummaries(storage, 300, updatedOrder);
  await seedVolumeOutline(storage, 6, 50);
}
