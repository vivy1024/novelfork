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
      await sessions.create({
        id: "session-1",
        createdAt: new Date("2026-04-24T01:00:00.000Z"),
        updatedAt: new Date("2026-04-24T01:00:00.000Z"),
        messageCount: 0,
        configJson: "{}",
        metadataJson: "{}",
      });

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
      expect(await messages.getCursor("session-1")).toEqual({ lastSeq: 2, availableFromSeq: 1 });
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
      await sessions.create({
        id: "session-1",
        createdAt: new Date("2026-04-24T01:00:00.000Z"),
        updatedAt: new Date("2026-04-24T01:00:00.000Z"),
        messageCount: 0,
        configJson: "{}",
        metadataJson: "{}",
      });

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
      expect(await messages.getCursor("session-1")).toEqual({ lastSeq: 0, availableFromSeq: 0 });
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
});
