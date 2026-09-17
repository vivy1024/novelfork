/**
 * 场景 / 剧情线的表结构契约。
 *
 * 这套表有两条建表路径，两条都必须能用：
 *   · 编号迁移 0035 —— 已迁移的生产库走这条；
 *   · ensureNarrativeMemorySchema —— 测试夹具与运行时直建库走这条
 *     （结算测试就是不跑迁移直接用的）。
 * 漏掉任一条的后果都是运行时「no such table」，且只在其中一种库上复现。
 *
 * 更要紧的是第三条用例：两棵树正交的前提是同一个场景能同时挂在章和剧情线下。
 * 如果哪天有人把 storyline_id 收成 narrative_scene 上的一列，正交性当场消失，
 * 「一个场景同时推进主线和感情线」就再也表达不了——那条用例就是拦这个的。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema } from "./storage.js";

const tempDirs: string[] = [];
const SCENE_TABLES = ["narrative_scene", "narrative_storyline", "narrative_scene_storyline"] as const;

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-scene-schema-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

function tableNames(storage: StorageDatabase): Set<string> {
  const rows = storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  return new Set(rows.map((row) => row.name));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("场景与剧情线的表结构", () => {
  it("编号迁移建出三张表", async () => {
    const storage = await createStorage();
    try {
      runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
      const tables = tableNames(storage);
      for (const table of SCENE_TABLES) {
        expect(tables.has(table), `迁移没有建出 ${table}`).toBe(true);
      }
    } finally {
      storage.close();
    }
  });

  it("ensureNarrativeMemorySchema 在不跑迁移的库上同样建出三张表", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      const tables = tableNames(storage);
      for (const table of SCENE_TABLES) {
        expect(tables.has(table), `ensureNarrativeMemorySchema 没有建出 ${table}`).toBe(true);
      }
    } finally {
      storage.close();
    }
  });

  it("同一个场景可同时挂在两条剧情线下，两棵树各自查得到", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      const now = Date.now();
      const insertLine = storage.sqlite.prepare(
        "INSERT INTO narrative_storyline (id, book_id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insertLine.run("line-main", "book-1", "主线：夺回师门", "main", now, now);
      insertLine.run("line-romance", "book-1", "感情线：与苏晚", "romance", now, now);

      storage.sqlite
        .prepare(
          "INSERT INTO narrative_scene (id, book_id, chapter_number, ordinal, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run("scene-1", "book-1", 12, 1, "药园夜谈", now, now);

      const mount = storage.sqlite.prepare(
        "INSERT INTO narrative_scene_storyline (scene_id, storyline_id, role, created_at) VALUES (?, ?, ?, ?)",
      );
      mount.run("scene-1", "line-main", "primary", now);
      mount.run("scene-1", "line-romance", "supporting", now);

      // 承载树方向：按章取场景
      const byChapter = storage.sqlite
        .prepare<{ id: string }>(
          "SELECT id FROM narrative_scene WHERE book_id = ? AND chapter_number = ? ORDER BY ordinal",
        )
        .all("book-1", 12);
      expect(byChapter.map((row) => row.id)).toEqual(["scene-1"]);

      // 因果树方向：按剧情线取场景，同一场景在两条线下都在
      const byLine = storage.sqlite
        .prepare<{ storyline_id: string; role: string }>(
          "SELECT storyline_id, role FROM narrative_scene_storyline WHERE scene_id = ? ORDER BY storyline_id",
        )
        .all("scene-1");
      expect(byLine).toEqual([
        { storyline_id: "line-main", role: "primary" },
        { storyline_id: "line-romance", role: "supporting" },
      ]);
    } finally {
      storage.close();
    }
  });

  it("机器抽取的默认值落在待审一侧，不会直接算作 canon", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      const now = Date.now();
      storage.sqlite
        .prepare(
          "INSERT INTO narrative_scene (id, book_id, chapter_number, ordinal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("scene-auto", "book-1", 1, 1, now, now);

      const row = storage.sqlite
        .prepare<{ layer: string; status: string; source: string }>(
          "SELECT layer, status, source FROM narrative_scene WHERE id = ?",
        )
        .get("scene-auto");
      expect(row).toEqual({ layer: "dynamic", status: "needs-review", source: "inferred" });
    } finally {
      storage.close();
    }
  });
});
