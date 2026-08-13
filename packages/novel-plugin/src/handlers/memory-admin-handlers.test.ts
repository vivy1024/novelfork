import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNarrativeMemorySchema, insertNarrativeEvent, insertNarrativeFact, insertRetrievalLog, upsertNarrativeContextVector } from "../engine/narrative-memory/storage.js";
import type { NarrativeContextCard, NarrativeEvent, NarrativeFact, NarrativeRetrievalDiagnostics } from "../engine/narrative-memory/types.js";

let activeStorage: StorageDatabase | undefined;

vi.mock("@vivy1024/novelfork-core", () => ({
  getStorageDatabase: () => {
    if (!activeStorage) throw new Error("test storage not initialized");
    return activeStorage;
  },
}));

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-memory-admin-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`CREATE TABLE IF NOT EXISTS book (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书籍', 0, 0)`).run();
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-2', '另一本书', 0, 0)`).run();
  ensureNarrativeMemorySchema(storage);
  return storage;
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
    source: input.source ?? "manual",
    status: input.status ?? "pending",
    riskLevel: input.riskLevel ?? "low",
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

function diagnostics(): NarrativeRetrievalDiagnostics {
  return {
    totalMs: 10,
    totalEstimatedTokens: 128,
    channelStats: [],
    injectedTokensByChannel: {},
    droppedCardIds: [],
    degradedCards: [],
    warnings: ["facts channel tight"],
  };
}

function contextCard(): NarrativeContextCard {
  return {
    id: "card-1",
    bookId: "book-1",
    sourceType: "fact",
    sourceId: "fact-1",
    channel: "facts",
    title: "韩立状态",
    content: "韩立状态更谨慎。",
    brief: "韩立谨慎",
    tags: ["character_state"],
    entities: ["韩立"],
    priority: 8,
    importance: 0.8,
    accessCount: 0,
    reason: "fixture",
    estimatedTokens: 16,
  };
}

function seedMemory(storage: StorageDatabase): void {
  insertNarrativeFact(storage, fact({ id: "fact-1", subject: "韩立", predicate: "状态", object: "谨慎", sourceChapter: 12, evidenceText: "韩立没有轻信墨大夫。" }));
  insertNarrativeFact(storage, fact({ id: "fact-dup", subject: "韩立", predicate: "状态", object: "谨慎", sourceChapter: 13, evidenceText: "重复事实。" }));
  insertNarrativeFact(storage, fact({ id: "fact-2", bookId: "book-2", subject: "墨大夫", predicate: "状态", object: "怀疑" }));
  insertNarrativeEvent(storage, event({ id: "event-1", subject: "小瓶", predicate: "埋设伏笔", object: "催熟药草", eventType: "hook_planted", chapterNumber: 8, status: "pending", evidenceText: "小瓶第一次催熟药草。" }));
  insertNarrativeEvent(storage, event({ id: "event-applied", subject: "韩立", predicate: "状态", object: "谨慎", status: "applied", appliedAt: "2026-06-22T00:01:00.000Z" }));
  insertRetrievalLog(storage, { id: "log-1", bookId: "book-1", chapterNumber: 12, purpose: "audit", totalTokens: 128, diagnostics: diagnostics(), createdAt: "2026-06-22T00:02:00.000Z" });
  upsertNarrativeContextVector(storage, { cardId: "vec-1", bookId: "book-1", embeddingModelId: "test-embedding", embeddingDim: 2, vector: [0.1, 0.2], vectorUpdatedAt: "2026-06-22T00:03:00.000Z", sourceCard: contextCard() });
}

describe("memory admin handlers", () => {
  beforeEach(async () => {
    activeStorage = await createStorage();
    seedMemory(activeStorage);
  });

  afterEach(async () => {
    activeStorage?.close();
    activeStorage = undefined;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("lists memory entries with kind and book isolation", async () => {
    const { handleMemoryList } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryList({ bookId: "book-1", kind: "fact", limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "fact", id: "fact-1" })]));
    expect(result.data.entries).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "fact-2" })]));
  });

  it("applies limit globally when listing all kinds", async () => {
    const { handleMemoryList } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryList({ bookId: "book-1", limit: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(3);
    expect(result.data.page).toMatchObject({ limit: 3, returned: 3 });
  });

  it("reads a single memory entry by kind and id", async () => {
    const { handleMemoryReadEntry } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryReadEntry({ bookId: "book-1", kind: "event", id: "event-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entry).toMatchObject({ kind: "event", id: "event-1", subject: "小瓶" });
  });

  it("searches across facts, events, logs, and vector metadata", async () => {
    const { handleMemorySearch } = await import("./memory-admin-handlers.js");

    const result = await handleMemorySearch({ bookId: "book-1", query: "韩立", limit: 20 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "fact", id: "fact-1", matchedFields: expect.arrayContaining(["subject"]) }),
      expect.objectContaining({ kind: "event", id: "event-applied", matchedFields: expect.arrayContaining(["subject"]) }),
      expect.objectContaining({ kind: "vector", id: "vec-1" }),
    ]));
  });

  /**
   * 搜索真分页：offset 跳过前 N 条，page 元信息回带 limit/offset/returned。
   */
  it("paginates search results by offset without re-scanning the first page", async () => {
    const { handleMemorySearch } = await import("./memory-admin-handlers.js");

    const firstPage = await handleMemorySearch({ bookId: "book-1", query: "韩立", limit: 2 });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    const firstIds = (firstPage.data.entries as Array<{ id: string }>).map((entry) => entry.id);
    expect(firstPage.data.page).toMatchObject({ limit: 2, offset: 0 });

    const secondPage = await handleMemorySearch({ bookId: "book-1", query: "韩立", limit: 2, offset: 2 });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) return;
    const secondIds = (secondPage.data.entries as Array<{ id: string }>).map((entry) => entry.id);
    expect(secondPage.data.page).toMatchObject({ limit: 2, offset: 2 });
    // 两页不重叠。
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it("returns memory stats by kind and status", async () => {
    const { handleMemoryStats } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryStats({ bookId: "book-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stats).toMatchObject({ total: 6, byKind: { fact: 2, event: 2, log: 1, vector: 1 }, eventStatus: { pending: 1, applied: 1 } });
  });

  it("exports memory as json without full vectors", async () => {
    const { handleMemoryExport } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryExport({ bookId: "book-1", format: "json" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exportData).toMatchObject({ facts: expect.any(Array), events: expect.any(Array), retrievalLogs: expect.any(Array), contextVectors: expect.any(Array) });
    expect(result.data.exportData.contextVectors[0]).not.toHaveProperty("vector");
  });

  it("returns duplicate candidates without deleting them", async () => {
    const { handleMemoryDedup, handleMemoryList } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryDedup({ bookId: "book-1", kind: "fact" });
    const after = await handleMemoryList({ bookId: "book-1", kind: "fact" });

    expect(result.ok).toBe(true);
    if (!result.ok || !after.ok) return;
    expect(result.data.groups).toEqual([expect.objectContaining({ ids: ["fact-1", "fact-dup"] })]);
    expect(after.data.entries).toHaveLength(2);
  });

  it("updates fact and event entries while rejecting log/vector writes", async () => {
    const { handleMemoryUpdate, handleMemoryReadEntry } = await import("./memory-admin-handlers.js");

    const updated = await handleMemoryUpdate({ bookId: "book-1", kind: "fact", id: "fact-1", reason: "修正状态", patch: { object: "极其谨慎", confidence: 0.95 } });
    const blocked = await handleMemoryUpdate({ bookId: "book-1", kind: "log", id: "log-1", reason: "不允许", patch: { purpose: "audit" } });
    const reread = await handleMemoryReadEntry({ bookId: "book-1", kind: "fact", id: "fact-1" });

    expect(updated.ok).toBe(true);
    expect(blocked.ok).toBe(false);
    if (!reread.ok) return;
    expect(reread.data.entry).toMatchObject({ object: "极其谨慎", confidence: 0.95 });
  });

  it("rejects invalid updates and blocks direct event status mutation", async () => {
    const { handleMemoryUpdate, handleMemoryReadEntry } = await import("./memory-admin-handlers.js");

    const badLayer = await handleMemoryUpdate({ bookId: "book-1", kind: "fact", id: "fact-1", reason: "非法层级", patch: { layer: "bad-layer" } });
    const badConfidence = await handleMemoryUpdate({ bookId: "book-1", kind: "fact", id: "fact-1", reason: "非法置信度", patch: { confidence: 9 } });
    const directStatus = await handleMemoryUpdate({ bookId: "book-1", kind: "event", id: "event-1", reason: "不能绕过状态机", patch: { status: "applied" } });
    const reread = await handleMemoryReadEntry({ bookId: "book-1", kind: "event", id: "event-1" });

    expect(badLayer.ok).toBe(false);
    expect(badConfidence.ok).toBe(false);
    expect(directStatus.ok).toBe(false);
    if (!reread.ok) return;
    expect(reread.data.entry.status).toBe("pending");
  });

  it("deletes fact and event entries with a required reason", async () => {
    const { handleMemoryDelete, handleMemoryReadEntry } = await import("./memory-admin-handlers.js");

    const missingReason = await handleMemoryDelete({ bookId: "book-1", kind: "fact", id: "fact-1" });
    const deleted = await handleMemoryDelete({ bookId: "book-1", kind: "fact", id: "fact-1", reason: "重复清理" });
    const reread = await handleMemoryReadEntry({ bookId: "book-1", kind: "fact", id: "fact-1" });

    expect(missingReason.ok).toBe(false);
    expect(deleted.ok).toBe(true);
    expect(reread.ok).toBe(false);
  });

  it("bulk approves only pending events and writes facts", async () => {
    const { handleMemoryBulkApprove, handleMemoryList } = await import("./memory-admin-handlers.js");

    const result = await handleMemoryBulkApprove({ bookId: "book-1", eventIds: ["event-1", "event-applied"], reason: "确认伏笔" });
    const facts = await handleMemoryList({ bookId: "book-1", kind: "fact", query: "小瓶" });

    expect(result.ok).toBe(true);
    if (!result.ok || !facts.ok) return;
    expect(result.data.approved).toEqual([expect.objectContaining({ id: "event-1" })]);
    expect(result.data.skipped).toEqual([expect.objectContaining({ id: "event-applied" })]);
    expect(facts.data.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "fact", summary: expect.stringContaining("小瓶") })]));
  });

  it("requires explicit bulk approve targets and honors filter ids", async () => {
    const { handleMemoryBulkApprove } = await import("./memory-admin-handlers.js");

    const emptyFilter = await handleMemoryBulkApprove({ bookId: "book-1", reason: "过宽审批" });
    const byIds = await handleMemoryBulkApprove({ bookId: "book-1", filter: { ids: ["event-1"] }, reason: "确认指定事件" });

    expect(emptyFilter.ok).toBe(false);
    expect(byIds.ok).toBe(true);
    if (!byIds.ok) return;
    expect(byIds.data.approved).toEqual([expect.objectContaining({ id: "event-1" })]);
    expect(byIds.data.skipped).toHaveLength(0);
  });

  it("bulk deletes only explicitly filtered facts or events", async () => {
    const { handleMemoryBulkDelete, handleMemoryList } = await import("./memory-admin-handlers.js");

    const rejected = await handleMemoryBulkDelete({ bookId: "book-1", kind: "fact", reason: "缺过滤" });
    const invalidFilter = await handleMemoryBulkDelete({ bookId: "book-1", kind: "fact", filter: { status: "pending" }, reason: "无效过滤" });
    const wildcardOnly = await handleMemoryBulkDelete({ bookId: "book-1", kind: "fact", filter: { query: "%" }, reason: "通配符不应扩大范围" });
    const deleted = await handleMemoryBulkDelete({ bookId: "book-1", kind: "fact", filter: { category: "character_state" }, limit: 1, reason: "测试批删" });
    const after = await handleMemoryList({ bookId: "book-1", kind: "fact" });

    expect(rejected.ok).toBe(false);
    expect(invalidFilter.ok).toBe(false);
    expect(wildcardOnly.ok).toBe(true);
    if (wildcardOnly.ok) expect(wildcardOnly.data.deleted).toHaveLength(0);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok || !after.ok) return;
    expect(deleted.data.deleted).toHaveLength(1);
    expect(after.data.entries).toHaveLength(1);
  });
});
