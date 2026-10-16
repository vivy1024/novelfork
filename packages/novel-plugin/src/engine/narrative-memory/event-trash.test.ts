/**
 * 待确认队列「批量丢弃」的回收站（T-28）。
 *
 * 丢弃旧实现是对 narrative_event 的物理 DELETE，一次误点就找不回；单条「驳回」
 * 却会留裁决记录，两者语义分叉。现在丢弃改成搬进独立表 narrative_event_trash：
 * 主表读取点的语义与今天的物理删除完全一致（零改动风险），恢复就是搬回去。
 *
 * 这里只测存储层契约：搬表后事件必须能被逐列还原、只允许 pending、恢复遇到 id
 * 冲突要跳过并如实报告、超过保留期的行在下次写入时被清掉。
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  NARRATIVE_EVENT_TRASH_RETENTION_DAYS,
  ensureNarrativeMemorySchema,
  getNarrativeEventById,
  insertNarrativeEvent,
  listTrashedNarrativeEvents,
  pruneNarrativeEventTrash,
  restoreTrashedNarrativeEvents,
  trashPendingNarrativeEvents,
  updateNarrativeEventStatus,
} from "./storage.js";
import { ARCHIVE_TABLES, NOT_ARCHIVED_TABLES } from "../book-archive/registry.js";
import type { NarrativeEvent } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-event-trash-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
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
    subjectEntryId: input.subjectEntryId,
    objectEntryId: input.objectEntryId,
    ...(input.causedBy ? { causedBy: input.causedBy } : {}),
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

/** 保留期在 schema 里落成一行 DDL 常量，这里确保它真的是 30 天。 */
describe("NARRATIVE_EVENT_TRASH_RETENTION_DAYS", () => {
  it("is thirty days", () => {
    expect(NARRATIVE_EVENT_TRASH_RETENTION_DAYS).toBe(30);
  });
});

describe("trashPendingNarrativeEvents", () => {
  it("moves a pending event into the trash and out of narrative_event", async () => {
    const storage = await createStorage();
    try {
      const original = event({
        id: "e-1",
        subject: "韩立",
        predicate: "抵达",
        object: "药园",
        subjectEntryId: "ent:book-1:hanli",
        objectEntryId: "ent:book-1:yaoyuan",
        causedBy: ["e-0"],
        riskLevel: "medium",
        confidence: 0.42,
        chapterNumber: 8,
      });
      insertNarrativeEvent(storage, original);

      const result = trashPendingNarrativeEvents(storage, {
        bookId: "book-1",
        eventIds: ["e-1"],
        reason: "工作台批量丢弃",
        now: "2026-07-01T00:00:00.000Z",
      });

      expect(result.trashed).toEqual(["e-1"]);
      expect(result.skipped).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE id = 'e-1'").get()?.count).toBe(0);

      const trashed = listTrashedNarrativeEvents(storage, { bookId: "book-1" });
      expect(trashed).toHaveLength(1);
      // 逐列还原：回收站里就是同一行事件，不是摘要。
      expect(trashed[0]!.event).toEqual(original);
      expect(trashed[0]!.deletedAt).toBe("2026-07-01T00:00:00.000Z");
      expect(trashed[0]!.deletedReason).toBe("工作台批量丢弃");
    } finally {
      storage.close();
    }
  });

  it("refuses to touch applied or rejected events and reports them as skipped", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "applied-1", subject: "甲", predicate: "p", object: "o", status: "applied" }));
      insertNarrativeEvent(storage, event({ id: "rejected-1", subject: "乙", predicate: "p", object: "o", status: "rejected" }));
      insertNarrativeEvent(storage, event({ id: "pending-1", subject: "丙", predicate: "p", object: "o" }));

      const result = trashPendingNarrativeEvents(storage, {
        bookId: "book-1",
        eventIds: ["applied-1", "rejected-1", "pending-1", "missing-1"],
        reason: "工作台批量丢弃",
        now: "2026-07-01T00:00:00.000Z",
      });

      expect(result.trashed).toEqual(["pending-1"]);
      expect(result.skipped).toEqual(["applied-1", "rejected-1"]);
      expect(result.failed).toEqual([{ id: "missing-1", error: "not-found" }]);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = 'book-1'").get()?.count).toBe(2);
    } finally {
      storage.close();
    }
  });

  it("keeps each book's trash separate", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "b1-e", bookId: "book-1", subject: "甲", predicate: "p", object: "o" }));
      insertNarrativeEvent(storage, event({ id: "b2-e", bookId: "book-2", subject: "乙", predicate: "p", object: "o" }));

      trashPendingNarrativeEvents(storage, {
        bookId: "book-2",
        eventIds: ["b1-e", "b2-e"],
        reason: "工作台批量丢弃",
        now: "2026-07-01T00:00:00.000Z",
      });

      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" })).toEqual([]);
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-2" }).map((entry) => entry.event.id)).toEqual(["b2-e"]);
      // 跨书 id 不能被丢弃：另一本书的待审行必须还在。
      expect(getNarrativeEventById(storage, "book-1", "b1-e")).toBeDefined();
    } finally {
      storage.close();
    }
  });

  it("lists the newest deletions first and honours the limit", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "old", subject: "甲", predicate: "p", object: "o" }));
      insertNarrativeEvent(storage, event({ id: "new", subject: "乙", predicate: "p", object: "o" }));
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["old"], reason: "丢弃", now: "2026-07-01T00:00:00.000Z" });
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["new"], reason: "丢弃", now: "2026-07-02T00:00:00.000Z" });

      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" }).map((entry) => entry.event.id)).toEqual(["new", "old"]);
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1", limit: 1 }).map((entry) => entry.event.id)).toEqual(["new"]);
    } finally {
      storage.close();
    }
  });
});

describe("restoreTrashedNarrativeEvents", () => {
  it("moves the row back into narrative_event and clears it from the trash", async () => {
    const storage = await createStorage();
    try {
      const original = event({ id: "e-1", subject: "韩立", predicate: "抵达", object: "药园", subjectEntryId: "ent:book-1:hanli" });
      insertNarrativeEvent(storage, original);
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["e-1"], reason: "工作台批量丢弃", now: "2026-07-01T00:00:00.000Z" });

      const restored = restoreTrashedNarrativeEvents(storage, { bookId: "book-1", eventIds: ["e-1"] });

      expect(restored.restored).toEqual(["e-1"]);
      expect(restored.skipped).toEqual([]);
      expect(restored.missing).toEqual([]);
      expect(getNarrativeEventById(storage, "book-1", "e-1")).toEqual(original);
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" })).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("skips ids that already exist again instead of overwriting the live row", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "e-1", subject: "韩立", predicate: "抵达", object: "药园" }));
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["e-1"], reason: "丢弃", now: "2026-07-01T00:00:00.000Z" });
      // 丢弃后重新结算出同 id 的一行：恢复不能覆盖它。
      insertNarrativeEvent(storage, event({ id: "e-1", subject: "韩立", predicate: "抵达", object: "新药园" }));

      const restored = restoreTrashedNarrativeEvents(storage, { bookId: "book-1", eventIds: ["e-1"] });

      expect(restored.restored).toEqual([]);
      expect(restored.skipped).toEqual(["e-1"]);
      expect(getNarrativeEventById(storage, "book-1", "e-1")?.object).toBe("新药园");
      // 冲突行留在回收站里，作者还能在别处看到它，不静默丢。
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" }).map((entry) => entry.event.id)).toEqual(["e-1"]);
    } finally {
      storage.close();
    }
  });

  it("reports ids that are not in this book's trash as missing", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "other", bookId: "book-2", subject: "乙", predicate: "p", object: "o" }));
      trashPendingNarrativeEvents(storage, { bookId: "book-2", eventIds: ["other"], reason: "丢弃", now: "2026-07-01T00:00:00.000Z" });

      const restored = restoreTrashedNarrativeEvents(storage, { bookId: "book-1", eventIds: ["other", "never"] });

      expect(restored.restored).toEqual([]);
      expect(restored.missing).toEqual(["other", "never"]);
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-2" }).map((entry) => entry.event.id)).toEqual(["other"]);
    } finally {
      storage.close();
    }
  });

  it("keeps the restored row's status so a pending event lands back in the queue", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "e-1", subject: "韩立", predicate: "抵达", object: "药园" }));
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["e-1"], reason: "丢弃", now: "2026-07-01T00:00:00.000Z" });
      restoreTrashedNarrativeEvents(storage, { bookId: "book-1", eventIds: ["e-1"] });

      const row = storage.sqlite.prepare<{ status: string }>("SELECT status FROM narrative_event WHERE id = 'e-1'").get();
      expect(row?.status).toBe("pending");
      // 恢复后走正常审批路径仍然可用。
      expect(updateNarrativeEventStatus(storage, { id: "e-1", status: "rejected" })?.status).toBe("rejected");
    } finally {
      storage.close();
    }
  });
});

describe("pruneNarrativeEventTrash", () => {
  it("drops rows older than the retention window and keeps the rest", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "fresh", subject: "甲", predicate: "p", object: "o" }));
      insertNarrativeEvent(storage, event({ id: "stale", subject: "乙", predicate: "p", object: "o" }));
      // 保留期边界：正好 30 天前的行仍在保留期内，只有更早的才清。
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["fresh"], reason: "丢弃", now: "2026-06-01T00:00:00.000Z" });
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["stale"], reason: "丢弃", now: "2026-05-31T23:59:59.000Z" });

      const removed = pruneNarrativeEventTrash(storage, "2026-07-01T00:00:00.000Z");

      expect(removed).toBe(1);
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" }).map((entry) => entry.event.id)).toEqual(["fresh"]);
    } finally {
      storage.close();
    }
  });

  it("prunes expired rows on the next trash write", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "old", subject: "甲", predicate: "p", object: "o" }));
      insertNarrativeEvent(storage, event({ id: "new", subject: "乙", predicate: "p", object: "o" }));
      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["old"], reason: "丢弃", now: "2026-01-01T00:00:00.000Z" });

      trashPendingNarrativeEvents(storage, { bookId: "book-1", eventIds: ["new"], reason: "丢弃", now: "2026-07-01T00:00:00.000Z" });

      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" }).map((entry) => entry.event.id)).toEqual(["new"]);
    } finally {
      storage.close();
    }
  });

  it("creates the trash table on its own so an old database can be pruned safely", async () => {
    const storage = await createStorage();
    try {
      // 模拟只跑过旧 schema 的库：先建一次，再确认 prune 自己能兜住缺失的表。
      ensureNarrativeMemorySchema(storage);
      expect(pruneNarrativeEventTrash(storage, "2026-07-01T00:00:00.000Z")).toBe(0);
    } finally {
      storage.close();
    }
  });
});

/**
 * 回收站必须登记进档案清单：它属于「本机临时数据、不随档案迁移」，不登记的话
 * export.ts 会把它报成「本版不认识的表」，污染导出报告。
 */
describe("book archive registration", () => {
  it("registers the trash table as not-archived with a stated reason", () => {
    const spec = NOT_ARCHIVED_TABLES.find((item) => item.name === "narrative_event_trash");
    expect(spec).toBeDefined();
    expect(spec!.explanation.length).toBeGreaterThan(10);
    // 回收站不随档案迁移：导入后新书重新开始，不标成「导入时重新生成」。
    expect(spec!.regenerated).toBeUndefined();
    expect(ARCHIVE_TABLES.some((item) => item.name === "narrative_event_trash")).toBe(false);
  });
});
