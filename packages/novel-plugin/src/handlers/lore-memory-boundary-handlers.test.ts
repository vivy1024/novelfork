import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNarrativeMemorySchema, insertNarrativeEvent, insertNarrativeFact, listPendingNarrativeEvents, queryNarrativeFacts } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent, NarrativeFact } from "../engine/narrative-memory/types.js";

let activeStorage: StorageDatabase | undefined;

// 本文件只依赖 getStorageDatabase。残缺 mock 可能污染同进程后续文件，
// 验证时请单独跑本文件，或与 pipeline 分进程执行。
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

async function createBookRoot(narrativeMemory: Record<string, unknown>): Promise<string> {
  const dir = join(tmpdir(), `novelfork-lore-memory-book-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), `${JSON.stringify({ id: "book-1", title: "测试书籍", narrativeMemory }, null, 2)}\n`, "utf8");
  return dir;
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

  it("approves pending memory events by writing dynamic facts and closing the superseded state", async () => {
    const { handleMemoryEvents } = await import("./lore-memory-boundary-handlers.js");
    insertNarrativeFact(activeStorage!, fact({
      id: "old-state",
      subject: "韩立",
      predicate: "状态",
      object: "犹豫",
      validFromChapter: 1,
    }));
    insertNarrativeEvent(activeStorage!, event({ id: "e-1", subject: "韩立", predicate: "状态", object: "更谨慎" }));

    const result = await handleMemoryEvents({ bookId: "book-1", action: "approve", eventId: "e-1", reason: "已确认正文发生" });

    expect(result.ok).toBe(true);
    expect(listPendingNarrativeEvents(activeStorage!, { bookId: "book-1" })).toEqual([]);
    const facts = queryNarrativeFacts(activeStorage!, { bookId: "book-1", entities: ["韩立"] });
    expect(facts).toHaveLength(2);
    expect(facts.find((item) => item.id === "old-state")).toMatchObject({ validUntilChapter: 12 });
    expect(facts.find((item) => item.sourceId === "e-1")).toMatchObject({ subject: "韩立", predicate: "状态", object: "更谨慎", layer: "dynamic", sourceId: "e-1" });
  });

  it("honors the book lifecycle setting when an author approves an event", async () => {
    const { handleMemoryEvents } = await import("./lore-memory-boundary-handlers.js");
    const bookRoot = await createBookRoot({ ledger: { closeSupersededFacts: false } });
    insertNarrativeFact(activeStorage!, fact({
      id: "retained-state",
      subject: "韩立",
      predicate: "状态",
      object: "犹豫",
      validFromChapter: 1,
    }));
    insertNarrativeEvent(activeStorage!, event({ id: "e-retained", subject: "韩立", predicate: "状态", object: "坚定" }));

    const result = await handleMemoryEvents({ bookId: "book-1", action: "approve", eventId: "e-retained", bookRoot });

    expect(result.ok).toBe(true);
    const retained = queryNarrativeFacts(activeStorage!, { bookId: "book-1", entities: ["韩立"] }).find((item) => item.id === "retained-state");
    expect(retained?.validUntilChapter).toBeUndefined();
  });

  it("applies trusted book retrieval settings in memory.read", async () => {
    const { handleMemoryRead } = await import("./lore-memory-boundary-handlers.js");
    const bookRoot = await createBookRoot({
      retrieval: {
        maxTokens: 500,
        channels: { state: false, timeline: false, hooks: false, facts: false, style: false, semantic: false },
      },
    });
    insertNarrativeFact(activeStorage!, fact({ id: "hidden-fact", subject: "韩立", predicate: "状态", object: "谨慎", validFromChapter: 1 }));

    const result = await handleMemoryRead({
      bookId: "book-1",
      purpose: "write",
      chapterNumber: 12,
      entities: ["韩立"],
      bookRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diagnostics = result.data.diagnostics as { channelStats: Array<{ channel: string; status: string }> };
    expect(diagnostics.channelStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "state", status: "skipped" }),
      expect.objectContaining({ channel: "facts", status: "skipped" }),
    ]));
    expect((result.data.cards as Array<{ sourceId: string }>).some((card) => card.sourceId === "hidden-fact")).toBe(false);
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
    expect(result.summary).toMatch(/Narrative Memory|memory\.events/);
  });

  it("rejects chapter-dynamic content even without dynamic category labels", async () => {
    const { handleLoreWrite } = await import("./lore-memory-boundary-handlers.js");

    const result = await handleLoreWrite({
      bookId: "book-1",
      action: "create",
      title: "第12章状态变化",
      contentMd: "本章结算：韩立决定继续隐忍。",
      category: "characters",
      layer: "dynamic",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("dynamic-memory-boundary");
  });

  it("scene.spec 只校验 Agent 提交的蓝图，不做内部推断", async () => {
    const { handleSceneSpec } = await import("./scene-spec-handler.js");

    // 未提交蓝图：必须明确拒绝，而不是用 memoryContext 兜底生成。
    const missing = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 9,
      userDirectives: "写韩立继续调查小瓶秘密",
      memoryContext: {
        sections: { facts: "韩立已经知道小瓶能催熟药草。" },
        diagnostics: { warnings: ["facts channel token budget tight"] },
      },
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error).toBe("scene-spec-required");

    // 提交的蓝图原样通过校验，工具不注入也不改写 constraints。
    const submitted = await handleSceneSpec({
      bookId: "book-1",
      chapterNumber: 9,
      userDirectives: "写韩立继续调查小瓶秘密",
      sceneSpec: {
        chapter: 9,
        title: "小瓶秘密",
        wordTarget: 3000,
        scenes: [{
          characters: ["韩立"],
          location: "密室",
          conflict: "调查小瓶秘密",
          mood: "专注",
          outcome: "发现新线索",
          hooks_used: [],
          hooks_planted: [],
        }],
        constraints: ["Narrative Memory/facts：韩立已经知道小瓶能催熟药草。"],
      },
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.data.sceneSpec.constraints).toContain("Narrative Memory/facts：韩立已经知道小瓶能催熟药草。");
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
