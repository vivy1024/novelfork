import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import type { CreateStoryJingweiEntryInput, CreateStoryJingweiSectionInput } from "../types.js";
import { buildJingweiBrief } from "./build-jingwei-brief.js";
import { readJingweiCategory } from "./read-jingwei-category.js";
import { searchJingwei } from "./search-jingwei.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-read-model-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    jingweiMode: "dynamic",
    currentChapter: 12,
    createdAt: new Date("2026-05-20T01:00:00.000Z"),
    updatedAt: new Date("2026-05-20T01:00:00.000Z"),
  });
  return storage;
}

function section(input: Partial<CreateStoryJingweiSectionInput> & Pick<CreateStoryJingweiSectionInput, "id" | "key" | "name">): CreateStoryJingweiSectionInput {
  const now = new Date("2026-05-20T02:00:00.000Z");
  return {
    bookId: "book-1",
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: null,
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function entry(input: Partial<CreateStoryJingweiEntryInput> & Pick<CreateStoryJingweiEntryInput, "id" | "sectionId" | "title" | "contentMd">): CreateStoryJingweiEntryInput {
  const now = new Date("2026-05-20T03:00:00.000Z");
  return {
    bookId: "book-1",
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" },
    participatesInAi: true,
    tokenBudget: null,
    priorityTier: "auto",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

async function seedJingwei(storage: StorageDatabase) {
  const sections = createStoryJingweiSectionRepository(storage);
  const entries = createStoryJingweiEntryRepository(storage);
  await sections.create(section({ id: "sec-premise", key: "premise", name: "故事基线", builtinKind: "premise", defaultVisibility: "global", order: 0 }));
  await sections.create(section({ id: "sec-people", key: "people", name: "人物", builtinKind: "people", order: 1 }));
  await sections.create(section({ id: "sec-hooks", key: "foreshadowing", name: "伏笔", builtinKind: "foreshadowing", order: 2 }));
  await sections.create(section({ id: "sec-summary", key: "chapter-summary", name: "章节摘要", builtinKind: "chapter-summary", order: 3 }));

  await entries.create(entry({ id: "premise", sectionId: "sec-premise", title: "长生主线", contentMd: "韩立以谨慎求长生为主线。".repeat(20), summaryMd: "谨慎求长生。", visibilityRule: { type: "global" }, priorityTier: "core" }));
  await entries.create(entry({ id: "hanli", sectionId: "sec-people", title: "韩立", contentMd: "谨慎、低调、重视资源账本。", aliases: ["韩老魔"], visibilityRule: { type: "tracked", keywords: ["小瓶"] }, priorityTier: "relevant" }));
  await entries.create(entry({ id: "hook", sectionId: "sec-hooks", title: "小瓶秘密", contentMd: "小瓶能力还不能被外人发现。", tags: ["小瓶"], visibilityRule: { type: "tracked", keywords: ["小瓶"] }, priorityTier: "relevant" }));
  await entries.create(entry({ id: "summary-11", sectionId: "sec-summary", title: "第11章摘要", contentMd: "韩立发现小瓶可以催熟灵草。", customFields: { category: "chapter-summaries" }, visibilityRule: { type: "global" } }));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Jingwei indexed read model", () => {
  it("builds a compact core brief with category index and recommendations", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const result = await buildJingweiBrief({ storage, bookId: "book-1", chapterNumber: 12, sceneText: "韩立检查小瓶。", tokenBudget: 80 });

      expect(result.ok).toBe(true);
      expect(result.coreBrief.map((item) => item.entryId)).toContain("premise");
      expect(result.coreBrief.some((item) => item.summaryMd === "谨慎求长生。")).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(80);
      expect(result.index.categories.map((item) => item.category)).toEqual(expect.arrayContaining(["premise", "characters", "foreshadowing", "chapter-summaries"]));
      expect(result.recommendedReads.length).toBeGreaterThan(0);
    } finally {
      storage.close();
    }
  });

  it("reads one category with pagination and summary detail level", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const result = await readJingweiCategory({ storage, bookId: "book-1", category: "characters", sceneText: "小瓶", page: 1, limit: 1, detailLevel: "summary" });

      expect(result.category).toBe("characters");
      expect(result.returnedCount).toBe(1);
      expect(result.items[0]?.entryId).toBe("hanli");
      expect(result.items[0]?.contentMd.length).toBeLessThanOrEqual(260);
    } finally {
      storage.close();
    }
  });

  it("searches aliases, tags, summaries, and content under token budget", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const result = await searchJingwei({ storage, bookId: "book-1", query: "韩老魔", tokenBudget: 100 });

      expect(result.returnedCount).toBe(1);
      expect(result.items[0]?.entryId).toBe("hanli");
      expect(result.items[0]?.matchReason).toBe("别名命中");
      expect(result.estimatedTokens).toBeLessThanOrEqual(100);
    } finally {
      storage.close();
    }
  });
});
