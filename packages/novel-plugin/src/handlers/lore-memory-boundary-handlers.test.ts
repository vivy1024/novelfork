import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNarrativeMemorySchema, insertNarrativeEvent, insertNarrativeFact, listPendingNarrativeEvents, queryNarrativeFacts } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent, NarrativeFact } from "../engine/narrative-memory/types.js";

let activeStorage: StorageDatabase | undefined;

vi.mock("@vivy1024/novelfork-core", () => ({
  getStorageDatabase: () => {
    if (!activeStorage) throw new Error("test storage not initialized");
    return activeStorage;
  },
}));

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-lore-memory-handlers-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`CREATE TABLE IF NOT EXISTS book (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书籍', 0, 0)`).run();
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-2', '另一本书', 0, 0)`).run();
  ensureNarrativeMemorySchema(storage);
  return storage;
}

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "subject" | "predicate" | "object">): NarrativeEvent {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    chapterNumber: input.chapterNumber ?? 12,
    eventType: input.eventType ?? "character_state_changed",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText ?? "韩立决定继续隐忍。",
    confidence: input.confidence ?? 0.88,
    source: input.source ?? "settle",
    status: input.status ?? "pending",
    riskLevel: input.riskLevel ?? "low",
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

function fact(input: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object">): NarrativeFact {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    category: input.category ?? "character_state",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: input.sourceType ?? "event",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter,
    evidenceText: input.evidenceText,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-22T00:00:00.000Z",
  };
}

describe("lore-memory-boundary handlers", () => {
  beforeEach(async () => {
    activeStorage = await createStorage();
  });

  afterEach(async () => {
    activeStorage?.close();
    activeStorage = undefined;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("approves pending memory events by writing dynamic facts", async () => {
    const { handleMemoryEvents } = await import("./lore-memory-boundary-handlers.js");
    insertNarrativeEvent(activeStorage!, event({ id: "e-1", subject: "韩立", predicate: "状态", object: "更谨慎" }));

    const result = await handleMemoryEvents({ bookId: "book-1", action: "approve", eventId: "e-1", reason: "已确认正文发生" });

    expect(result.ok).toBe(true);
    expect(listPendingNarrativeEvents(activeStorage!, { bookId: "book-1" })).toEqual([]);
    const facts = queryNarrativeFacts(activeStorage!, { bookId: "book-1", entities: ["韩立"] });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ subject: "韩立", predicate: "状态", object: "更谨慎", layer: "dynamic", sourceId: "e-1" });
  });

  it("filters memory.graph events by view, focus entity, and chapter range", async () => {
    const { handleMemoryGraph } = await import("./lore-memory-boundary-handlers.js");
    insertNarrativeFact(activeStorage!, fact({ id: "f-1", subject: "韩立", predicate: "状态", object: "谨慎", sourceChapter: 12 }));
    insertNarrativeFact(activeStorage!, fact({ id: "f-rel", subject: "韩立", predicate: "敌对", object: "墨大夫", category: "relationship", sourceChapter: 12 }));
    insertNarrativeFact(activeStorage!, fact({ id: "f-2", subject: "墨大夫", predicate: "状态", object: "怀疑", sourceChapter: 30 }));
    insertNarrativeEvent(activeStorage!, event({ id: "e-rel", eventType: "relationship_changed", subject: "韩立", predicate: "敌对", object: "墨大夫", chapterNumber: 12 }));
    insertNarrativeEvent(activeStorage!, event({ id: "e-hook", eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "秘密", chapterNumber: 12 }));
    insertNarrativeEvent(activeStorage!, event({ id: "e-late", eventType: "relationship_changed", subject: "韩立", predicate: "结盟", object: "厉飞雨", chapterNumber: 30 }));

    const result = await handleMemoryGraph({ bookId: "book-1", view: "relationship", focusEntity: "韩立", chapterRange: [1, 20] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data.events as Array<{ id: string }>).map((item) => item.id)).toEqual(["e-rel"]);
    expect((result.data.facts as Array<{ id: string }>).map((item) => item.id)).toEqual(["f-rel"]);
  });

  it("does not reject pending events from another book", async () => {
    const { handleMemoryEvents } = await import("./lore-memory-boundary-handlers.js");
    insertNarrativeEvent(activeStorage!, event({ id: "e-book-2", bookId: "book-2", subject: "墨大夫", predicate: "状态", object: "怀疑" }));

    const result = await handleMemoryEvents({ bookId: "book-1", action: "reject", eventId: "e-book-2" });

    expect(result.ok).toBe(false);
    const stillPending = listPendingNarrativeEvents(activeStorage!, { bookId: "book-2" });
    expect(stillPending.map((item) => item.id)).toEqual(["e-book-2"]);
  });

  it("rejects dynamic narrative categories when writing Lore", async () => {
    const { handleLoreWrite } = await import("./lore-memory-boundary-handlers.js");

    const result = await handleLoreWrite({
      bookId: "book-1",
      action: "create",
      title: "第八章关系变化",
      contentMd: "韩立与墨大夫的敌对关系升级。",
      category: "relationships",
      layer: "dynamic",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("dynamic-memory-boundary");
    expect(result.summary).toContain("memory.events");
  });

  it("threads memoryContext into scene.spec fallback constraints", async () => {
    const previousApiKey = process.env.NOVELFORK_LLM_API_KEY;
    delete process.env.NOVELFORK_LLM_API_KEY;
    try {
      const { handleSceneSpec } = await import("./scene-spec-handler.js");

      const result = await handleSceneSpec({
        bookId: "book-1",
        chapterNumber: 9,
        userDirectives: "写韩立继续调查小瓶秘密",
        memoryContext: {
          sections: { facts: "韩立已经知道小瓶能催熟药草。" },
          diagnostics: { warnings: ["facts channel token budget tight"] },
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sceneSpec.constraints).toContain("Narrative Memory/facts：韩立已经知道小瓶能催熟药草。");
      expect(result.data.sceneSpec.constraints).toContain("召回警告：facts channel token budget tight");
    } finally {
      if (previousApiKey) process.env.NOVELFORK_LLM_API_KEY = previousApiKey;
      else delete process.env.NOVELFORK_LLM_API_KEY;
    }
  });

  it("creates pending memory events from explicit event payloads", async () => {
    const { handleMemoryEvents } = await import("./lore-memory-boundary-handlers.js");

    const result = await handleMemoryEvents({
      bookId: "book-1",
      action: "create",
      chapterNumber: 8,
      eventType: "hook_planted",
      subject: "小瓶",
      predicate: "埋设伏笔",
      object: "催熟药草",
      evidenceText: "小瓶第一次催熟药草。",
      confidence: 0.91,
    });

    expect(result.ok).toBe(true);
    const pending = listPendingNarrativeEvents(activeStorage!, { bookId: "book-1" });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ eventType: "hook_planted", subject: "小瓶", status: "pending", source: "manual" });
  });
});
