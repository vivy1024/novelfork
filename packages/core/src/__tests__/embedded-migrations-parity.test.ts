/**
 * 磁盘迁移目录与嵌入式迁移清单的名单一致性。
 *
 * migrations-runner 优先读磁盘目录，读不到才回落 embeddedMigrations——
 * 编译产物（bun compile 的 EXE）里没有 migrations 目录，走的正是回落分支。
 * 因此漏同步 embedded-migrations.ts 的后果是：开发机一切正常，用户拿到的 EXE
 * 少建表，直到运行时报「no such table」才暴露，且此时已经在用户的真实库上。
 *
 * 这里只比名单不比正文：现存条目的嵌入副本是人工精简过的注释版本，
 * 逐字比对会把「注释写得短一点」误报成缺陷。而真正会造成事故的失败模式是
 * 「磁盘有、嵌入没有」，名单比对足以拦住。
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { embeddedMigrations } from "../storage/embedded-migrations.js";

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
});
