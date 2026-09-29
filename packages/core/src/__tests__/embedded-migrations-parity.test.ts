/**
 * 磁盘迁移目录与嵌入式迁移清单的一致性。
 *
 * migrations-runner 优先读磁盘目录，读不到才回落 embeddedMigrations——
 * 编译产物（bun compile 的 EXE）里没有 migrations 目录，走的正是回落分支。
 *
 * 必须逐字比对正文：迁移校验和连注释一起算。此前嵌入副本是手工精简的注释版本，
 * 导致开发环境迁移过的库用 EXE 打开报「迁移已被修改」、拒绝启动（反之亦然）。
 * 现在嵌入清单由 scripts/generate-embedded-migrations.ts 生成，历史旧写法登记在 legacyHashes。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { embeddedMigrations } from "../storage/embedded-migrations.js";
import { createStorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";

const migrationsDir = fileURLToPath(new URL("../storage/migrations/", import.meta.url));

function diskMigrationNames(): string[] {
  return readdirSync(migrationsDir)
    .filter((entry) => /^\d+.*\.sql$/u.test(entry))
    .sort((a, b) => a.localeCompare(b));
}

describe("嵌入式迁移与磁盘目录", () => {
  it("每个磁盘迁移都有对应的嵌入副本", () => {
    const embedded = new Set(embeddedMigrations.map((migration) => migration.name));
    const missing = diskMigrationNames().filter((name) => !embedded.has(name));

    expect(missing).toEqual([]);
  });

  it("嵌入清单里不含磁盘上已不存在的迁移", () => {
    const disk = new Set(diskMigrationNames());
    const stale = embeddedMigrations.map((migration) => migration.name).filter((name) => !disk.has(name));

    expect(stale).toEqual([]);
  });

  it("嵌入清单顺序与磁盘一致，且 SQL 非空", () => {
    expect(embeddedMigrations.map((migration) => migration.name)).toEqual(diskMigrationNames());
    for (const migration of embeddedMigrations) {
      expect(migration.sql.trim().length, `${migration.name} 的嵌入 SQL 为空`).toBeGreaterThan(0);
    }
  });

  it("嵌入 SQL 与磁盘文件逐字一致（统一 LF），走样时提示重新生成", () => {
    const drifted = embeddedMigrations
      .filter((migration) => readFileSync(join(migrationsDir, migration.name), "utf8").replace(/\r\n?/gu, "\n") !== migration.sql)
      .map((migration) => migration.name);
    expect(drifted, "请运行 bun scripts/generate-embedded-migrations.ts").toEqual([]);
  });

  it("磁盘方式迁移过的库，用嵌入方式（EXE）打开不会被拒绝，反之亦然", () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-migration-parity-"));
    const missingDir = join(dir, "no-migrations-here");
    try {
      const fromDisk = createStorageDatabase({ databasePath: join(dir, "disk.db") });
      runStorageMigrations(fromDisk, { migrationsDir });
      expect(runStorageMigrations(fromDisk, { migrationsDir: missingDir }).applied).toEqual([]);
      fromDisk.close();

      const fromEmbedded = createStorageDatabase({ databasePath: join(dir, "embedded.db") });
      runStorageMigrations(fromEmbedded, { migrationsDir: missingDir });
      expect(runStorageMigrations(fromEmbedded, { migrationsDir }).applied).toEqual([]);
      fromEmbedded.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
