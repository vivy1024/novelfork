import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { upsertNarrativeFact } from "../facts.js";
import { ensureNarrativeMemorySchema } from "../storage.js";
import type { NarrativeFact } from "../types.js";
import { createStateChannel } from "./state-channel.js";
import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-state-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
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

const now = new Date("2026-06-22T00:00:00.000Z");
const sceneSpec: SceneSpec = {
  chapter: 12,
  title: "药园试探",
  wordTarget: 3000,
  scenes: [{ characters: ["韩立", "墨大夫"], location: "七玄门药园", conflict: "韩立隐藏小瓶", mood: "紧张→克制", outcome: "守住秘密", hooks_used: [], hooks_planted: [] }],
  constraints: [],
};

function fact(input: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object">): NarrativeFact {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    category: input.category ?? "state",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: input.sourceType ?? "manual",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter,
    evidenceText: input.evidenceText,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-22T00:00:00.000Z",
  };
}

function snapshot(): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "zh", lastAppliedChapter: 11, projectionVersion: 1, migrationWarnings: [] },
    currentState: {
      chapter: 11,
      facts: [
        { subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3, validUntilChapter: null, sourceChapter: 3 },
        { subject: "韩立", predicate: "获得", object: "筑基丹", validFromChapter: 12, validUntilChapter: null, sourceChapter: 12 },
        { subject: "韩立", predicate: "停留", object: "旧状态", validFromChapter: 1, validUntilChapter: 8, sourceChapter: 1 },
      ],
    },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
    resourceLedger: { resources: [] },
    knowledge: { events: [] },
    timeline: { entries: [] },
  };
}

describe("state channel", () => {
  it("returns dynamic jingwei, runtime current state and visible narrative facts sorted by entity relevance", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create({ id: "sec-people", bookId: "book-1", key: "people", name: "人物", description: "", icon: null, order: 1, enabled: true, showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "people", sourceTemplate: null, createdAt: now, updatedAt: now });
      await sections.create({ id: "sec-locations", bookId: "book-1", key: "locations", name: "地点", description: "", icon: null, order: 2, enabled: true, showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "locations", sourceTemplate: null, createdAt: now, updatedAt: now });
      await entries.create({ id: "hanli", bookId: "book-1", sectionId: "sec-people", title: "韩立", contentMd: "当前保持谨慎，重点隐藏小瓶。", summaryMd: "谨慎隐藏小瓶。", tags: ["主角"], aliases: ["韩老魔"], customFields: { category: "characters" }, relatedChapterNumbers: [3, 11], relatedEntryIds: [], visibilityRule: { type: "tracked", keywords: ["小瓶"] }, participatesInAi: true, tokenBudget: null, priorityTier: "relevant", importance: 80, summaryL0: "韩立谨慎。", createdAt: now, updatedAt: now });
      await entries.create({ id: "future-place", bookId: "book-1", sectionId: "sec-locations", title: "黄枫谷", contentMd: "韩立未来加入的宗门。", summaryMd: "未来宗门。", tags: [], aliases: [], customFields: { category: "locations" }, relatedChapterNumbers: [13], relatedEntryIds: [], visibilityRule: { type: "tracked", keywords: ["黄枫谷"] }, participatesInAi: true, tokenBudget: null, priorityTier: "relevant", importance: 70, summaryL0: "未来宗门。", createdAt: now, updatedAt: now });
      await entries.create({ id: "unrelated", bookId: "book-1", sectionId: "sec-people", title: "路人甲", contentMd: "暂不相关。", summaryMd: "路人。", tags: [], aliases: [], customFields: { category: "characters" }, relatedChapterNumbers: [1], relatedEntryIds: [], visibilityRule: { type: "tracked", keywords: ["路人甲"] }, participatesInAi: true, tokenBudget: null, priorityTier: "reference", importance: 20, summaryL0: "路人。", createdAt: now, updatedAt: now });
      upsertNarrativeFact(storage, fact({ id: "fact-visible", subject: "墨大夫", predicate: "怀疑", object: "韩立", validFromChapter: 10 }));
      upsertNarrativeFact(storage, fact({ id: "fact-future", subject: "韩立", predicate: "获得", object: "筑基丹", validFromChapter: 12 }));

      const result = await createStateChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        sceneSpec,
        sceneText: "韩立在七玄门药园检查小瓶，墨大夫暗中试探。",
        entities: ["小瓶"],
        runtimeSnapshot: snapshot(),
      });

      const text = result.cards.map((card) => `${card.title}\n${card.content}`).join("\n");
      expect(result.cards[0]?.title).toBe("韩立");
      expect(result.cards.some((card) => card.sourceType === "runtime-state" && card.channel === "state")).toBe(true);
      expect(result.cards.some((card) => card.sourceType === "fact" && card.channel === "state")).toBe(true);
      expect(text).toContain("墨大夫 怀疑 韩立");
      expect(text).not.toContain("筑基丹");
      expect(text).not.toContain("黄枫谷");
      expect(text).not.toContain("旧状态");
    } finally {
      storage.close();
    }
  });

  it("returns warning and skipped status when state channel has no candidates", async () => {
    const storage = await createStorage();
    try {
      const result = await createStateChannel().run({ storage, bookId: "book-1", currentChapter: 12 });

      expect(result.status).toBe("skipped");
      expect(result.cards).toEqual([]);
      expect(result.warnings?.[0]).toContain("state channel 为空");
    } finally {
      storage.close();
    }
  });
});
