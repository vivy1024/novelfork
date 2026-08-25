import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import { ensureNarrativeMemorySchema } from "../../narrative-memory/storage.js";
import { buildChapterBriefing, computeNarrativeContractHitRate, computePromiseHitRate } from "./chapter-briefing.js";

const tempDirs: string[] = [];
const now = new Date("2026-08-25T00:00:00.000Z");

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-chapter-briefing-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 20,
    createdAt: now,
    updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-characters",
    bookId: "book-1",
    key: "characters",
    name: "角色",
    description: "",
    icon: null,
    order: 1,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: "characters",
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
  ensureNarrativeMemorySchema(storage);
  return storage;
}

async function createCharacter(storage: StorageDatabase, input: { id: string; title: string; aliases?: string[] }): Promise<void> {
  await createStoryJingweiEntryRepository(storage).create({
    id: input.id,
    bookId: "book-1",
    sectionId: "sec-characters",
    title: input.title,
    contentMd: "",
    summaryMd: "",
    tags: [],
    aliases: input.aliases ?? [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" },
    participatesInAi: true,
    tokenBudget: null,
    priorityTier: "core",
    layer: "canon",
    importance: 80,
    summaryL0: input.title,
    category: "characters",
    fields: { aliases: input.aliases ?? [] },
    createdAt: now,
    updatedAt: now,
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("chapter briefing", () => {
  it("输出 active 角色的登场告警、叙事契约命中率与揭示预算", async () => {
    const storage = await createStorage();
    try {
      await createCharacter(storage, { id: "char-han", title: "韩立（炼气期）", aliases: ["韩老魔"] });
      await createCharacter(storage, { id: "char-never", title: "未登场角色" });
      storage.sqlite.prepare(`
        INSERT INTO narrative_event (
          id, book_id, chapter_number, event_type, subject, predicate, object,
          evidence_text, confidence, source, status, risk_level, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("evt-han", "book-1", 10, "character_state_changed", "韩立（筑基期）", "出现", "药园", "韩立来到药园", 0.9, "settle", "applied", "low", now.toISOString());
      storage.sqlite.prepare(`
        INSERT INTO jingwei_causal_chains (
          id, book_id, trigger_chapter, trigger_event, status, urgency, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("chain-resolved", "book-1", 2, "谜底揭开", "resolved", "low", now.getTime());
      storage.sqlite.prepare(`
        INSERT INTO jingwei_causal_chains (
          id, book_id, trigger_chapter, trigger_event, status, urgency, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("chain-overdue", "book-1", 1, "旧债未回收", "open", "overdue", now.getTime());

      const briefing = await buildChapterBriefing("book-1", 20, {
        storage,
        bookConfig: { narrativeContract: { revealBudget: { level: 2, description: "只揭示表层动机" } } },
      });

      expect(briefing).toContain("【登场告警】");
      expect(briefing).toContain("韩立（炼气期） 已 10 章未出场");
      expect(briefing).not.toContain("未登场角色已");
      expect(briefing).toContain("【叙事契约命中率】粗略命中率 50%");
      expect(briefing).toContain("【本章揭示预算】当前允许揭示至第 2 层底牌（只揭示表层动机），勿越级揭底");
      expect(computeNarrativeContractHitRate(storage, "book-1", 20)).toBe(0.5);
    } finally {
      storage.close();
    }
  });

  it("没有已解决或超期数据时命中率返回 null", async () => {
    const storage = await createStorage();
    try {
      expect(computeNarrativeContractHitRate(storage, "book-1", 20)).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("纯函数按已解决与超期数量计算命中率", () => {
    expect(computePromiseHitRate(3, 1)).toBe(0.75);
    expect(computePromiseHitRate(0, 0)).toBeNull();
  });
});
