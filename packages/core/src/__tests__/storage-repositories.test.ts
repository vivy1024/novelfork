import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { createKvRepository } from "../storage/repositories/kv-repo.js";
import { createSessionMessageRepository } from "../storage/repositories/session-message-repo.js";
import { createSessionRepository } from "../storage/repositories/session-repo.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-storage-repo-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

async function seedSession(storage: StorageDatabase, id = "session-1") {
  const sessions = createSessionRepository(storage);
  await sessions.create({
    id,
    createdAt: new Date("2026-04-24T01:00:00.000Z"),
    updatedAt: new Date("2026-04-24T01:00:00.000Z"),
    messageCount: 0,
    configJson: "{}",
    metadataJson: "{}",
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("storage repositories", () => {
  it("round-trips sessions through config and metadata JSON without losing fields", async () => {
    const storage = await createStorage();
    try {
      const sessions = createSessionRepository(storage);
      await sessions.create({
        id: "session-1",
        createdAt: new Date("2026-04-24T01:00:00.000Z"),
        updatedAt: new Date("2026-04-24T01:02:00.000Z"),
        messageCount: 2,
        configJson: JSON.stringify({ providerId: "anthropic", modelId: "claude-sonnet-4-6" }),
        metadataJson: JSON.stringify({ title: "测试", sortOrder: 7, extra: { nested: true } }),
      });

      await sessions.update("session-1", {
        messageCount: 3,
        updatedAt: new Date("2026-04-24T01:03:00.000Z"),
        metadataJson: JSON.stringify({ title: "更新", sortOrder: 7, extra: { nested: true } }),
      });

      const loaded = await sessions.getById("session-1");
      const listed = await sessions.list();

      expect(loaded).toMatchObject({
        id: "session-1",
        messageCount: 3,
        configJson: JSON.stringify({ providerId: "anthropic", modelId: "claude-sonnet-4-6" }),
        metadataJson: JSON.stringify({ title: "更新", sortOrder: 7, extra: { nested: true } }),
      });
      expect(loaded?.updatedAt.toISOString()).toBe("2026-04-24T01:03:00.000Z");
      expect(listed.map((session) => session.id)).toEqual(["session-1"]);
    } finally {
      storage.close();
    }
  });

  it("appends messages transactionally and exposes cursor/history semantics", async () => {
    const storage = await createStorage();
    try {
      const sessions = createSessionRepository(storage);
      const messages = createSessionMessageRepository(storage);
      await seedSession(storage);

      const all = await messages.appendMessages("session-1", [
        {
          id: "m1",
          role: "user",
          content: "你好",
          timestamp: new Date("2026-04-24T01:01:00.000Z"),
          metadataJson: JSON.stringify({ toolCalls: [{ toolName: "search", status: "success" }] }),
        },
        {
          id: "m2",
          role: "assistant",
          content: "收到",
          timestamp: new Date("2026-04-24T01:01:01.000Z"),
          metadataJson: "{}",
        },
      ]);

      expect(all.map((message) => message.seq)).toEqual([1, 2]);
      expect((await messages.loadSinceSeq("session-1", 1)).map((message) => message.id)).toEqual(["m2"]);
      expect(await messages.getCursor("session-1")).toEqual({ lastSeq: 2, availableFromSeq: 1, ackedSeq: 0, recoveryJson: "{}" });
      expect((await sessions.getById("session-1"))?.messageCount).toBe(2);
      expect(JSON.parse(all[0]?.metadataJson ?? "{}")).toEqual({ toolCalls: [{ toolName: "search", status: "success" }] });
    } finally {
      storage.close();
    }
  });

  it("replaces and deletes message rows while keeping cursor consistent", async () => {
    const storage = await createStorage();
    try {
      const sessions = createSessionRepository(storage);
      const messages = createSessionMessageRepository(storage);
      await seedSession(storage);

      await messages.appendMessages("session-1", [{
        id: "old",
        role: "user",
        content: "旧",
        timestamp: new Date("2026-04-24T01:01:00.000Z"),
        metadataJson: "{}",
      }]);
      const replaced = await messages.replaceAll("session-1", [{
        id: "new",
        role: "assistant",
        content: "新",
        timestamp: new Date("2026-04-24T01:02:00.000Z"),
        metadataJson: "{}",
      }]);

      expect(replaced).toMatchObject([{ id: "new", seq: 1 }]);
      expect((await messages.loadAll("session-1")).map((message) => message.id)).toEqual(["new"]);

      await messages.deleteAllBySession("session-1");
      expect(await messages.loadAll("session-1")).toEqual([]);
      expect(await messages.getCursor("session-1")).toEqual({ lastSeq: 0, availableFromSeq: 0, ackedSeq: 0, recoveryJson: "{}" });
    } finally {
      storage.close();
    }
  });

  it("stores kv values with upsert semantics", async () => {
    const storage = await createStorage();
    try {
      const kv = createKvRepository(storage);
      await kv.set("migration:json-to-sqlite:done", "false");
      await kv.set("migration:json-to-sqlite:done", "true");

      expect(await kv.get("migration:json-to-sqlite:done")).toBe("true");
      expect(await kv.get("missing")).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("assigns gap-free seq values for N=50 same-session append calls", async () => {
    const storage = await createStorage();
    try {
      await seedSession(storage);
      const messages = createSessionMessageRepository(storage);

      const appended = await Promise.all(Array.from({ length: 50 }, (_, index) => messages.appendMessages("session-1", [{
        id: `parallel-${index}`,
        role: "user",
        content: `消息 ${index}`,
        timestamp: new Date(1_776_990_000_000 + index),
        metadataJson: "{}",
      }])));

      expect(appended.at(-1)).toHaveLength(50);
      const all = await messages.loadAll("session-1");
      expect(all).toHaveLength(50);
      expect(all.map((message) => message.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
      expect(new Set(all.map((message) => message.id)).size).toBe(50);
    } finally {
      storage.close();
    }
  });

  it("retries one stale seq conflict and appends at the next available seq", async () => {
    const storage = await createStorage();
    try {
      await seedSession(storage);
      const messages = createSessionMessageRepository(storage, {
        beforeAppendAttempt({ attempt, storage: attemptStorage, sessionId }) {
          if (attempt === 0) {
            attemptStorage.sqlite.prepare(`
              INSERT INTO "session_message" (
                "session_id", "seq", "id", "role", "content", "timestamp", "metadata_json"
              ) VALUES (?, 1, 'racing-message', 'system', 'racing write', ?, '{}')
            `).run(sessionId, Date.now());
            return { cursorOverride: { lastSeq: 0, availableFromSeq: 0 } };
          }
          return undefined;
        },
      });

      const all = await messages.appendMessages("session-1", [{
        id: "retried-message",
        role: "user",
        content: "需要重试",
        timestamp: new Date("2026-04-24T02:00:00.000Z"),
        metadataJson: "{}",
      }]);

      expect(all.map((message) => message.id)).toEqual(["racing-message", "retried-message"]);
      expect(all.map((message) => message.seq)).toEqual([1, 2]);
    } finally {
      storage.close();
    }
  });

  it("rolls back the whole append transaction when any row fails", async () => {
    const storage = await createStorage();
    try {
      await seedSession(storage);
      const messages = createSessionMessageRepository(storage);

      await expect(messages.appendMessages("session-1", [
        {
          id: "duplicate-id",
          role: "user",
          content: "第一条",
          timestamp: new Date("2026-04-24T02:00:00.000Z"),
          metadataJson: "{}",
        },
        {
          id: "duplicate-id",
          role: "assistant",
          content: "第二条",
          timestamp: new Date("2026-04-24T02:00:01.000Z"),
          metadataJson: "{}",
        },
      ])).rejects.toThrow(/Failed to append session messages/u);

      expect(await messages.loadAll("session-1")).toEqual([]);
      expect(await messages.getCursor("session-1")).toEqual({ lastSeq: 0, availableFromSeq: 0, ackedSeq: 0, recoveryJson: "{}" });
    } finally {
      storage.close();
    }
  });

  it("truncates WAL files during checkpoint", async () => {
    const storage = await createStorage();
    try {
      await seedSession(storage);
      const messages = createSessionMessageRepository(storage);
      await messages.appendMessages("session-1", Array.from({ length: 20 }, (_, index) => ({
        id: `wal-${index}`,
        role: "user",
        content: `WAL ${index}`,
        timestamp: new Date(1_776_990_100_000 + index),
        metadataJson: "{}",
      })));

      const walPath = `${storage.databasePath}-wal`;
      expect(storage.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      storage.checkpoint();
      const stats = await import("node:fs/promises").then(({ stat }) => stat(walPath).catch(() => null));
      expect(stats?.size ?? 0).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("records 1000-message append pressure timing without losing rows", async () => {
    const storage = await createStorage();
    try {
      await seedSession(storage);
      const messages = createSessionMessageRepository(storage);
      const startedAt = performance.now();
      const result = await messages.appendMessages("session-1", Array.from({ length: 1000 }, (_, index) => ({
        id: `pressure-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `压测消息 ${index}`,
        timestamp: new Date(1_776_990_200_000 + index),
        metadataJson: "{}",
      })));
      const elapsedMs = performance.now() - startedAt;

      console.info(`[storage-pressure] append 1000 messages: ${elapsedMs.toFixed(2)}ms`);
      expect(result).toHaveLength(1000);
      expect(result.at(0)?.seq).toBe(1);
      expect(result.at(-1)?.seq).toBe(1000);
    } finally {
      storage.close();
    }
  });
});
