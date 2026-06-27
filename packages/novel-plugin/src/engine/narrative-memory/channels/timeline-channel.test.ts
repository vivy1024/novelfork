import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { createTimelineChannel } from "./timeline-channel.js";
import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";

const tempDirs: string[] = [];
const now = new Date("2026-06-22T00:00:00.000Z");

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-timeline-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    jingweiMode: "dynamic",
    currentChapter: 12,
    createdAt: now,
    updatedAt: now,
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const sceneSpec: SceneSpec = {
  chapter: 12,
  title: "小瓶风波",
  wordTarget: 3000,
  scenes: [{ characters: ["韩立"], location: "药园", conflict: "小瓶秘密被试探", mood: "紧张→克制", outcome: "守住秘密", hooks_used: [], hooks_planted: [] }],
  constraints: [],
};

function snapshot(): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "zh", lastAppliedChapter: 11, projectionVersion: 1, migrationWarnings: [] },
    currentState: { chapter: 11, facts: [] },
    hooks: { hooks: [] },
    chapterSummaries: {
      rows: [
        { chapter: 9, title: "旧事", characters: "韩立", events: "韩立入门", stateChanges: "", hookActivity: "", mood: "平稳", chapterType: "铺垫" },
        { chapter: 10, title: "小瓶初现", characters: "韩立", events: "韩立发现小瓶异动", stateChanges: "开始隐瞒", hookActivity: "小瓶伏笔推进", mood: "惊疑", chapterType: "主线" },
        { chapter: 11, title: "药园试探", characters: "韩立、墨大夫", events: "墨大夫试探韩立", stateChanges: "韩立更加谨慎", hookActivity: "小瓶秘密悬置", mood: "紧张", chapterType: "主线" },
        { chapter: 12, title: "未来摘要", characters: "韩立", events: "韩立获得筑基丹", stateChanges: "突破", hookActivity: "", mood: "振奋", chapterType: "未来" },
      ],
    },
    resourceLedger: { resources: [] },
    knowledge: { events: [] },
    timeline: {
      entries: [
        { chapter: 10, storyTime: "春末", label: "小瓶初现", durationFromPrev: "一日", ordinal: 10 },
        { chapter: 11, storyTime: "春末翌日", label: "墨大夫试探", durationFromPrev: "一日", ordinal: 11 },
        { chapter: 12, storyTime: "未来", label: "筑基丹到手", durationFromPrev: "一日", ordinal: 12 },
      ],
    },
  };
}

describe("timeline channel", () => {
  it("returns recent chapter summaries, runtime timeline and previousChapterTail without future leakage", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create({ id: "sec-summary", bookId: "book-1", key: "chapter-summary", name: "章节摘要", description: "", icon: null, order: 1, enabled: true, showInSidebar: true, participatesInAi: true, defaultVisibility: "global", fieldsJson: [], builtinKind: "chapter-summary", sourceTemplate: null, createdAt: now, updatedAt: now });
      await entries.create({ id: "summary-8", bookId: "book-1", sectionId: "sec-summary", title: "第8章摘要", contentMd: "韩立初入药园。", summaryMd: "药园铺垫。", tags: [], aliases: [], customFields: { category: "chapter-summaries" }, relatedChapterNumbers: [8], relatedEntryIds: [], visibilityRule: { type: "global" }, participatesInAi: true, tokenBudget: null, priorityTier: "reference", importance: 40, summaryL0: "药园铺垫。", createdAt: now, updatedAt: now });
      await entries.create({ id: "summary-11", bookId: "book-1", sectionId: "sec-summary", title: "第11章摘要", contentMd: "墨大夫试探韩立，小瓶秘密继续悬置。", summaryMd: "墨大夫试探。", tags: ["小瓶"], aliases: [], customFields: { category: "chapter-summaries" }, relatedChapterNumbers: [11], relatedEntryIds: [], visibilityRule: { type: "global" }, participatesInAi: true, tokenBudget: null, priorityTier: "relevant", importance: 70, summaryL0: "墨大夫试探。", createdAt: now, updatedAt: now });
      await entries.create({ id: "summary-12", bookId: "book-1", sectionId: "sec-summary", title: "第12章摘要", contentMd: "韩立未来获得筑基丹。", summaryMd: "未来突破。", tags: [], aliases: [], customFields: { category: "chapter-summaries" }, relatedChapterNumbers: [12], relatedEntryIds: [], visibilityRule: { type: "global" }, participatesInAi: true, tokenBudget: null, priorityTier: "relevant", importance: 70, summaryL0: "未来突破。", createdAt: now, updatedAt: now });

      const result = await createTimelineChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        runtimeSnapshot: snapshot(),
        previousChapterTail: "墨大夫离开药园前，又看了一眼韩立手中的药篓。",
        sceneSpec,
        sceneText: "韩立在药园检查小瓶。",
        recentChapterCount: 3,
      });

      const text = result.cards.map((card) => `${card.title}\n${card.content}`).join("\n");
      expect(result.cards.some((card) => card.sourceId === "previous-chapter-tail")).toBe(true);
      expect(result.cards.some((card) => card.sourceId === "runtime-timeline")).toBe(true);
      expect(text).toContain("第11章");
      expect(text).toContain("墨大夫离开药园前");
      expect(text).toContain("墨大夫试探");
      expect(text).not.toContain("第12章摘要");
      expect(text).not.toContain("筑基丹到手");
      expect(text).not.toContain("未来突破");
      expect(result.warnings).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("returns skipped warning when no timeline data is available", async () => {
    const storage = await createStorage();
    try {
      const result = await createTimelineChannel().run({ storage, bookId: "book-1", currentChapter: 12 });

      expect(result.status).toBe("skipped");
      expect(result.cards).toEqual([]);
      expect(result.warnings?.[0]).toContain("timeline channel 为空");
    } finally {
      storage.close();
    }
  });
});
