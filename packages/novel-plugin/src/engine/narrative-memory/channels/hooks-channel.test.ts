import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { createHooksChannel } from "./hooks-channel.js";
import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";

const tempDirs: string[] = [];
const now = new Date("2026-06-22T00:00:00.000Z");

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-hooks-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    jingweiMode: "dynamic",
    currentChapter: 20,
    createdAt: now,
    updatedAt: now,
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const sceneSpec: SceneSpec = {
  chapter: 20,
  title: "药园旧谜",
  wordTarget: 3000,
  scenes: [{ characters: ["韩立"], location: "七玄门药园", conflict: "小瓶秘密再起波澜", mood: "平静→紧张", outcome: "旧伏笔被重新触发", hooks_used: ["小瓶异动"], hooks_planted: [] }],
  constraints: [],
};

function snapshot(): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "zh", lastAppliedChapter: 19, projectionVersion: 1, migrationWarnings: [] },
    currentState: { chapter: 19, facts: [] },
    hooks: {
      hooks: [
        { hookId: "stale-hook", startChapter: 3, type: "item_secret", status: "open", lastAdvancedChapter: 4, expectedPayoff: "小瓶异动", payoffTiming: "slow-burn", notes: "小瓶长期未被解释" },
        { hookId: "active-hook", startChapter: 18, type: "threat", status: "progressing", lastAdvancedChapter: 19, expectedPayoff: "墨大夫逼问", payoffTiming: "near-term", notes: "与韩立本章冲突相关" },
        { hookId: "resolved-hook", startChapter: 1, type: "minor", status: "resolved", lastAdvancedChapter: 5, expectedPayoff: "旧包袱", notes: "已解决，不应优先" },
        { hookId: "future-hook", startChapter: 20, type: "future", status: "open", lastAdvancedChapter: 20, expectedPayoff: "未来伏笔", notes: "当前章不应注入" },
      ],
    },
    chapterSummaries: { rows: [] },
    resourceLedger: { resources: [] },
    knowledge: { events: [] },
    timeline: { entries: [] },
  };
}

describe("hooks channel", () => {
  it("combines runtime hooks, pending hooks and foreshadowing entries with stale active hooks boosted", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create({ id: "sec-hooks", bookId: "book-1", key: "foreshadowing", name: "伏笔", description: "", icon: null, order: 1, enabled: true, showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "foreshadowing", sourceTemplate: null, createdAt: now, updatedAt: now });
      await entries.create({ id: "jingwei-hook", bookId: "book-1", sectionId: "sec-hooks", title: "小瓶旧谜", contentMd: "小瓶异动曾在第3章出现，尚未解释。", summaryMd: "小瓶旧谜未解。", tags: ["小瓶"], aliases: [], customFields: { category: "foreshadowing" }, relatedChapterNumbers: [3, 19], relatedEntryIds: [], visibilityRule: { type: "tracked", keywords: ["小瓶"] }, participatesInAi: true, tokenBudget: null, priorityTier: "relevant", importance: 80, summaryL0: "小瓶旧谜未解。", createdAt: now, updatedAt: now });

      const result = await createHooksChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 20,
        runtimeSnapshot: snapshot(),
        pendingHooks: ["墨大夫对小瓶产生新怀疑"],
        sceneSpec,
        sceneText: "韩立在药园察觉小瓶异动，墨大夫逼问。",
        entities: ["韩立", "小瓶"],
      });

      const ids = result.cards.map((card) => card.sourceId);
      const text = result.cards.map((card) => `${card.title}\n${card.content}`).join("\n");
      expect(ids[0]).toBe("stale-hook");
      expect(ids).toContain("active-hook");
      expect(ids).toContain("pending-hook:0");
      expect(ids).toContain("jingwei-hook");
      expect(text).not.toContain("future-hook");
      expect(text).not.toContain("未来伏笔");
      expect(ids.indexOf("resolved-hook")).toBeGreaterThan(ids.indexOf("active-hook"));
      expect(result.cards[0]?.reason).toContain("长期未推进");
    } finally {
      storage.close();
    }
  });

  it("returns skipped warning when no hooks are available", async () => {
    const storage = await createStorage();
    try {
      const result = await createHooksChannel().run({ storage, bookId: "book-1", currentChapter: 20 });

      expect(result.status).toBe("skipped");
      expect(result.cards).toEqual([]);
      expect(result.warnings?.[0]).toContain("hooks channel 为空");
    } finally {
      storage.close();
    }
  });
});
