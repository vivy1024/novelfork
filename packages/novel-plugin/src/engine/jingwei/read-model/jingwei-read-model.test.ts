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
      expect(result.items[0]?.matchReason).toContain("aliases");
      expect(result.estimatedTokens).toBeLessThanOrEqual(100);
    } finally {
      storage.close();
    }
  });

  it("keeps exact title matches first when a search token budget is present", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await entries.create(entry({ id: "zhaoming", sectionId: "sec-people", title: "赵铭（标注组同事）", contentMd: "赵铭负责日常同事对话。" }));
      await entries.create(entry({ id: "b17", sectionId: "sec-hooks", title: "B-17异常波形", contentMd: "B-17是当前卷核心伏笔。" }));
      await entries.create(entry({
        id: "generic-core",
        sectionId: "sec-premise",
        title: "当前卷核心资料",
        contentMd: "本资料同时提及赵铭和B-17，也会多次提及韩立。韩立、韩立、韩立。",
        visibilityRule: { type: "global" },
        priorityTier: "core",
        importance: 100,
      }));

      for (const [query, expectedId] of [["韩立", "hanli"], ["赵铭", "zhaoming"], ["B-17", "b17"]] as const) {
        const result = await searchJingwei({ storage, bookId: "book-1", query, tokenBudget: 5_000 });
        expect(result.items[0]?.entryId).toBe(expectedId);
      }
    } finally {
      storage.close();
    }
  });

  it("searches multi-term queries with AND semantics", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      // 「韩立 小瓶」：hanli（别名/关键词）与 summary-11（正文同现）都是合法命中
      const hit = await searchJingwei({ storage, bookId: "book-1", query: "韩立 小瓶" });
      expect(hit.items.map((item) => item.entryId)).toEqual(expect.arrayContaining(["hanli", "summary-11"]));

      // 反向：词都不在同一条目 → 0
      const miss = await searchJingwei({ storage, bookId: "book-1", query: "韩立 太清门" });
      expect(miss.returnedCount).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("includeUnconfirmed returns draft/needs-review entries for author-side search", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await entries.create(entry({ id: "draft-entry", sectionId: "sec-people", title: "草稿设定", contentMd: "待确认的设定草案。", aliases: ["草稿别名"] }));
      await entries.create(entry({ id: "review-entry", sectionId: "sec-people", title: "待审设定", contentMd: "需作者审查的设定。", aliases: ["待审别名"] }));
      storage.sqlite.prepare(`UPDATE story_jingwei_entry SET status = 'draft' WHERE id = 'draft-entry'`).run();
      storage.sqlite.prepare(`UPDATE story_jingwei_entry SET status = 'needs-review' WHERE id = 'review-entry'`).run();

      const agentView = await searchJingwei({ storage, bookId: "book-1", query: "草稿别名" });
      expect(agentView.returnedCount).toBe(0);

      const authorView = await searchJingwei({ storage, bookId: "book-1", query: "草稿别名", includeUnconfirmed: true });
      expect(authorView.items.map((item) => item.entryId)).toEqual(["draft-entry"]);
      expect(authorView.items[0]?.status ?? authorView.items[0]?.matchReason).toBeTruthy();
    } finally {
      storage.close();
    }
  });

  it("filters by categories and drops bigram false positives", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      // 真命中：正文含「太清门」
      await entries.create(entry({ id: "real-hit", sectionId: "sec-people", title: "太清门", contentMd: "太清门是青蛟岛第一大宗。" }));
      // 假阳性构造：正文「太清。清门」相邻，bigram phrase 会命中，精确校验应剔除
      await entries.create(entry({ id: "false-positive", sectionId: "sec-people", title: "断句条目", contentMd: "他登上太清。清门之外风雪交加。" }));

      const hit = await searchJingwei({ storage, bookId: "book-1", query: "太清门" });
      expect(hit.items.map((item) => item.entryId)).toEqual(["real-hit"]);
      // 假阳性验证：断句条目含「太清。清门」，不含「太清门」连续词，不得进入结果
      expect(hit.items.map((item) => item.entryId)).not.toContain("false-positive");

      const byCategory = await searchJingwei({ storage, bookId: "book-1", query: "韩老魔", categories: ["foreshadowing"] });
      expect(byCategory.returnedCount).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("filters inactive lore from brief, category, and search reads", async () => {
    const storage = await createStorage();
    try {
      await seedJingwei(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await entries.create(entry({ id: "optout", sectionId: "sec-people", title: "不参与AI", contentMd: "不应进入 Lore 召回。", participatesInAi: false, aliases: ["隐藏别名"] }));
      await entries.create(entry({ id: "draft-entry", sectionId: "sec-people", title: "草稿设定", contentMd: "不应进入 Lore 召回。", aliases: ["草稿别名"] }));
      await entries.create(entry({ id: "review-entry", sectionId: "sec-people", title: "待审设定", contentMd: "不应进入 Lore 召回。", aliases: ["待审别名"] }));
      await entries.create(entry({ id: "archived-entry", sectionId: "sec-people", title: "归档设定", contentMd: "不应进入 Lore 召回。", aliases: ["归档别名"] }));
      storage.sqlite.prepare(`UPDATE story_jingwei_entry SET status = 'draft' WHERE id = 'draft-entry'`).run();
      storage.sqlite.prepare(`UPDATE story_jingwei_entry SET status = 'needs-review' WHERE id = 'review-entry'`).run();
      storage.sqlite.prepare(`UPDATE story_jingwei_entry SET lifecycle = 'archived' WHERE id = 'archived-entry'`).run();

      const brief = await buildJingweiBrief({ storage, bookId: "book-1", chapterNumber: 12, sceneText: "隐藏别名 草稿别名 待审别名 归档别名", tokenBudget: 1000 });
      const category = await readJingweiCategory({ storage, bookId: "book-1", category: "characters", limit: 20 });
      const search = await searchJingwei({ storage, bookId: "book-1", query: "草稿别名", tokenBudget: 1000 });

      const briefIds = brief.coreBrief.map((item) => item.entryId);
      const categoryIds = category.items.map((item) => item.entryId);
      expect(briefIds).not.toEqual(expect.arrayContaining(["optout", "draft-entry", "review-entry", "archived-entry"]));
      expect(categoryIds).not.toEqual(expect.arrayContaining(["optout", "draft-entry", "review-entry", "archived-entry"]));
      expect(search.returnedCount).toBe(0);
    } finally {
      storage.close();
    }
  });
});
