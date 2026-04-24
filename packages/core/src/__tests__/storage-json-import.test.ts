import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runJsonImportMigrationIfNeeded } from "../storage/json-import-migration.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { createKvRepository } from "../storage/repositories/kv-repo.js";
import { createSessionMessageRepository } from "../storage/repositories/session-message-repo.js";
import { createSessionRepository } from "../storage/repositories/session-repo.js";

const tempDirs: string[] = [];

async function createStorageAndDir(): Promise<{ dir: string; storage: StorageDatabase }> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-json-import-"));
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return { dir, storage };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JSON to SQLite import migration", () => {
  it("imports legacy sessions and histories, writes done markers, and backs up JSON files", async () => {
    const { dir, storage } = await createStorageAndDir();
    try {
      await mkdir(join(dir, "session-history"), { recursive: true });
      await writeFile(join(dir, "sessions.json"), JSON.stringify([
        {
          id: "session-1",
          title: "旧会话",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: "2026-04-24T01:00:00.000Z",
          lastModified: "2026-04-24T01:01:00.000Z",
          messageCount: 99,
          sortOrder: 3,
          sessionConfig: { providerId: "anthropic", modelId: "claude", permissionMode: "ask", reasoningEffort: "high" },
        },
      ]));
      await writeFile(join(dir, "session-history", "session-1.json"), JSON.stringify([
        { id: "m1", role: "user", content: "你好", timestamp: 1_776_990_000_000, seq: 1 },
        { id: "m2", role: "assistant", content: "收到", timestamp: 1_776_990_000_100, seq: 2, toolCalls: [{ toolName: "Bash", status: "success" }] },
      ]));

      const result = await runJsonImportMigrationIfNeeded(storage, {
        storageDir: dir,
        now: new Date("2026-04-24T02:00:00.000Z"),
      });

      expect(result).toMatchObject({ status: "imported", importedSessions: 1, importedMessages: 2, skippedSessions: 0 });
      expect(await createKvRepository(storage).get("migration:json-to-sqlite:done")).toBe("true");
      expect(await createKvRepository(storage).get("migration:json-to-sqlite:completed_at")).toBe("2026-04-24T02:00:00.000Z");

      const session = await createSessionRepository(storage).getById("session-1");
      expect(session).toMatchObject({ id: "session-1", messageCount: 2 });
      expect(JSON.parse(session?.configJson ?? "{}")).toMatchObject({ permissionMode: "ask", reasoningEffort: "high" });
      expect(JSON.parse(session?.metadataJson ?? "{}")).toMatchObject({ title: "旧会话", sortOrder: 3 });

      const messages = await createSessionMessageRepository(storage).loadAll("session-1");
      expect(messages.map((message) => message.seq)).toEqual([1, 2]);
      expect(JSON.parse(messages[1]?.metadataJson ?? "{}").toolCalls).toEqual([{ toolName: "Bash", status: "success" }]);

      expect(await pathExists(join(dir, "sessions.json"))).toBe(false);
      expect((await readdir(dir)).some((entry) => /^sessions\.json\.migrated-20260424T020000000Z\.bak$/u.test(entry))).toBe(true);
      expect((await readdir(join(dir, "session-history"))).some((entry) => /^session-1\.json\.migrated-20260424T020000000Z\.bak$/u.test(entry))).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("skips corrupted per-session history with a warning and imports the remaining sessions", async () => {
    const { dir, storage } = await createStorageAndDir();
    const warn = vi.fn();
    try {
      await mkdir(join(dir, "session-history"), { recursive: true });
      await writeFile(join(dir, "sessions.json"), JSON.stringify([
        { id: "good", title: "正常", createdAt: "2026-04-24T01:00:00.000Z", lastModified: "2026-04-24T01:00:00.000Z", sessionConfig: {} },
        { id: "bad", title: "损坏", createdAt: "2026-04-24T01:00:00.000Z", lastModified: "2026-04-24T01:00:00.000Z", sessionConfig: {} },
      ]));
      await writeFile(join(dir, "session-history", "good.json"), JSON.stringify([
        { id: "good-message", role: "user", content: "保留", timestamp: 1_776_990_000_000 },
      ]));
      await writeFile(join(dir, "session-history", "bad.json"), "{ broken json");

      const result = await runJsonImportMigrationIfNeeded(storage, { storageDir: dir, warn });

      expect(result).toMatchObject({ status: "imported", importedSessions: 1, importedMessages: 1, skippedSessions: 1 });
      expect(await createSessionRepository(storage).getById("good")).not.toBeNull();
      expect(await createSessionRepository(storage).getById("bad")).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad"), expect.any(Error));
    } finally {
      storage.close();
    }
  });

  it("skips importing when the done marker already exists", async () => {
    const { dir, storage } = await createStorageAndDir();
    try {
      await createKvRepository(storage).set("migration:json-to-sqlite:done", "true");
      await writeFile(join(dir, "sessions.json"), JSON.stringify([{ id: "should-not-import" }]));

      const result = await runJsonImportMigrationIfNeeded(storage, { storageDir: dir });

      expect(result).toMatchObject({ status: "skipped", reason: "already-done", importedSessions: 0, importedMessages: 0 });
      expect(await createSessionRepository(storage).getById("should-not-import")).toBeNull();
      expect(await pathExists(join(dir, "sessions.json"))).toBe(true);
    } finally {
      storage.close();
    }
  });
});
