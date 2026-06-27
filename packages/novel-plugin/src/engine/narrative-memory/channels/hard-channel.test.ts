import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { createHardChannel } from "./hard-channel.js";
import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-hard-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    jingweiMode: "dynamic",
    currentChapter: 12,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
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
  scenes: [{ characters: ["韩立"], location: "药园", conflict: "隐藏小瓶", mood: "紧张→克制", outcome: "守住秘密", hooks_used: [], hooks_planted: [] }],
  constraints: ["不得暴露小瓶能力"],
};

describe("hard channel", () => {
  it("returns canon jingwei, book rules and SceneSpec constraints as hard cards", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create({
        id: "sec-rules",
        bookId: "book-1",
        key: "rules",
        name: "硬规则",
        description: "",
        icon: null,
        order: 0,
        enabled: true,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "global",
        fieldsJson: [],
        builtinKind: "rules",
        sourceTemplate: null,
        createdAt: new Date("2026-06-22T00:00:00.000Z"),
        updatedAt: new Date("2026-06-22T00:00:00.000Z"),
      });
      await entries.create({
        id: "canon-rule",
        bookId: "book-1",
        sectionId: "sec-rules",
        title: "小瓶铁律",
        contentMd: "小瓶能力不能被外人发现。",
        summaryMd: "小瓶不可暴露。",
        tags: ["book_rules"],
        aliases: [],
        customFields: { category: "rules" },
        relatedChapterNumbers: [],
        relatedEntryIds: [],
        visibilityRule: { type: "global" },
        participatesInAi: true,
        tokenBudget: null,
        priorityTier: "core",
        layer: "canon",
        importance: 95,
        summaryL0: "小瓶不可暴露。",
        createdAt: new Date("2026-06-22T00:00:00.000Z"),
        updatedAt: new Date("2026-06-22T00:00:00.000Z"),
      });

      const result = await createHardChannel().run({
        storage,
        bookId: "book-1",
        sceneSpec,
        bookRulesText: "主角必须保持谨慎，不得突然圣母。",
        complianceRules: ["不得出现平台导流内容"],
      });

      expect(result.cards.every((card) => card.channel === "hard")).toBe(true);
      expect(result.cards.map((card) => card.title)).toEqual(expect.arrayContaining([
        "小瓶铁律",
        "第12章硬约束",
        "书籍硬规则",
        "平台/合规硬规则",
      ]));
      expect(result.warnings).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("returns warning when hard channel has no data", async () => {
    const storage = await createStorage();
    try {
      const result = await createHardChannel().run({ storage, bookId: "book-1" });

      expect(result.cards).toEqual([]);
      expect(result.warnings?.[0]).toContain("hard channel 为空");
    } finally {
      storage.close();
    }
  });
});
