/**
 * 待确认队列批量丢弃的回收站路由（T-28）。
 *
 * 批量丢弃原来是对 narrative_event 的物理删除，误点一次就找不回。现在它搬进
 * narrative_event_trash，这两个接口把回收站列出来、并支持恢复。
 *
 * 重点验证路由注册顺序：`{base}/events/:eventId/approve` 这类参数路由已存在，
 * 新增的固定路径段不能被它吃掉，反过来也不行——所以这里既测 `events/trash/restore`
 * 命中回收站，也测 id 恰好叫 trash 的事件仍能走单条批准。
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeMemoryRouter } from "./narrative-memory.js";
import { insertNarrativeEvent, listTrashedNarrativeEvents } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-event-trash-route-${crypto.randomUUID()}`);
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
    riskLevel: input.riskLevel ?? "low",
    subjectEntryId: input.subjectEntryId,
    objectEntryId: input.objectEntryId,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

async function postJson(app: ReturnType<typeof createNarrativeMemoryRouter>, path: string, body: unknown) {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("narrative event trash routes", () => {
  it("lists trashed events with their deletion stamp", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "trash-me", subject: "韩立", predicate: "抵达", object: "药园" }));
      const app = createNarrativeMemoryRouter({ storage });

      const deleted = await postJson(app, "/api/books/book-1/narrative-memory/events/bulk", {
        action: "delete",
        eventIds: ["trash-me"],
        reason: "工作台批量丢弃",
      });
      expect(deleted.status).toBe(200);
      // 用户可见文案：不再说「已删除」，说「已丢弃」并指向回收站。
      const deletedPayload = await deleted.json() as { summary: string; deleted: string[] };
      expect(deletedPayload.deleted).toEqual(["trash-me"]);
      expect(deletedPayload.summary).toContain("已丢弃");
      expect(deletedPayload.summary).toContain("回收站");

      const trash = await app.request("http://localhost/api/books/book-1/narrative-memory/events/trash");
      expect(trash.status).toBe(200);
      const trashPayload = await trash.json() as { events: Array<Record<string, unknown>>; summary: string };
      expect(trashPayload.events).toHaveLength(1);
      expect(trashPayload.events[0]).toMatchObject({ id: "trash-me", subject: "韩立", predicate: "抵达", object: "药园" });
      expect(typeof trashPayload.events[0]!.deletedAt).toBe("string");
      expect(trashPayload.events[0]!.deletedReason).toBe("工作台批量丢弃");
      expect(trashPayload.summary).toContain("回收站");
    } finally {
      storage.close();
    }
  });

  it("does not let the parameter route swallow the fixed trash segment", async () => {
    const storage = await createStorage();
    try {
      // 事件 id 就叫 trash：固定路径 /events/trash 与参数路由 /events/:eventId 必须各归各的。
      insertNarrativeEvent(storage, event({ id: "trash", subject: "甲", predicate: "p", object: "o" }));
      const app = createNarrativeMemoryRouter({ storage });

      const listed = await app.request("http://localhost/api/books/book-1/narrative-memory/events/trash");
      expect(listed.status).toBe(200);
      // 回收站里空着（还没丢弃任何东西），而不是把 id 为 trash 的事件当成回收站响应。
      const listedPayload = await listed.json() as { events: unknown[] };
      expect(listedPayload.events).toEqual([]);

      const approved = await postJson(app, "/api/books/book-1/narrative-memory/events/trash/approve", { reason: "确认正文" });
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ event: { id: "trash", status: "applied" } });
    } finally {
      storage.close();
    }
  });

  it("does not let the restore route shadow single-event approval", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "restore", subject: "甲", predicate: "p", object: "o" }));
      const app = createNarrativeMemoryRouter({ storage });

      const approved = await postJson(app, "/api/books/book-1/narrative-memory/events/restore/approve", { reason: "确认正文" });
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ event: { id: "restore", status: "applied" } });
    } finally {
      storage.close();
    }
  });

  it("restores trashed events back into the pending queue", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "e-1", subject: "韩立", predicate: "抵达", object: "药园" }));
      const app = createNarrativeMemoryRouter({ storage });
      await postJson(app, "/api/books/book-1/narrative-memory/events/bulk", { action: "delete", eventIds: ["e-1"], reason: "工作台批量丢弃" });

      const restored = await postJson(app, "/api/books/book-1/narrative-memory/events/trash/restore", { eventIds: ["e-1"] });
      expect(restored.status).toBe(200);
      const payload = await restored.json() as { restored: string[]; skipped: string[]; missing: string[]; summary: string };
      expect(payload.restored).toEqual(["e-1"]);
      expect(payload.skipped).toEqual([]);
      expect(payload.missing).toEqual([]);
      expect(payload.summary).toContain("恢复");

      const pending = await app.request("http://localhost/api/books/book-1/narrative-memory/events/pending");
      expect((await pending.json() as { events: Array<{ id: string }> }).events.map((item) => item.id)).toEqual(["e-1"]);
      const trash = await app.request("http://localhost/api/books/book-1/narrative-memory/events/trash");
      expect((await trash.json() as { events: unknown[] }).events).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("rejects an empty eventIds list instead of pretending to restore", async () => {
    const storage = await createStorage();
    try {
      const app = createNarrativeMemoryRouter({ storage });
      const response = await postJson(app, "/api/books/book-1/narrative-memory/events/trash/restore", { eventIds: [] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid-input" });
    } finally {
      storage.close();
    }
  });

  it("keeps applied events out of the trash even through the bulk route", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "applied-1", subject: "甲", predicate: "p", object: "o", status: "applied" }));
      const app = createNarrativeMemoryRouter({ storage });

      const deleted = await postJson(app, "/api/books/book-1/narrative-memory/events/bulk", { action: "delete", eventIds: ["applied-1"] });
      const payload = await deleted.json() as { deleted: string[]; skipped: string[] };
      expect(payload.deleted).toEqual([]);
      expect(payload.skipped).toEqual(["applied-1"]);
      expect(listTrashedNarrativeEvents(storage, { bookId: "book-1" })).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("scopes the trash listing to the routed book", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, event({ id: "b2-e", bookId: "book-2", subject: "乙", predicate: "p", object: "o" }));
      const app = createNarrativeMemoryRouter({ storage });
      await postJson(app, "/api/books/book-2/narrative-memory/events/bulk", { action: "delete", eventIds: ["b2-e"] });

      const other = await app.request("http://localhost/api/books/book-1/narrative-memory/events/trash");
      expect((await other.json() as { events: unknown[] }).events).toEqual([]);

      const own = await app.request("http://localhost/api/books/book-2/narrative-memory/events/trash");
      expect((await own.json() as { events: Array<{ id: string }> }).events.map((item) => item.id)).toEqual(["b2-e"]);
    } finally {
      storage.close();
    }
  });
});
