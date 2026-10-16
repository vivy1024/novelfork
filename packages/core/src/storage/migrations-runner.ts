import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import type { StorageDatabase } from "./db.js";
import { embeddedMigrations } from "./embedded-migrations.js";

export interface RunStorageMigrationsOptions {
  migrationsDir?: string;
}

export interface StorageMigrationResult {
  applied: string[];
}

function stripWindowsPathLeadingSlash(pathname: string): string {
  return /^\/[A-Za-z]:/u.test(pathname) ? pathname.slice(1) : pathname;
}

function resolveDefaultMigrationsDir(): string {
  const migrationsUrl = new URL("./migrations", import.meta.url);
  const viteFsPath = decodeURIComponent(migrationsUrl.pathname).replace(/^\/@fs\//u, "");
  const candidatePaths = [
    stripWindowsPathLeadingSlash(viteFsPath),
    join(process.cwd(), "src", "storage", "migrations"),
    join(process.cwd(), "..", "core", "src", "storage", "migrations"),
    join(process.cwd(), "packages", "core", "src", "storage", "migrations"),
    join(process.cwd(), "..", "packages", "core", "src", "storage", "migrations"),
  ];
  const existingPath = candidatePaths.find((candidate) => existsSync(candidate));
  return existingPath ?? candidatePaths[0]!;
}

function ensureMigrationTable(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "drizzle_migrations" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "hash" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL UNIQUE,
      "created_at" INTEGER NOT NULL
    );
  `);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\r\n?/gu, "\n");
}

/** 含 DROP TABLE 的迁移会永久丢表；这类迁移执行前先做一份快照（T-23）。 */
const DESTRUCTIVE_DROP_PATTERN = /\bDROP\s+TABLE\b/iu;

/**
 * 迁移含 DROP TABLE 时，在它执行前对数据库文件做一份快照，存到数据库同目录的 backups/ 下。
 * 必须在事务之外调用：快照前先 wal_checkpoint(TRUNCATE)，把 WAL 内容合并回主文件，否则快照会缺最近的写入。
 * 内存库没有文件可复制，直接跳过。
 */
function snapshotBeforeDestructiveMigration(storage: StorageDatabase, name: string, sql: string): string | null {
  if (!DESTRUCTIVE_DROP_PATTERN.test(sql)) return null;
  const databasePath = storage.databasePath;
  if (!databasePath || databasePath === ":memory:" || !existsSync(databasePath)) return null;
  storage.checkpoint();
  const backupsDir = join(dirname(databasePath), "backups");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/gu, "");
  const safeName = name.replace(/\.sql$/iu, "").replace(/[^\w.-]/gu, "_");
  const snapshotPath = join(backupsDir, `${stamp}-${safeName}.db`);
  copyFileSync(databasePath, snapshotPath);
  return snapshotPath;
}

/** 迁移前快照保留 7 天，与 NarraFork Runtime 清理更新文件的规则一致（update-service.ts cleanupOldUpdates）。 */
export const MIGRATION_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 快照文件名：创建时刻（toISOString 去掉 -:.）+ 迁移名。只有符合它的文件才归清理管。 */
const SNAPSHOT_FILE_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-.+\.db$/u;

/**
 * 删除 backups/ 下超过保留期的迁移快照。年龄取文件名里的创建时刻：Windows 复制文件会保留原库的修改时间，
 * 看 mtime 会把刚做的快照当成旧文件。不符合快照命名的文件（用户自己放的备份等）一律不碰；
 * 清理失败只跳过，不阻断启动。
 */
function pruneExpiredMigrationSnapshots(storage: StorageDatabase, now: number = Date.now()): void {
  const databasePath = storage.databasePath;
  if (!databasePath || databasePath === ":memory:") return;
  const backupsDir = join(dirname(databasePath), "backups");
  if (!existsSync(backupsDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(backupsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const match = SNAPSHOT_FILE_PATTERN.exec(entry);
    if (!match) continue;
    const [, year, month, day, hour, minute, second, millisecond] = match.map(Number);
    const createdAt = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!, millisecond!);
    if (!Number.isFinite(createdAt) || now - createdAt <= MIGRATION_SNAPSHOT_RETENTION_MS) continue;
    try {
      unlinkSync(join(backupsDir, entry));
    } catch {
      // 文件被占用或已被删，下次启动再试。
    }
  }
}

function hashSql(sql: string): string {
  return createHash("sha256").update(normalizeSql(sql)).digest("hex");
}

function hashRawSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function equivalentSqlHashes(sql: string): ReadonlySet<string> {
  const normalized = normalizeSql(sql);
  return new Set([
    hashSql(normalized),
    hashRawSql(sql),
    hashRawSql(normalized.replace(/\n/gu, "\r\n")),
  ]);
}

function listMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    // In compiled mode or when migrations dir is not available, return empty
    // — the runner will fall back to embedded migrations below.
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((entry) => /^\d+.*\.sql$/u.test(entry))
    .sort((a, b) => a.localeCompare(b));
}

export function runStorageMigrations(
  storage: StorageDatabase,
  options: RunStorageMigrationsOptions = {},
): StorageMigrationResult {
  const migrationsDir = options.migrationsDir ?? resolveDefaultMigrationsDir();
  ensureMigrationTable(storage);
  // 每次启动都清一次过期快照，不依赖这次是否有新迁移。
  pruneExpiredMigrationSnapshots(storage);

  const applied: string[] = [];
  const migrationFiles = listMigrationFiles(migrationsDir);
  const appliedRows = storage.sqlite.prepare(
    `SELECT "name", "hash" FROM "drizzle_migrations"`,
  ).all() as Array<{ name: string; hash: string }>;
  const appliedByName = new Map(appliedRows.map((row) => [row.name, row.hash]));
  const appliedByHash = new Map(appliedRows.map((row) => [row.hash, row.name]));
  const recordMigration = storage.sqlite.prepare(
    `INSERT INTO "drizzle_migrations" ("hash", "name", "created_at") VALUES (?, ?, ?)`,
  );

  const applyMigration = storage.sqlite.transaction((name: string, sql: string, hash: string) => {
    storage.sqlite.exec(sql);
    recordMigration.run(hash, name, Date.now());
    appliedByName.set(name, hash);
    appliedByHash.set(hash, name);
  });

  // 历史上出现过的旧写法（手工内嵌副本、迁移文件旧版本）也算同一个迁移：
  // 开发环境与 EXE 迁移过的库互相打开时不能因为注释或排版不同被拒绝启动。
  const legacyHashesByName = new Map(embeddedMigrations.map((migration) => [migration.name, migration.legacyHashes ?? []] as const));
  const acceptedHashes = (name: string, sql: string): ReadonlySet<string> => new Set([
    ...equivalentSqlHashes(sql),
    ...(legacyHashesByName.get(name) ?? []),
  ]);

  // Use filesystem migrations if available, otherwise fall back to embedded
  if (migrationFiles.length > 0) {
    for (const file of migrationFiles) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      const hash = hashSql(sql);
      const equivalentHashes = acceptedHashes(file, sql);
      const existingHash = appliedByName.get(file);
      if (existingHash) {
        if (!equivalentHashes.has(existingHash)) {
          throw new Error(`Storage migration ${file} changed after it was applied.`);
        }
        appliedByHash.set(hash, file);
        continue;
      }

      if ([...equivalentHashes].some((candidate) => appliedByHash.has(candidate))) continue;

      snapshotBeforeDestructiveMigration(storage, file, sql);
      applyMigration(file, sql, hash);
      applied.push(file);
    }
  } else {
    // Embedded fallback (compiled binary mode)
    for (const migration of embeddedMigrations) {
      const hash = hashSql(migration.sql);
      const equivalentHashes = acceptedHashes(migration.name, migration.sql);
      const existingHash = appliedByName.get(migration.name);
      if (existingHash) {
        if (!equivalentHashes.has(existingHash)) {
          throw new Error(`Storage migration ${migration.name} changed after it was applied.`);
        }
        appliedByHash.set(hash, migration.name);
        continue;
      }

      if ([...equivalentHashes].some((candidate) => appliedByHash.has(candidate))) continue;

      snapshotBeforeDestructiveMigration(storage, migration.name, migration.sql);
      applyMigration(migration.name, migration.sql, hash);
      applied.push(migration.name);
    }
  }

  return { applied };
}

