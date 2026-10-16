/**
 * T-29 叙述者 agent 抽取：agent 来源草案的风险分流。
 *
 * 用户决定（10-12）是 agent 抽取 + 自动审批、尽量自动化、高风险必须确认。
 * 分流规则复用既有的 classifyNarrativeEventRisk：
 * - 低风险 agent 草案自动生效：与章后结算同一条路——归约器写 fact 并把事件落 applied，
 *   而不是只把 status 写成 applied 却留下没有 fact 的悬空事件。
 * - 高风险 agent 草案进待确认：只入库为 pending，不写 fact，等作者批准。
 * - manual 来源的既有语义不变：作者手动创建的一律 pending，不因本次改动被自动应用。
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema, queryNarrativeFacts } from "../engine/narrative-memory/storage.js";
import { handleMemoryEvents } from "./lore-memory-boundary-handlers.js";

let root: string;
let storage: StorageDatabase;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "novelfork-t29-agent-drafts-"));
  await mkdir(root, { recursive: true });
  storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  storage.sqlite.exec(`CREATE TABLE IF NOT EXISTS book (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书籍', 0, 0)`).run();
  ensureNarrativeMemorySchema(storage);
});

afterEach(async () => {
  // 共享存储必须显式关闭，否则 Windows 上 sqlite 仍持有句柄，rm 会报 EBUSY。
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true });
});

describe("T-29 agent 来源草案的风险分流", () => {
  it("低风险 agent 草案自动生效：事件落 applied，并真的写进了 narrative_fact", async () => {
    const result = await handleMemoryEvents({
      bookId: "book-1",
      action: "create",
      source: "agent",
      chapterNumber: 1,
      eventType: "location_changed",
      subject: "林舟",
      predicate: "抵达",
      object: "山门",
      evidenceText: "林舟抵达山门。",
      confidence: 0.9,
    }, storage);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.data.event as { id: string; status: string; source: string };
    expect(event.source).toBe("agent");
    expect(event.status).toBe("applied");

    // 关键：不能只是 status=applied 而 facts 里没有对应记录（悬空事件）。
    const facts = queryNarrativeFacts(storage, { bookId: "book-1", limit: 0 });
    expect(facts.some((fact) => fact.sourceId === event.id)).toBe(true);
  });

  it("高风险 agent 草案进待确认：只入库 pending，不写 fact", async () => {
    const result = await handleMemoryEvents({
      bookId: "book-1",
      action: "create",
      source: "agent",
      chapterNumber: 1,
      eventType: "world_fact_introduced",
      subject: "山门",
      predicate: "规则",
      object: "外人入山者死",
      evidenceText: "守门人说外人入山者死。",
      confidence: 0.9,
    }, storage);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.data.event as { id: string; status: string; riskLevel: string };
    expect(event.status).toBe("pending");
    expect(event.riskLevel).toBe("high");
    expect(queryNarrativeFacts(storage, { bookId: "book-1", limit: 0 })).toHaveLength(0);
  });

  it("manual 来源语义不变：作者手建的仍是 pending，不会被自动应用", async () => {
    const result = await handleMemoryEvents({
      bookId: "book-1",
      action: "create",
      chapterNumber: 1,
      eventType: "location_changed",
      subject: "林舟",
      predicate: "抵达",
      object: "山门",
      evidenceText: "林舟抵达山门。",
      confidence: 0.9,
    }, storage);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.data.event as { status: string; source: string };
    expect(event.source).toBe("manual");
    expect(event.status).toBe("pending");
    expect(queryNarrativeFacts(storage, { bookId: "book-1", limit: 0 })).toHaveLength(0);
  });

  it("同一事件重复提交（改写后重新抽取）不抛数据库异常：复用已有记录，作者的裁决不被翻回", async () => {
    const draft = {
      bookId: "book-1",
      action: "create" as const,
      source: "agent" as const,
      chapterNumber: 1,
      eventType: "world_fact_introduced" as const,
      subject: "山门",
      predicate: "规则",
      object: "外人入山者死",
      evidenceText: "守门人说外人入山者死。",
      confidence: 0.9,
    };
    const first = await handleMemoryEvents(draft, storage);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const eventId = (first.data.event as { id: string }).id;

    // 作者驳回了这条高风险草案。
    const rejected = await handleMemoryEvents({ bookId: "book-1", action: "reject", eventId }, storage);
    expect(rejected.ok).toBe(true);

    // 叙述者改写本章后重新抽取，又提交了同一事件：不能抛 UNIQUE 异常，也不能把驳回翻回 pending。
    const again = await handleMemoryEvents(draft, storage);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect((again.data.event as { id: string; status: string }).status).toBe("rejected");
    const rows = storage.sqlite.prepare("SELECT COUNT(*) AS n FROM narrative_event WHERE id = ?").get(eventId) as { n: number };
    expect(rows.n).toBe(1);

    // 同一批里重复两次也一样：只落一条。
    const batch = await handleMemoryEvents({
      bookId: "book-1",
      action: "create",
      source: "agent",
      events: [
        { chapterNumber: 2, eventType: "location_changed", subject: "林舟", predicate: "抵达", object: "后山", evidenceText: "林舟抵达后山。", confidence: 0.9 },
        { chapterNumber: 2, eventType: "location_changed", subject: "林舟", predicate: "抵达", object: "后山", evidenceText: "林舟抵达后山。", confidence: 0.9 },
      ],
    }, storage);
    expect(batch.ok).toBe(true);
    const chapter2 = storage.sqlite.prepare("SELECT COUNT(*) AS n FROM narrative_event WHERE book_id = 'book-1' AND chapter_number = 2").get() as { n: number };
    expect(chapter2.n).toBe(1);
  });
});
