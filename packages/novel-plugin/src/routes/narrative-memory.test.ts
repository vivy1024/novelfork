import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeMemoryRouter } from "./narrative-memory.js";
import { insertNarrativeEvent, insertNarrativeFact, insertRetrievalLog } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent, NarrativeFact, NarrativeRetrievalDiagnostics } from "../engine/narrative-memory/types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-memory-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

async function createBookRoot(bookId = "book-1"): Promise<string> {
  const dir = join(tmpdir(), `novelfork-narrative-memory-book-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), `${JSON.stringify({ id: bookId, title: "测试书籍" }, null, 2)}\n`, "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "subject" | "predicate" | "object">): NarrativeEvent {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    chapterNumber: input.chapterNumber ?? 12,
    eventType: input.eventType ?? "world_fact_introduced",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText ?? "证据文本",
    confidence: input.confidence ?? 0.8,
    source: input.source ?? "settle",
    status: input.status ?? "pending",
    riskLevel: input.riskLevel ?? "high",
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
    category: input.category ?? "relationship",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.8,
    sourceType: input.sourceType ?? "event",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter ?? 12,
    evidenceText: input.evidenceText ?? "事实证据",
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-22T00:00:00.000Z",
  };
}

describe("narrative memory observability router", () => {
  it("returns latest retrieval diagnostics and pending events", async () => {
    const storage = await createStorage();
    try {
      const diagnostics: NarrativeRetrievalDiagnostics = {
        totalMs: 12,
        totalEstimatedTokens: 88,
        channelStats: [{ channel: "semantic", status: "ok", latencyMs: 3, candidateCount: 2, returnedCount: 1, estimatedTokens: 20, metadata: { hitCount: 1 } }],
        injectedTokensByChannel: { semantic: 20 },
        droppedCardIds: ["drop-1"],
        degradedCards: [{ id: "card-1", from: "full", to: "brief" }],
        warnings: ["semantic channel found no hits"],
        wave: { logicDepth: 0.5, entropy: 0.5, activatedTags: ["tag:a"], rerankAlpha: 0.25, fallbackLevel: "L0" },
      };
      insertRetrievalLog(storage, { id: "log-1", bookId: "book-1", chapterNumber: 12, purpose: "write_chapter", totalTokens: 88, diagnostics, createdAt: "2026-06-22T00:00:00.000Z" });
      insertNarrativeEvent(storage, event({ id: "event-1", subject: "韩立", predicate: "发现", object: "小瓶秘密" }));

      const app = createNarrativeMemoryRouter({ storage });
      const diagResponse = await app.request("http://localhost/api/books/book-1/narrative-memory/diagnostics/latest");
      expect(diagResponse.status).toBe(200);
      const diagPayload = await diagResponse.json() as any;
      expect(diagPayload.log.diagnostics.wave.activatedTags).toEqual(["tag:a"]);
      expect(diagPayload.summary.channels[0]).toEqual(expect.objectContaining({ channel: "semantic", status: "ok" }));
      expect(diagPayload.summary.droppedCount).toBe(1);

      const pendingResponse = await app.request("http://localhost/api/books/book-1/narrative-memory/events/pending");
      expect(pendingResponse.status).toBe(200);
      const pendingPayload = await pendingResponse.json() as any;
      expect(pendingPayload.events.map((item: any) => item.id)).toEqual(["event-1"]);
      expect(pendingPayload.events[0]).toEqual(expect.objectContaining({
        eventType: "world_fact_introduced",
        entity: "韩立",
        confidence: 0.8,
        risk: "high",
        evidence: "证据文本",
        chapterNumber: 12,
      }));
    } finally {
      storage.close();
    }
  });

  it("exposes graph and admin reads from the same book-scoped memory source", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeFact(storage, fact({ id: "fact-rel", subject: "韩立", predicate: "敌对", object: "墨大夫" }));
      insertNarrativeFact(storage, fact({ id: "fact-other-book", bookId: "book-2", subject: "韩立", predicate: "状态", object: "隐忍" }));
      insertNarrativeEvent(storage, event({ id: "event-rel", eventType: "relationship_changed", subject: "韩立", predicate: "敌对", object: "墨大夫" }));

      const app = createNarrativeMemoryRouter({ storage });
      const graph = await app.request("http://localhost/api/books/book-1/narrative-memory/graph?view=relationship&focusEntity=%E9%9F%A9%E7%AB%8B&chapterFrom=1&chapterTo=20");
      expect(graph.status).toBe(200);
      expect(await graph.json()).toMatchObject({ facts: [expect.objectContaining({ id: "fact-rel" })], events: [expect.objectContaining({ id: "event-rel" })] });

      const stats = await app.request("http://localhost/api/books/book-1/narrative-memory/stats");
      expect(stats.status).toBe(200);
      expect(await stats.json()).toMatchObject({ stats: { byKind: { fact: 1, event: 1 }, pendingEvents: 1 } });

      const list = await app.request("http://localhost/api/books/book-1/narrative-memory/list?kind=fact&limit=10");
      expect(list.status).toBe(200);
      expect((await list.json()).entries).toEqual([expect.objectContaining({ kind: "fact", id: "fact-rel" })]);

      const search = await app.request("http://localhost/api/books/book-1/narrative-memory/search?q=%E9%9F%A9%E7%AB%8B&limit=10");
      expect(search.status).toBe(200);
      expect((await search.json()).entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "fact", id: "fact-rel" })]));

      const entry = await app.request("http://localhost/api/books/book-1/narrative-memory/entries/fact/fact-rel");
      expect(entry.status).toBe(200);
      expect(await entry.json()).toMatchObject({ entry: { kind: "fact", id: "fact-rel", subject: "韩立" } });

      const otherBook = await app.request("http://localhost/api/books/book-1/narrative-memory/search?q=%E9%9F%A9%E7%AB%8B&kind=fact&limit=10");
      expect((await otherBook.json()).entries).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "fact-other-book" })]));
    } finally {
      storage.close();
    }
  });

  it("loads/saves book config and exposes the collapsed current ledger", async () => {
    const storage = await createStorage();
    const bookRoot = await createBookRoot();
    try {
      insertNarrativeFact(storage, fact({
        id: "state-old",
        subject: "韩立",
        predicate: "境界",
        object: "炼气期",
        category: "character_state",
        sourceChapter: 1,
        validFromChapter: 1,
        validUntilChapter: 9,
      }));
      insertNarrativeFact(storage, fact({
        id: "state-current",
        subject: "韩立",
        predicate: "境界",
        object: "筑基期",
        category: "character_state",
        sourceChapter: 9,
        validFromChapter: 9,
      }));
      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });

      const defaults = await app.request("http://localhost/api/books/book-1/narrative-memory/config");
      expect(defaults.status).toBe(200);
      expect(await defaults.json()).toMatchObject({ config: { settlement: { enabled: true }, retrieval: { maxTokens: 8000, channels: { facts: true } } } });

      const saved = await app.request("http://localhost/api/books/book-1/narrative-memory/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ledger: { currentViewLimit: 12 }, retrieval: { channels: { facts: false } } } }),
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ config: { ledger: { currentViewLimit: 12 }, retrieval: { channels: { facts: false } } } });

      const current = await app.request("http://localhost/api/books/book-1/narrative-memory/current");
      expect(current.status).toBe(200);
      expect(await current.json()).toMatchObject({
        facts: [expect.objectContaining({ kind: "fact", id: "state-current", object: "筑基期" })],
        counts: { byCategory: { character_state: 1 } },
      });

      const facts = await app.request("http://localhost/api/books/book-1/narrative-memory/facts");
      expect(facts.status).toBe(200);
      expect(await facts.json()).toMatchObject({ facts: [expect.objectContaining({ id: "state-current", object: "筑基期" })] });

      const historical = await app.request("http://localhost/api/books/book-1/narrative-memory/current?asOfChapter=5");
      expect(historical.status).toBe(200);
      expect(await historical.json()).toMatchObject({ facts: [expect.objectContaining({ id: "state-old", object: "炼气期" })] });
    } finally {
      storage.close();
    }
  });

  it("approves and rejects pending events through book-scoped routes", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "event-approve", eventType: "character_state_changed", subject: "韩立", predicate: "状态", object: "更谨慎" }));
      insertNarrativeEvent(storage, event({ id: "event-reject", eventType: "character_state_changed", subject: "墨大夫", predicate: "状态", object: "怀疑" }));
      const app = createNarrativeMemoryRouter({ storage });

      const approved = await app.request("http://localhost/api/books/book-1/narrative-memory/events/event-approve/approve", { method: "POST", body: JSON.stringify({ reason: "确认正文" }), headers: { "content-type": "application/json" } });
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ event: { id: "event-approve", status: "applied" } });

      const rejected = await app.request("http://localhost/api/books/book-1/narrative-memory/events/pending/event-reject/reject", { method: "POST" });
      expect(rejected.status).toBe(200);
      expect(await rejected.json()).toMatchObject({ event: { id: "event-reject", status: "rejected" } });

      const pending = await app.request("http://localhost/api/books/book-1/narrative-memory/events/pending");
      expect((await pending.json()).events).toEqual([]);
      const facts = await app.request("http://localhost/api/books/book-1/narrative-memory/facts");
      expect((await facts.json()).facts).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "event-approve" })]));
    } finally {
      storage.close();
    }
  });

  /**
   * 待审队列批量操作：作者选中多条一起批准/丢弃。
   * 批量批准与单条批准走同一归约路径（manual 保护、重复跳过语义一致）。
   */
  it("bulk-approves and bulk-deletes pending events through the queue endpoint", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "bulk-a", eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", riskLevel: "low" }));
      insertNarrativeEvent(storage, event({ id: "bulk-b", eventType: "location_changed", subject: "韩立", predicate: "离开", object: "药园", riskLevel: "low" }));
      insertNarrativeEvent(storage, event({ id: "bulk-c", eventType: "timeline_advanced", subject: "时间线", predicate: "三日后", object: "韩立完成试探", riskLevel: "low" }));
      const app = createNarrativeMemoryRouter({ storage });

      const approved = await app.request("http://localhost/api/books/book-1/narrative-memory/events/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", eventIds: ["bulk-a", "bulk-b"], reason: "批量确认" }),
      });
      expect(approved.status).toBe(200);
      const approvedPayload = await approved.json() as any;
      expect(approvedPayload.approved).toEqual(["bulk-a", "bulk-b"]);
      expect(approvedPayload.failed).toEqual([]);
      // 批准后两条都写进事实。
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE book_id = 'book-1'").get()?.count).toBe(2);

      const deleted = await app.request("http://localhost/api/books/book-1/narrative-memory/events/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", eventIds: ["bulk-c"] }),
      });
      expect(deleted.status).toBe(200);
      const deletedPayload = await deleted.json() as any;
      expect(deletedPayload.deleted).toEqual(["bulk-c"]);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE id = 'bulk-c'").get()?.count).toBe(0);

      // 已批准的事件不能被批量删除（裁决历史保护）。
      const protect = await app.request("http://localhost/api/books/book-1/narrative-memory/events/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", eventIds: ["bulk-a"] }),
      });
      const protectPayload = await protect.json() as any;
      expect(protectPayload.deleted).toEqual([]);
      expect(protectPayload.skipped).toEqual(["bulk-a"]);
    } finally {
      storage.close();
    }
  });

  it("creates, corrects, retires facts and exposes entity/history reads", async () => {
    const storage = await createStorage();
    try {
      const app = createNarrativeMemoryRouter({ storage });

      const created = await app.request("http://localhost/api/books/book-1/narrative-memory/facts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "林渊", predicate: "修为", object: "筑基期", category: "character_state", validFromChapter: 10 }),
      });
      expect(created.status).toBe(200);
      const createdPayload = await created.json() as any;
      expect(createdPayload.fact).toEqual(expect.objectContaining({ subject: "林渊", predicate: "修为", object: "筑基期", sourceType: "manual" }));

      const corrected = await app.request(`http://localhost/api/books/book-1/narrative-memory/facts/${createdPayload.fact.id}/correct`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "林渊（更正）", predicate: "境界", object: "结丹期" }),
      });
      expect(corrected.status).toBe(200);
      const correctedPayload = await corrected.json() as any;
      expect(correctedPayload.fact).toEqual(expect.objectContaining({ subject: "林渊（更正）", predicate: "境界", object: "结丹期" }));
      expect(correctedPayload.superseded.object).toBe("筑基期");

      const byEntity = await app.request("http://localhost/api/books/book-1/narrative-memory/facts/by-entity?entity=%E6%9E%97%E6%B8%8A%EF%BC%88%E6%9B%B4%E6%AD%A3%EF%BC%89");
      expect(byEntity.status).toBe(200);
      const byEntityPayload = await byEntity.json() as any;
      expect(byEntityPayload.groups).toEqual([expect.objectContaining({ entity: "林渊（更正）", facts: [expect.objectContaining({ object: "结丹期" })] })]);

      const history = await app.request(`http://localhost/api/books/book-1/narrative-memory/facts/${correctedPayload.fact.id}/history`);
      expect(history.status).toBe(200);
      const historyPayload = await history.json() as any;
      expect(historyPayload.items.map((item: any) => item.object)).toEqual(["筑基期", "结丹期"]);

      const retired = await app.request(`http://localhost/api/books/book-1/narrative-memory/facts/${correctedPayload.fact.id}`, { method: "DELETE", body: JSON.stringify({}), headers: { "content-type": "application/json" } });
      expect(retired.status).toBe(200);

      const current = await app.request("http://localhost/api/books/book-1/narrative-memory/facts");
      expect((await current.json()).facts).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
