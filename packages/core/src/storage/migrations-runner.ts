import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { StorageDatabase } from "./db.js";

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

function hashSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function listMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    // In compiled mode or when migrations dir is not available, skip migrations gracefully
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

  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const hash = hashSql(sql);
    const existingHash = appliedByName.get(file);
    if (existingHash) {
      if (existingHash !== hash) {
        throw new Error(`Storage migration ${file} changed after it was applied.`);
      }
      continue;
    }

    if (appliedByHash.has(hash)) continue;

    applyMigration(file, sql, hash);
    applied.push(file);
  }

  return { applied };
}

