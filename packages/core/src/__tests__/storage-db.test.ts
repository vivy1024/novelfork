import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { closeStorageDatabase, createStorageDatabase, getStorageDatabase, initializeStorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { embeddedMigrations } from "../storage/embedded-migrations.js";
import { sessions } from "../storage/schema.js";

const tempDirs: string[] = [];

async function createTempDbPath() {
  const dir = join(tmpdir(), `novelfork-storage-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return join(dir, "novelfork.db");
}

const migrationsSourceDir = fileURLToPath(new URL("../storage/migrations/", import.meta.url));

function normalizeMigrationSql(sql: string): string {
  return sql.replace(/\r\n?/gu, "\n");
}

async function copyMigrationsBefore0027(destinationDir: string) {
  await mkdir(destinationDir, { recursive: true });
  const migrationFiles = (await readdir(migrationsSourceDir))
    .filter((file) => /^\d+.*\.sql$/u.test(file))
    .filter((file) => file.localeCompare("0027_jingwei_authority_consolidation.sql") < 0);
  await Promise.all(
    migrationFiles.map((file) => copyFile(join(migrationsSourceDir, file), join(destinationDir, file))),
  );
}

function seedAuthorityConsolidationFixtures(storage: ReturnType<typeof createStorageDatabase>) {
  storage.sqlite.exec(`
    INSERT INTO "book" ("id", "name", "created_at", "updated_at")
    VALUES ('migration-book', '迁移测试书', 1, 1);
    INSERT INTO "story_jingwei_section" ("id", "book_id", "key", "name", "created_at", "updated_at")
    VALUES ('migration-section', 'migration-book', 'settings', '设定', 1, 1);
    INSERT INTO "story_jingwei_entry"
      ("id", "book_id", "section_id", "title", "fields_json", "custom_fields_json", "created_at", "updated_at")
    VALUES
      ('fill-empty', 'migration-book', 'migration-section', '空串字段', '', '{"legacy":"value"}', 1, 1),
      ('fill-object', 'migration-book', 'migration-section', '空对象字段', '{}', '{"legacy":true}', 1, 1),
      ('preserve-value', 'migration-book', 'migration-section', '权威字段', '{"authoritative":true}', '{"legacy":true}', 1, 1),
      ('ignore-array', 'migration-book', 'migration-section', '非对象字段', '{}', '[1,2,3]', 1, 1),
      ('ignore-invalid', 'migration-book', 'migration-section', '无效 JSON', '{}', '{invalid', 1, 1);
  `);
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
      expect(tableNames).not.toContain("user_template");

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

  it("retires the abandoned jingwei volume-summary table in filesystem and embedded migrations", async () => {
    const filesystemDatabasePath = await createTempDbPath();
    const filesystemStorage = createStorageDatabase({ databasePath: filesystemDatabasePath });

    try {
      const filesystemResult = runStorageMigrations(filesystemStorage);
      const filesystemTable = filesystemStorage.sqlite
        .prepare<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jingwei_volume_summaries'`)
        .get();

      expect(filesystemResult.applied).toContain("0026_drop_legacy_jingwei_volume_summaries.sql");
      expect(filesystemTable == null).toBe(true);
    } finally {
      filesystemStorage.close();
    }

    const embeddedDatabasePath = await createTempDbPath();
    const embeddedStorage = createStorageDatabase({ databasePath: embeddedDatabasePath });
    const embeddedMigrationsDir = join(embeddedDatabasePath, "missing-migrations");

    try {
      const embeddedResult = runStorageMigrations(embeddedStorage, { migrationsDir: embeddedMigrationsDir });
      const embeddedTable = embeddedStorage.sqlite
        .prepare<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jingwei_volume_summaries'`)
        .get();

      expect(embeddedResult.applied).toContain("0026_drop_legacy_jingwei_volume_summaries.sql");
      expect(embeddedTable == null).toBe(true);
      expect(embeddedMigrations.some((migration) => migration.name === "0026_drop_legacy_jingwei_volume_summaries.sql" && migration.sql.includes("DROP TABLE IF EXISTS"))).toBe(true);
    } finally {
      embeddedStorage.close();
    }
  });

  it("applies 0027 in filesystem and embedded modes without overwriting authority or removing legacy jingwei tables", async () => {
    const migrationSql = await readFile(
      join(migrationsSourceDir, "0027_jingwei_authority_consolidation.sql"),
      "utf-8",
    );
    const embeddedMigration = embeddedMigrations.find(
      (migration) => migration.name === "0027_jingwei_authority_consolidation.sql",
    );
    expect(normalizeMigrationSql(embeddedMigration?.sql ?? "")).toBe(normalizeMigrationSql(migrationSql));

    const filesystemDatabasePath = await createTempDbPath();
    const filesystemStorage = createStorageDatabase({ databasePath: filesystemDatabasePath });
    const filesystemMigrationsDir = join(dirname(filesystemDatabasePath), "filesystem-migrations");

    try {
      await copyMigrationsBefore0027(filesystemMigrationsDir);
      runStorageMigrations(filesystemStorage, { migrationsDir: filesystemMigrationsDir });
      seedAuthorityConsolidationFixtures(filesystemStorage);
      await copyFile(
        join(migrationsSourceDir, "0027_jingwei_authority_consolidation.sql"),
        join(filesystemMigrationsDir, "0027_jingwei_authority_consolidation.sql"),
      );

      const filesystemResult = runStorageMigrations(filesystemStorage, { migrationsDir: filesystemMigrationsDir });
      const filesystemRows = filesystemStorage.sqlite
        .prepare<{ id: string; fields_json: string; custom_fields_json: string }>(
          `SELECT "id", "fields_json", "custom_fields_json" FROM "story_jingwei_entry" WHERE "book_id" = 'migration-book' ORDER BY "id"`,
        )
        .all();
      const filesystemRevisionColumns = filesystemStorage.sqlite
        .prepare<{ name: string }>(`PRAGMA table_info("jingwei_revision")`)
        .all()
        .map((row) => row.name);
      const filesystemLegacyTables = filesystemStorage.sqlite
        .prepare<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'jingwei_%' ORDER BY name`,
        )
        .all()
        .map((row) => row.name);

      expect(filesystemResult.applied).toEqual(["0027_jingwei_authority_consolidation.sql"]);
      expect(filesystemRows).toEqual([
        { id: "fill-empty", fields_json: '{"legacy":"value"}', custom_fields_json: '{"legacy":"value"}' },
        { id: "fill-object", fields_json: '{"legacy":true}', custom_fields_json: '{"legacy":true}' },
        { id: "ignore-array", fields_json: "{}", custom_fields_json: "[1,2,3]" },
        { id: "ignore-invalid", fields_json: "{}", custom_fields_json: "{invalid" },
        { id: "preserve-value", fields_json: '{"authoritative":true}', custom_fields_json: '{"legacy":true}' },
      ]);
      expect(filesystemRevisionColumns).toContain("snapshot_json");
      expect(filesystemLegacyTables).toEqual(expect.arrayContaining([
        "jingwei_character",
        "jingwei_event",
        "jingwei_setting",
        "jingwei_chapter_summary",
        "jingwei_conflict",
        "jingwei_world_model",
        "jingwei_premise",
        "jingwei_character_arc",
      ]));
      expect(runStorageMigrations(filesystemStorage, { migrationsDir: filesystemMigrationsDir }).applied).toEqual([]);
    } finally {
      filesystemStorage.close();
    }

    const embeddedDatabasePath = await createTempDbPath();
    const embeddedStorage = createStorageDatabase({ databasePath: embeddedDatabasePath });
    const embeddedMigrationsDir = join(dirname(embeddedDatabasePath), "embedded-migrations");

    try {
      await copyMigrationsBefore0027(embeddedMigrationsDir);
      runStorageMigrations(embeddedStorage, { migrationsDir: embeddedMigrationsDir });
      seedAuthorityConsolidationFixtures(embeddedStorage);

      const embeddedResult = runStorageMigrations(embeddedStorage, {
        migrationsDir: join(embeddedDatabasePath, "missing-migrations"),
      });
      const embeddedSnapshotColumn = embeddedStorage.sqlite
        .prepare<{ name: string }>(`PRAGMA table_info("jingwei_revision")`)
        .all()
        .some((row) => row.name === "snapshot_json");
      const embeddedRows = embeddedStorage.sqlite
        .prepare<{ id: string; fields_json: string }>(
          `SELECT "id", "fields_json" FROM "story_jingwei_entry" WHERE "book_id" = 'migration-book' ORDER BY "id"`,
        )
        .all();
      const embeddedLegacyTable = embeddedStorage.sqlite
        .prepare<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jingwei_character'`,
        )
        .get();

      expect(embeddedResult.applied).toContain("0027_jingwei_authority_consolidation.sql");
      expect(embeddedSnapshotColumn).toBe(true);
      expect(embeddedRows).toEqual([
        { id: "fill-empty", fields_json: '{"legacy":"value"}' },
        { id: "fill-object", fields_json: '{"legacy":true}' },
        { id: "ignore-array", fields_json: "{}" },
        { id: "ignore-invalid", fields_json: "{}" },
        { id: "preserve-value", fields_json: '{"authoritative":true}' },
      ]);
      expect(embeddedLegacyTable?.name).toBe("jingwei_character");
      expect(runStorageMigrations(embeddedStorage, {
        migrationsDir: join(embeddedDatabasePath, "missing-migrations"),
      }).applied).toEqual([]);
    } finally {
      embeddedStorage.close();
    }
  });

  it("does not create user_template while preserving a legacy table for plugin-owned read-only probing", async () => {
    const databasePath = await createTempDbPath();
    const storage = createStorageDatabase({ databasePath });

    try {
      storage.sqlite.exec(`CREATE TABLE "user_template" ("id" TEXT PRIMARY KEY);`);
      const result = runStorageMigrations(storage);
      const migrationNames = storage.sqlite
        .prepare<{ name: string }>(`SELECT name FROM "drizzle_migrations" ORDER BY name`)
        .all()
        .map((row) => row.name);
      const legacyTable = storage.sqlite
        .prepare<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_template'`)
        .get();

      expect(result.applied).not.toContain("0010_user_template.sql");
      expect(migrationNames).not.toContain("0010_user_template.sql");
      expect(embeddedMigrations.map((migration) => migration.name)).not.toContain("0010_user_template.sql");
      expect(legacyTable?.name).toBe("user_template");
    } finally {
      storage.close();
    }
  });

  it("falls back to the SQLite facade ORM when bundled drizzle resolution is unavailable", async () => {
    const previous = process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK;
    process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK = "1";
    const databasePath = await createTempDbPath();
    const storage = createStorageDatabase({ databasePath });

    try {
      runStorageMigrations(storage);
      await storage.db.insert(sessions).values({
        id: "fallback-session",
        createdAt: new Date("2026-04-30T00:00:00.000Z"),
        updatedAt: new Date("2026-04-30T00:00:00.000Z"),
        messageCount: 0,
        configJson: "{}",
        metadataJson: JSON.stringify({ title: "fallback" }),
      });

      const rows = await storage.db.select().from(sessions).where(eq(sessions.id, "fallback-session"));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadataJson).toBe(JSON.stringify({ title: "fallback" }));
    } finally {
      storage.close();
      if (previous === undefined) delete process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK;
      else process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK = previous;
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
