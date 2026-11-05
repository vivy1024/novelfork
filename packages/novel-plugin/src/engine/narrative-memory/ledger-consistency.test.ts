/**
 * 记忆删除与结算台账一致性。
 *
 * 事故复现：叙述者先结算若干章，再用 memory.bulk_delete 按章范围删掉事件。旧实现物理删除、不走事务、
 * 不改台账，结果台账仍把这些章记成「已结算」、引用的事件 id 已不存在，幂等门永远跳过、章节补不回记忆。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { upsertLedgerEntry } from "../../handlers/jingwei-ledger-store.js";
import { handleMemoryBulkDelete, handleMemoryDelete, handleMemoryStats } from "../../handlers/memory-admin-handlers.js";
import { settleConfirmedChapter } from "../../handlers/chapter-settlement-service.js";
import { reconcileSettlementLedger } from "./ledger-consistency.js";
import {
  chapterContentFingerprint,
  decideChapterSettlementIdempotency,
  readChapterSettlementRecord,
  recordChapterSettlement,
} from "./settlement-idempotency.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent, restoreTrashedNarrativeEvents } from "./storage.js";
import type { NarrativeEvent } from "./types.js";

const BOOK = "book-1";
let root: string;
let storage: StorageDatabase;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "novelfork-ledger-consistency-"));
  storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({
    id: BOOK,
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 10,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  // 经纬里有「韩立」，实体索引才会给事件建参与者行。
  upsertLedgerEntry(storage, { bookId: BOOK, category: "characters", title: "韩立", contentMd: "", fields: {} });
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function chapterContent(chapter: number): string {
  return `【地点】韩立抵达第${chapter}处洞府`;
}

/** 模拟 LLM 抽取：每章产出一条地点事件。 */
function extractor(chapter: number) {
  return async () => [{
    eventType: "location_changed",
    subject: "韩立",
    predicate: "抵达",
    object: `第${chapter}处洞府`,
    evidenceText: chapterContent(chapter),
    confidence: 0.88,
    source: "settle",
  }];
}

async function settle(chapter: number) {
  return settleConfirmedChapter(
    { bookId: BOOK, chapterNumber: chapter, content: chapterContent(chapter) },
    { storage, llmExtractor: extractor(chapter) },
  );
}

function count(sql: string, ...params: unknown[]): number {
  return storage.sqlite.prepare<{ count: number }>(sql).get(...params)?.count ?? 0;
}

function event(id: string, chapterNumber: number, status: NarrativeEvent["status"] = "applied"): NarrativeEvent {
  return {
    id,
    bookId: BOOK,
    chapterNumber,
    eventType: "timeline_advanced",
    subject: "韩立",
    predicate: "完成",
    object: `事件${id}`,
    evidenceText: `第${chapterNumber}章`,
    confidence: 0.9,
    source: "settle",
    status,
    riskLevel: "low",
    createdAt: "2026-06-22T00:00:00.000Z",
    ...(status === "applied" ? { appliedAt: "2026-06-22T00:00:00.000Z" } : {}),
  };
}

describe("事故复现：结算后按章范围批删事件", () => {
  it("批删后台账失效、事件进回收站、实体索引收敛，这几章可以重新结算", async () => {
    for (const chapter of [1, 2, 3, 4, 5]) {
      expect((await settle(chapter)).status).toBe("completed");
    }
    const deletedIds = [2, 3, 4].flatMap((chapter) => readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: chapter })!.eventIds);
    expect(deletedIds).toHaveLength(3);
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event_participant WHERE book_id = ? AND event_id IN (${deletedIds.map(() => "?").join(",")})`, BOOK, ...deletedIds)).toBeGreaterThan(0);

    const result = await handleMemoryBulkDelete({ bookId: BOOK, kind: "event", filter: { chapterRange: [2, 4] }, reason: "试写作废" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.deleted).toHaveLength(3);
    expect(result.data.cascade).toMatchObject({ trashed: true, ledgerStaleChapters: [2, 3, 4], entityIndexRefreshed: true });

    // 事件进了回收站，不再在活跃表里
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ? AND chapter_number BETWEEN 2 AND 4`, BOOK)).toBe(0);
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event_trash WHERE book_id = ? AND chapter_number BETWEEN 2 AND 4`, BOOK)).toBe(3);

    // 台账：被删章的事件 id 已剔除并标失效；未删章原样
    for (const chapter of [2, 3, 4]) {
      const record = readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: chapter })!;
      expect(record.eventIds).toEqual([]);
      expect(record.contentFingerprint.startsWith("stale:ledger-orphaned:")).toBe(true);
    }
    for (const chapter of [1, 5]) {
      const record = readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: chapter })!;
      expect(record.eventIds).toHaveLength(1);
      expect(record.contentFingerprint).toBe(chapterContentFingerprint(chapterContent(chapter)));
    }
    // 台账不再引用任何已不存在的事件
    const dangling = storage.sqlite.prepare<{ chapter: number; ids: string }>(
      `SELECT chapter_number AS chapter, event_ids_json AS ids FROM narrative_chapter_settlement WHERE book_id = ?`,
    ).all(BOOK).flatMap((row) => (JSON.parse(row.ids) as string[]).filter((id) => count(`SELECT COUNT(*) AS count FROM narrative_event WHERE id = ?`, id) === 0));
    expect(dangling).toEqual([]);

    // 实体索引不再挂着被删事件
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event_participant WHERE book_id = ? AND event_id IN (${deletedIds.map(() => "?").join(",")})`, BOOK, ...deletedIds)).toBe(0);

    // 幂等门放行重新结算
    const decision = decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 3, content: chapterContent(3) });
    expect(decision).toMatchObject({ decision: "resettle", reason: "ledger-orphaned" });
    const resettled = await settle(3);
    expect(resettled.status).toBe("completed");
    expect(resettled.idempotency).toMatchObject({ outcome: "resettled", reason: "ledger-orphaned", settlementCount: 2 });
    const after = readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: 3 })!;
    expect(after.contentFingerprint).toBe(chapterContentFingerprint(chapterContent(3)));
    expect(after.eventIds).toHaveLength(1);
    // 再结算一次就正常跳过
    expect((await settle(3)).status).toBe("skipped");
  });
});

describe("memory.delete / memory.bulk_delete", () => {
  it("单条删除只剔除该事件；该章还有存活事件时台账保持已结算", async () => {
    insertNarrativeEvent(storage, event("e-a", 7));
    insertNarrativeEvent(storage, event("e-b", 7));
    recordChapterSettlement(storage, { bookId: BOOK, chapterNumber: 7, contentFingerprint: chapterContentFingerprint("七"), eventIds: ["e-a", "e-b"], settledAt: "2026-06-22T00:00:00.000Z" });

    const result = await handleMemoryDelete({ bookId: BOOK, kind: "event", id: "e-a", reason: "抽错" });
    expect(result.ok).toBe(true);
    const record = readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: 7 })!;
    expect(record.eventIds).toEqual(["e-b"]);
    expect(record.contentFingerprint).toBe(chapterContentFingerprint("七"));
    expect(decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 7, content: "七" }).decision).toBe("skip");
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event_trash WHERE id = 'e-a'`)).toBe(1);

    // 回收站可撤销
    expect(restoreTrashedNarrativeEvents(storage, { bookId: BOOK, eventIds: ["e-a"] }).restored).toEqual(["e-a"]);
  });

  it("批量删除中途失败整体回滚：事件、回收站、台账都不变", async () => {
    insertNarrativeEvent(storage, event("e-1", 8));
    insertNarrativeEvent(storage, event("e-2", 8));
    recordChapterSettlement(storage, { bookId: BOOK, chapterNumber: 8, contentFingerprint: chapterContentFingerprint("八"), eventIds: ["e-1", "e-2"], settledAt: "2026-06-22T00:00:00.000Z" });
    storage.sqlite.exec(`
      CREATE TRIGGER test_block_e2 BEFORE DELETE ON narrative_event
      WHEN OLD.id = 'e-2' BEGIN SELECT RAISE(ABORT, 'blocked for test'); END;
    `);

    const result = await handleMemoryBulkDelete({ bookId: BOOK, kind: "event", filter: { ids: ["e-1", "e-2"] }, reason: "测试" });
    expect(result).toMatchObject({ ok: false, error: "delete-failed" });
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ?`, BOOK)).toBe(2);
    expect(count(`SELECT COUNT(*) AS count FROM narrative_event_trash WHERE book_id = ?`, BOOK)).toBe(0);
    expect(readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: 8 })!.eventIds).toEqual(["e-1", "e-2"]);
  });

  it("事实删除仍是物理删除，但在事务里并返回级联摘要", async () => {
    storage.sqlite.prepare(`
      INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type, source_chapter, created_at, updated_at)
      VALUES ('f-1', ?, '韩立', '位于', '药园', 'character_state', 'dynamic', 0.9, 'manual', 3, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z')
    `).run(BOOK);
    const result = await handleMemoryBulkDelete({ bookId: BOOK, kind: "fact", filter: { ids: ["f-1", "missing"] }, reason: "测试" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.deleted).toEqual([{ kind: "fact", id: "f-1" }]);
    expect(result.data.failed).toEqual([{ kind: "fact", id: "missing", error: "not-found" }]);
    expect(result.data.cascade).toMatchObject({ trashed: false, affectedChapters: [3] });
    expect(count(`SELECT COUNT(*) AS count FROM narrative_fact WHERE id = 'f-1'`)).toBe(0);
  });
});

describe("幂等门：ledger-orphaned", () => {
  const fingerprint = chapterContentFingerprint("正文");

  it("台账记了事件但活跃表与回收站都找不到 → 重新结算", () => {
    recordChapterSettlement(storage, { bookId: BOOK, chapterNumber: 4, contentFingerprint: fingerprint, eventIds: ["gone-1", "gone-2"], settledAt: "2026-06-22T00:00:00.000Z" });
    expect(decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 4, content: "正文" }))
      .toMatchObject({ decision: "resettle", reason: "ledger-orphaned", previousFingerprint: fingerprint });
  });

  it("事件只是被待确认队列丢进回收站 → 仍跳过", () => {
    insertNarrativeEvent(storage, event("p-1", 4, "pending"));
    recordChapterSettlement(storage, { bookId: BOOK, chapterNumber: 4, contentFingerprint: fingerprint, eventIds: ["p-1"], settledAt: "2026-06-22T00:00:00.000Z" });
    storage.sqlite.exec(`
      INSERT INTO narrative_event_trash SELECT id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text, confidence,
        source, status, risk_level, subject_entry_id, object_entry_id, caused_by_json, created_at, applied_at, '2099-01-01T00:00:00.000Z', '丢弃'
      FROM narrative_event WHERE id = 'p-1';
      DELETE FROM narrative_event WHERE id = 'p-1';
    `);
    expect(decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 4, content: "正文" }).decision).toBe("skip");
  });

  it("抽取为空的章（台账无事件）→ 仍跳过", () => {
    recordChapterSettlement(storage, { bookId: BOOK, chapterNumber: 4, contentFingerprint: fingerprint, eventIds: [], settledAt: "2026-06-22T00:00:00.000Z" });
    expect(decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 4, content: "正文" }).decision).toBe("skip");
  });
});

describe("整本台账对账", () => {
  function seedChapterRows(chapter: number, eventIds: readonly string[]) {
    recordChapterSettlement(storage, { bookId: BOOK, chapterNumber: chapter, contentFingerprint: chapterContentFingerprint(`第${chapter}章`), eventIds, settledAt: "2026-06-22T00:00:00.000Z" });
    storage.sqlite.prepare(`INSERT INTO narrative_settlement_artifact (book_id, chapter_number, content_fingerprint, artifact_json, created_at) VALUES (?, ?, 'fp', '{}', '2026-06-22')`).run(BOOK, chapter);
    storage.sqlite.prepare(`INSERT INTO narrative_chapter_mention (book_id, chapter_number, position, entity_name) VALUES (?, ?, 0, '韩立')`).run(BOOK, chapter);
    storage.sqlite.prepare(`INSERT INTO narrative_structure_score (id, book_id, chapter_number, feature_id, dimension, value, recorded_at) VALUES (?, ?, ?, 'f', 'd', 'v', 0)`).run(`ss-${chapter}`, BOOK, chapter);
    storage.sqlite.prepare(`INSERT INTO narrative_retrieval_log (id, book_id, chapter_number, purpose, total_tokens, diagnostics_json, created_at) VALUES (?, ?, ?, 'write', 1, '{}', '2026-06-22')`).run(`log-${chapter}`, BOOK, chapter);
  }

  function rowsForChapter(chapter: number): number {
    return ["narrative_chapter_settlement", "narrative_settlement_artifact", "narrative_chapter_mention", "narrative_structure_score", "narrative_retrieval_log"]
      .reduce((sum, table) => sum + count(`SELECT COUNT(*) AS count FROM ${table} WHERE book_id = ? AND chapter_number = ?`, BOOK, chapter), 0);
  }

  it("dryRun 只报告；应用后清掉缺章残留、把事件消失的台账标失效", async () => {
    insertNarrativeEvent(storage, event("live-1", 1));
    seedChapterRows(1, ["live-1"]);
    seedChapterRows(2, ["gone-2"]);
    seedChapterRows(3, ["gone-3"]);
    seedChapterRows(5, []);

    const report = await reconcileSettlementLedger(storage, { bookId: BOOK, existingChapters: [1, 2], dryRun: true });
    expect(report).toMatchObject({ applied: false, chapterListKnown: true, missingChapters: [3, 5], orphanedLedgerChapters: [2] });
    // 第 3 章是「最新一章的下一章」，检索日志保留（正在写的章）
    expect(report.removedRows.narrative_retrieval_log).toBe(1);
    expect(rowsForChapter(3)).toBe(5);
    expect(readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: 2 })!.contentFingerprint.startsWith("stale:")).toBe(false);

    const applied = await reconcileSettlementLedger(storage, { bookId: BOOK, existingChapters: [1, 2] });
    expect(applied).toMatchObject({ applied: true, missingChapters: [3, 5], orphanedLedgerChapters: [2], staleLedgerChapters: [2], entityIndexRebuilt: true });
    expect(rowsForChapter(3)).toBe(1); // 只剩检索日志
    expect(rowsForChapter(5)).toBe(0);
    expect(rowsForChapter(1)).toBe(5);
    expect(readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: 2 })!.contentFingerprint.startsWith("stale:ledger-orphaned:")).toBe(true);
    expect(decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 2, content: "第2章" }).decision).toBe("resettle");
    expect(decideChapterSettlementIdempotency(storage, { bookId: BOOK, chapterNumber: 1, content: "第1章" }).decision).toBe("skip");

    // 再跑一次没有改动
    expect((await reconcileSettlementLedger(storage, { bookId: BOOK, existingChapters: [1, 2] })).applied).toBe(false);
  });

  it("章节清单为空时不做缺章清理", async () => {
    seedChapterRows(4, []);
    const result = await reconcileSettlementLedger(storage, { bookId: BOOK, existingChapters: [] });
    expect(result).toMatchObject({ applied: false, chapterListKnown: false, missingChapters: [] });
    expect(rowsForChapter(4)).toBe(5);
  });

  it("memory.stats 带只读的台账健康度，不改库", async () => {
    seedChapterRows(2, ["gone-2"]);
    const stats = await handleMemoryStats({ bookId: BOOK });
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    expect(stats.data.stats.ledgerHealth).toMatchObject({ ok: false, chapterListKnown: false, orphanedLedgerChapters: [2] });
    expect(readChapterSettlementRecord(storage, { bookId: BOOK, chapterNumber: 2 })!.contentFingerprint.startsWith("stale:")).toBe(false);
  });
});
