import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "../storage/index.js";

// T-23 产品数据库容灾：busy_timeout、迁移含 DROP TABLE 前打快照、启动完整性检查。
// 验收：迁移前有快照文件。所有用例都用真实 SQLite 文件，不 mock，因为容灾的本质是真实文件行为。

const scratchDirs: string[] = [];
const openStorages: StorageDatabase[] = [];

function scratch(): string {
  const dir = join(tmpdir(), `novelfork-storage-dr-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
}

function track(storage: StorageDatabase): StorageDatabase {
  openStorages.push(storage);
  return storage;
}

/** 写一个只含 DROP TABLE 的迁移目录，用来触发「迁移含 DROP 前打快照」。 */
function writeDropMigration(dir: string): string {
  const migrationsDir = join(dir, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, "0001_create_scratch.sql"), `CREATE TABLE "scratch" ("id" TEXT PRIMARY KEY);\nINSERT INTO "scratch" ("id") VALUES ('keep-me');\n`, "utf8");
  writeFileSync(join(migrationsDir, "0002_drop_scratch.sql"), `DROP TABLE IF EXISTS "scratch";\n`, "utf8");
  return migrationsDir;
}

afterEach(() => {
  for (const storage of openStorages.splice(0)) {
    try {
      storage.close();
    } catch {
      // 已关闭的连接忽略。
    }
  }
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("产品数据库容灾（T-23）", () => {
  it("连接建立后 busy_timeout 已设置为正值，写锁冲突时会等待而不是立即报 database is locked", () => {
    const storage = track(createStorageDatabase({ databasePath: join(scratch(), "novelfork.db") }));

    const timeout = storage.sqlite.pragma("busy_timeout", { simple: true });

    expect(Number(timeout)).toBeGreaterThan(0);
  });

  it("迁移含 DROP TABLE 之前，先在数据库同目录的 backups 下生成快照文件", () => {
    const dir = scratch();
    const databasePath = join(dir, "novelfork.db");
    const storage = track(createStorageDatabase({ databasePath }));
    const migrationsDir = writeDropMigration(dir);

    runStorageMigrations(storage, { migrationsDir });

    const backupsDir = join(dir, "backups");
    expect(existsSync(backupsDir)).toBe(true);
    const snapshots = readdirSync(backupsDir).filter((name) => name.endsWith(".db"));
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    // 快照命名带上触发它的迁移名，便于事后追溯是哪条 DROP 引发的。
    expect(snapshots.some((name) => name.includes("0002_drop_scratch"))).toBe(true);
  });

  it("快照是迁移开始前的完整副本：快照里仍有 DROP 之前的数据", () => {
    const dir = scratch();
    const databasePath = join(dir, "novelfork.db");
    const storage = track(createStorageDatabase({ databasePath }));
    const migrationsDir = writeDropMigration(dir);

    // 先只跑第一条迁移（建表并写入一行），让 scratch 表里有数据；再跑含 DROP 的第二条迁移。
    const firstOnlyDir = join(dir, "migrations-first-only");
    mkdirSync(firstOnlyDir, { recursive: true });
    writeFileSync(join(firstOnlyDir, "0001_create_scratch.sql"), `CREATE TABLE "scratch" ("id" TEXT PRIMARY KEY);\nINSERT INTO "scratch" ("id") VALUES ('keep-me');\n`, "utf8");
    runStorageMigrations(storage, { migrationsDir: firstOnlyDir });
    runStorageMigrations(storage, { migrationsDir });

    const backupsDir = join(dir, "backups");
    const snapshot = readdirSync(backupsDir).find((name) => name.includes("0002_drop_scratch") && name.endsWith(".db"));
    expect(snapshot).toBeDefined();
    const snapshotStorage = track(createStorageDatabase({ databasePath: join(backupsDir, snapshot!) }));
    const rows = snapshotStorage.sqlite.prepare<{ id: string }>(`SELECT id FROM "scratch"`).all();
    expect(rows.map((row) => row.id)).toEqual(["keep-me"]);
  });

  /** 按快照命名规则（创建时刻 + 迁移名）造一个指定年龄的快照文件。 */
  function snapshotNameAgedDays(days: number, migration: string): string {
    const stamp = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/[-:.]/gu, "");
    return `${stamp}-${migration}.db`;
  }

  it("快照保留 7 天（与 NarraFork 更新文件同规则）：迁移运行时删除超过 7 天的快照，保留 7 天内的", () => {
    const dir = scratch();
    const databasePath = join(dir, "novelfork.db");
    const storage = track(createStorageDatabase({ databasePath }));
    const backupsDir = join(dir, "backups");
    mkdirSync(backupsDir, { recursive: true });
    const expired = snapshotNameAgedDays(8, "0001_old");
    const fresh = snapshotNameAgedDays(1, "0002_recent");
    writeFileSync(join(backupsDir, expired), "old", "utf8");
    writeFileSync(join(backupsDir, fresh), "recent", "utf8");

    runStorageMigrations(storage, { migrationsDir: writeDropMigration(dir) });

    const names = readdirSync(backupsDir);
    expect(names).not.toContain(expired);
    expect(names).toContain(fresh);
    // 本次 DROP 迁移刚生成的快照不会被同一轮清理删掉。
    expect(names.some((name) => name.includes("0002_drop_scratch"))).toBe(true);
  });

  it("清理只认快照命名：backups 里用户自己放的文件、名字不合规则的文件，无论多旧都不删", () => {
    const dir = scratch();
    const databasePath = join(dir, "novelfork.db");
    const storage = track(createStorageDatabase({ databasePath }));
    const backupsDir = join(dir, "backups");
    mkdirSync(backupsDir, { recursive: true });
    const userFiles = ["我的手动备份.db", "novelfork-2026-01-01.db", "notes.txt"];
    for (const name of userFiles) writeFileSync(join(backupsDir, name), "user", "utf8");
    const expired = snapshotNameAgedDays(30, "0001_old");
    writeFileSync(join(backupsDir, expired), "old", "utf8");

    runStorageMigrations(storage, { migrationsDir: writeDropMigration(dir) });

    const names = readdirSync(backupsDir);
    for (const name of userFiles) expect(names).toContain(name);
    expect(names).not.toContain(expired);
  });

  it("启动完整性检查：创建连接时执行 integrity_check，并把结果挂在存储对象上供调用方读取", () => {
    const storage = track(createStorageDatabase({ databasePath: join(scratch(), "novelfork.db") }));

    // 功能要求的是「启动时执行并暴露结果」，不是 SQLite 本身能否做检查，所以断言返回对象上的字段。
    expect(storage.startupIntegrity).toBe("ok");
  });

  it("启动完整性检查：表根页损坏时，启动不抛错，且 startupIntegrity 报告非 ok 的结果", () => {
    const dir = scratch();
    const databasePath = join(dir, "novelfork.db");
    const healthy = createStorageDatabase({ databasePath });
    healthy.sqlite.exec(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "v" TEXT);`);
    for (let i = 0; i < 400; i += 1) {
      healthy.sqlite.run(`INSERT INTO "t" ("id", "v") VALUES (?, ?)`, `row-${i}`, "x".repeat(200));
    }
    healthy.checkpoint();
    const rootPage = healthy.sqlite.prepare<{ rootpage: number }>(`SELECT rootpage FROM sqlite_master WHERE name = 't'`).get()!.rootpage;
    healthy.close();

    // 直接改写表根页中部的字节（页号从 1 起，偏移 (rootpage-1)*4096），让结构在磁盘上确定性地损坏。
    const fd = openSync(databasePath, "r+");
    writeSync(fd, Buffer.alloc(256, 0xab), 0, 256, (rootPage - 1) * 4096 + 8);
    closeSync(fd);

    let storage: StorageDatabase | undefined;
    try {
      // 只包住创建调用：启动不得因损坏而抛错（记录而不阻止启动，由调用方决定如何处理）。
      storage = track(createStorageDatabase({ databasePath }));
    } catch (error) {
      throw new Error(`启动在损坏库上抛错（应记录而不抛）：${error instanceof Error ? error.message : String(error)}`);
    }
    // 断言放在 try 之外，失败时 vitest 直接显示真实的期望值与实际值，不被包装成「启动抛错」。
    expect(typeof storage.startupIntegrity).toBe("string");
    expect(storage.startupIntegrity).not.toBe("ok");
    expect(storage.startupIntegrity).not.toBe("");
    // 同一文件上 SQLite 自己的报告。严重损坏时原始 integrity_check 会直接抛异常（database disk image is malformed），
    // 而不是返回一行文字；所以两边都要收进来比较：启动检查必须把 SQLite 的原始错误带出来，而不是吞掉或改写。
    let rawReport: string;
    try {
      const rawRows = storage.sqlite.prepare<{ integrity_check: string }>(`PRAGMA integrity_check`).all();
      rawReport = rawRows[0]?.integrity_check ?? "";
    } catch (error) {
      rawReport = error instanceof Error ? error.message : String(error);
    }
    expect(rawReport).not.toBe("ok");
    expect(rawReport).not.toBe("");
    // 启动检查报告必须包含 SQLite 的原始错误信息，证明它没有吞掉真实原因。
    expect(storage.startupIntegrity).toContain(rawReport);
  });

  it("启动完整性检查的开销：在约 1MB 的库上，单独 integrity_check 的耗时占建连总耗时的比例可接受", () => {
    const dir = scratch();
    const databasePath = join(dir, "novelfork.db");
    const seed = createStorageDatabase({ databasePath });
    seed.sqlite.exec(`CREATE TABLE "bulk" ("id" TEXT PRIMARY KEY, "v" TEXT);`);
    seed.sqlite.exec("BEGIN");
    for (let i = 0; i < 2000; i += 1) {
      seed.sqlite.run(`INSERT INTO "bulk" ("id", "v") VALUES (?, ?)`, `row-${i}`, "x".repeat(400));
    }
    seed.sqlite.exec("COMMIT");
    seed.checkpoint();
    seed.close();

    const openStart = performance.now();
    const opened = track(createStorageDatabase({ databasePath }));
    const openMs = performance.now() - openStart;

    const checkStart = performance.now();
    opened.sqlite.pragma("integrity_check", { simple: true });
    const checkMs = performance.now() - checkStart;

    // 把实测值打印出来，由人判断是否可接受；断言只保护明显失控的情形（检查占建连总耗时超过 90%）。
    console.log(`[T-23 实测] 建连 ${openMs.toFixed(1)}ms，其中 integrity_check ${checkMs.toFixed(1)}ms`);
    expect(opened.startupIntegrity).toBe("ok");
    expect(checkMs).toBeLessThan(openMs * 0.9);
  });
});
