import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { runChannelWithTimeout } from "../channels.js";
import { createRecentSummaryChannel } from "./recent-summary-channel.js";

const tempDirs: string[] = [];
const now = new Date("2026-06-22T00:00:00.000Z");

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-recent-summary-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    jingweiMode: "dynamic",
    currentChapter: 26,
    createdAt: now,
    updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-summary",
    bookId: "book-1",
    key: "chapter-summary",
    name: "章节摘要",
    description: "",
    icon: null,
    order: 1,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "global",
    fieldsJson: [],
    builtinKind: "chapter-summary",
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function insertSummaryEntry(
  storage: StorageDatabase,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await createStoryJingweiEntryRepository(storage).create({
    id,
    bookId: "book-1",
    sectionId: "sec-summary",
    title: typeof fields.title === "string" ? fields.title : `${id} 标题`,
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
    category: "chapter-summaries",
    fields,
  });
}

describe("recent-summary channel", () => {
  it("returns the most recent chapters in descending order", async () => {
    const storage = await createStorage();
    try {
      await insertSummaryEntry(storage, "sum-22", { chapterNumber: 22, title: "旧事", summary: "第22章剧情。" });
      await insertSummaryEntry(storage, "sum-25", { chapterNumber: 25, title: "夺丹", summary: "韩立夺得筑基丹。" });
      await insertSummaryEntry(storage, "sum-24", { chapterNumber: 24, title: "围杀", summary: "墨大夫设局围杀。" });
      await insertSummaryEntry(storage, "sum-23", { chapterNumber: 23, title: "夜探", summary: "韩立夜探药园。" });

      const result = await runChannelWithTimeout(createRecentSummaryChannel(), { storage, bookId: "book-1", currentChapter: 26 });

      expect(result.status).toBe("ok");
      expect(result.cards.map((card) => card.content)).toEqual([
        "第25章《夺丹》：韩立夺得筑基丹。",
        "第24章《围杀》：墨大夫设局围杀。",
        "第23章《夜探》：韩立夜探药园。",
      ]);
      expect(result.cards.every((card) => card.channel === "recent-summary")).toBe(true);
      expect(result.warnings).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("正文结算后被改过的章：摘要仍注入，但标注可能过期并降低优先级", async () => {
    const storage = await createStorage();
    try {
      await insertSummaryEntry(storage, "sum-25", { chapterNumber: 25, title: "夺丹", summary: "韩立夺得筑基丹。" });
      await insertSummaryEntry(storage, "sum-24", { chapterNumber: 24, title: "围杀", summary: "墨大夫设局围杀。" });

      const result = await runChannelWithTimeout(createRecentSummaryChannel(), { storage, bookId: "book-1", currentChapter: 26, staleChapters: [25] });

      const stale = result.cards.find((card) => card.validUntilChapter === 25)!;
      const fresh = result.cards.find((card) => card.validUntilChapter === 24)!;
      expect(stale.content).toContain("可能已过期");
      expect(stale.tags).toContain("stale");
      expect(fresh.content).toBe("第24章《围杀》：墨大夫设局围杀。");
      expect(stale.priority).toBeLessThan(fresh.priority);
    } finally {
      storage.close();
    }
  });

  it("tolerates string chapter numbers and skips entries without summary", async () => {
    const storage = await createStorage();
    try {
      // 字符串数字章号 + 标题带「第N章」前缀（应去重不渲染成「第25章《第25章 x》」）。
      await insertSummaryEntry(storage, "sum-str", { chapterNumber: "25", title: "第25章 夺丹", summary: "字符串章号。" });
      // summary 为空 → 跳过。
      await insertSummaryEntry(storage, "sum-empty", { chapterNumber: 26, title: "空摘要", summary: "" });
      // 解析不出章号 → 跳过。
      await insertSummaryEntry(storage, "sum-noch", { title: "无章号", summary: "有摘要没章号。" });

      const result = await runChannelWithTimeout(createRecentSummaryChannel(), { storage, bookId: "book-1", currentChapter: 26 });

      expect(result.status).toBe("ok");
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.content).toBe("第25章《夺丹》：字符串章号。");
      expect(result.cards[0]?.title).toBe("第25章《夺丹》");
    } finally {
      storage.close();
    }
  });

  it("returns skipped warning when no usable summaries exist", async () => {
    const storage = await createStorage();
    try {
      const result = await createRecentSummaryChannel().run({ storage, bookId: "book-1", currentChapter: 26 });

      expect(result.status).toBe("skipped");
      expect(result.cards).toEqual([]);
      expect(result.warnings?.[0]).toContain("recent-summary channel 为空");
    } finally {
      storage.close();
    }
  });

  it("never throws when storage is broken (channel failure must not block recall)", async () => {
    const storage = await createStorage();
    try {
      // 直接关库模拟表不可用等异常场景。
      storage.close();
      const result = await createRecentSummaryChannel().run({ storage, bookId: "book-1", currentChapter: 26 });

      expect(result.status).toBe("skipped");
      expect(result.cards).toEqual([]);
    } finally {
      try {
        storage.close();
      } catch {
        // already closed
      }
    }
  });
});
