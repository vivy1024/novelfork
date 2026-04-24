import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { closeStorageDatabase, createStorageDatabase, getStorageDatabase, initializeStorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { sessions } from "../storage/schema.js";

const tempDirs: string[] = [];

async function createTempDbPath() {
  const dir = join(tmpdir(), `novelfork-storage-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return join(dir, "novelfork.db");
}

afterEach(async () => {
  closeStorageDatabase();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("storage SQLite database", () => {
  it("opens a file database with WAL and NORMAL synchronous pragmas", async () => {
    const databasePath = await createTempDbPath();
    const storage = createStorageDatabase({ databasePath });

    try {
      const journalMode = storage.sqlite.pragma("journal_mode", { simple: true });
      const synchronous = storage.sqlite.pragma("synchronous", { simple: true });
      const foreignKeys = storage.sqlite.pragma("foreign_keys", { simple: true });

      expect(String(journalMode).toLowerCase()).toBe("wal");
      expect(synchronous).toBe(1);
      expect(foreignKeys).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("runs the initial migration idempotently and supports a drizzle insert/select", async () => {
    const databasePath = await createTempDbPath();
    const storage = createStorageDatabase({ databasePath });

    try {
      const firstRun = runStorageMigrations(storage);
      const secondRun = runStorageMigrations(storage);

      expect(firstRun.applied).toContain("0001_initial.sql");
      expect(secondRun.applied).toEqual([]);
      const tableNames = storage.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tableNames).toEqual(expect.arrayContaining([
        "drizzle_migrations",
        "kv_store",
        "session",
        "session_message",
        "session_message_cursor",
      ]));

      await storage.db.insert(sessions).values({
        id: "session-1",
        createdAt: new Date("2026-04-24T00:00:00.000Z"),
        updatedAt: new Date("2026-04-24T00:00:00.000Z"),
        messageCount: 0,
        configJson: "{}",
        metadataJson: JSON.stringify({ title: "测试会话" }),
      });

      const rows = await storage.db.select().from(sessions).where(eq(sessions.id, "session-1"));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadataJson).toBe(JSON.stringify({ title: "测试会话" }));
    } finally {
      storage.close();
    }
  });

  it("throws on invalid migration SQL and does not mark it applied", async () => {
    const databasePath = await createTempDbPath();
    const migrationsDir = join(databasePath, "..", "bad-migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(join(migrationsDir, "0001_bad.sql"), "CREATE TABLE broken (", "utf-8");
    const storage = createStorageDatabase({ databasePath });

    try {
      expect(() => runStorageMigrations(storage, { migrationsDir })).toThrow();
      const rows = storage.sqlite
        .prepare(`SELECT name FROM "drizzle_migrations" WHERE name = ?`)
        .all("0001_bad.sql");
      expect(rows).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("rejects changed SQL for an already applied migration name", async () => {
    const databasePath = await createTempDbPath();
    const migrationsDir = join(databasePath, "..", "drift-migrations");
    const migrationPath = join(migrationsDir, "0001_drift.sql");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(migrationPath, "CREATE TABLE drift_one (id TEXT);", "utf-8");
    const storage = createStorageDatabase({ databasePath });

    try {
      expect(runStorageMigrations(storage, { migrationsDir }).applied).toEqual(["0001_drift.sql"]);
      await writeFile(migrationPath, "CREATE TABLE drift_two (id TEXT);", "utf-8");

      expect(() => runStorageMigrations(storage, { migrationsDir })).toThrow(/changed after it was applied/u);
    } finally {
      storage.close();
    }
  });

  it("skips duplicate migration content by hash even when the file name differs", async () => {
    const databasePath = await createTempDbPath();
    const migrationsDir = join(databasePath, "..", "duplicate-hash-migrations");
    await mkdir(migrationsDir, { recursive: true });
    const sql = "CREATE TABLE duplicate_hash (id TEXT);";
    await writeFile(join(migrationsDir, "0001_duplicate_a.sql"), sql, "utf-8");
    await writeFile(join(migrationsDir, "0002_duplicate_b.sql"), sql, "utf-8");
    const storage = createStorageDatabase({ databasePath });

    try {
      const result = runStorageMigrations(storage, { migrationsDir });
      expect(result.applied).toEqual(["0001_duplicate_a.sql"]);
    } finally {
      storage.close();
    }
  });

  it("reuses a singleton storage database until it is closed", async () => {
    const databasePath = await createTempDbPath();

    expect(() => getStorageDatabase()).toThrow(/not been initialized/u);

    const first = initializeStorageDatabase({ databasePath });
    const second = initializeStorageDatabase({ databasePath });

    expect(second).toBe(first);
    expect(getStorageDatabase()).toBe(first);

    closeStorageDatabase();
    const third = initializeStorageDatabase({ databasePath });

    try {
      expect(third).not.toBe(first);
    } finally {
      third.close();
    }
  });
});
