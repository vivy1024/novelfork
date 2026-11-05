/**
 * 场景规划留白（T2.6）的落盘契约：蓝图带来的留白能存下，作者能整组改写，
 * 改动带版本保护，旧库升级后旧行读出为空数组。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_SCENE_GAP_TEXT, MAX_SCENE_GAPS, parseSceneGaps, renderChapterSceneGaps } from "../../handlers/scene-gaps.js";
import {
  createScene,
  listScenesByChapter,
  replaceChapterScenes,
  sceneFromSpec,
  updateSceneGaps,
} from "./scene-store.js";
import { ensureNarrativeMemorySchema } from "./storage.js";

const tempDirs: string[] = [];
// 磁盘迁移目录（开发路径）；嵌入路径与它的一致性由 core 的 parity 测试锁定。
const MIGRATIONS = { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") };

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-scene-gaps-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

/** 迁移建的场景表对 book 有外键，先放一本书。 */
function seedBook(storage: StorageDatabase, bookId: string): void {
  const now = Date.now();
  storage.sqlite.prepare(`INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at, state_revision) VALUES (?, ?, 'dynamic', 1, ?, ?, 1)`).run(bookId, "测试书", now, now);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseSceneGaps", () => {
  it("只保留类别合法、缺口与答案都非空的条目，并去掉首尾空白", () => {
    expect(parseSceneGaps([
      { kind: "motivation", gap: " 她为什么不反驳 ", answer: " 怕暴露旧伤 " },
      { kind: "unknown", gap: "x", answer: "y" },
      { kind: "detail", gap: "   ", answer: "y" },
      { kind: "pacing", gap: "x" },
      "not-an-object",
      null,
    ])).toEqual([{ kind: "motivation", gap: "她为什么不反驳", answer: "怕暴露旧伤" }]);
    expect(parseSceneGaps("garbage")).toEqual([]);
  });
});

describe("场景留白落盘", () => {
  it("蓝图带来的留白随场景落盘；读出时剔除脏数据", async () => {
    const storage = await createStorage();
    try {
      const input = sceneFromSpec("b1", 2, 1, {
        characters: ["林照"],
        location: "山门",
        conflict: "试炼",
        mood: "紧",
        outcome: "过关",
        hooks_used: [],
        hooks_planted: [],
        gaps: [{ kind: "pacing", gap: "要不要拖长对峙", answer: "只给三句" }],
      });
      replaceChapterScenes(storage, "b1", 2, [input]);
      const [scene] = listScenesByChapter(storage, "b1", 2);
      expect(scene!.gaps).toEqual([{ kind: "pacing", gap: "要不要拖长对峙", answer: "只给三句" }]);

      storage.sqlite.prepare("UPDATE narrative_scene SET gaps_json = ? WHERE id = ?")
        .run(JSON.stringify([{ kind: "bad" }, { kind: "detail", gap: "a", answer: "b" }]), scene!.id);
      expect(listScenesByChapter(storage, "b1", 2)[0]!.gaps).toEqual([{ kind: "detail", gap: "a", answer: "b" }]);
      storage.sqlite.prepare("UPDATE narrative_scene SET gaps_json = 'not json' WHERE id = ?").run(scene!.id);
      expect(listScenesByChapter(storage, "b1", 2)[0]!.gaps).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("作者改留白：按判据剔除非法条目、版本递增、机器场景被认领后重写本章不丢", async () => {
    const storage = await createStorage();
    try {
      replaceChapterScenes(storage, "b1", 3, [{ bookId: "b1", chapterNumber: 3, title: "蓝图场", source: "workflow", status: "needs-review" }]);
      const [scene] = listScenesByChapter(storage, "b1", 3);
      const saved = updateSceneGaps(storage, {
        bookId: "b1",
        sceneId: scene!.id,
        expectedUpdatedAt: scene!.updatedAt,
        gaps: [{ kind: "motivation", gap: "他为何回头", answer: "听见了妹妹的名字" }, { kind: "detail", gap: "", answer: "空缺口" }],
      });
      expect(saved.ok).toBe(true);
      expect(saved.data!.gaps).toEqual([{ kind: "motivation", gap: "他为何回头", answer: "听见了妹妹的名字" }]);
      expect(saved.data!.updatedAt).toBeGreaterThan(scene!.updatedAt);
      expect(saved.data!.status).toBe("confirmed");

      // 重写本章：作者动过的场景保留，留白还在。
      replaceChapterScenes(storage, "b1", 3, [{ bookId: "b1", chapterNumber: 3, title: "新蓝图场" }]);
      const after = listScenesByChapter(storage, "b1", 3);
      expect(after.map((item) => item.title)).toEqual(["蓝图场", "新蓝图场"]);
      expect(after[0]!.gaps).toHaveLength(1);
    } finally {
      storage.close();
    }
  });

  it("读取后场景被别处改过：拒绝保存并返回 scene-conflict；他书场景当作不存在", async () => {
    const storage = await createStorage();
    try {
      const created = createScene(storage, { bookId: "b1", chapterNumber: 1, title: "甲" });
      const stale = created.data!.updatedAt;
      const first = updateSceneGaps(storage, { bookId: "b1", sceneId: created.data!.id, expectedUpdatedAt: stale, gaps: [] });
      expect(first.ok).toBe(true);
      const second = updateSceneGaps(storage, {
        bookId: "b1",
        sceneId: created.data!.id,
        expectedUpdatedAt: stale,
        gaps: [{ kind: "detail", gap: "x", answer: "y" }],
      });
      expect(second).toMatchObject({ ok: false, error: "scene-conflict" });
      expect(listScenesByChapter(storage, "b1", 1)[0]!.gaps).toEqual([]);

      const crossBook = updateSceneGaps(storage, { bookId: "b2", sceneId: created.data!.id, expectedUpdatedAt: first.data!.updatedAt, gaps: [] });
      expect(crossBook).toMatchObject({ ok: false, error: "scene-not-found" });
    } finally {
      storage.close();
    }
  });

  it("解析即设上限：模型那条路落盘的留白也不超过 12 条、每项 500 字（所有入口共用这条判据）", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ kind: "detail", gap: `缺口${index}`, answer: `答案${index}` }));
    expect(parseSceneGaps(many)).toHaveLength(MAX_SCENE_GAPS);
    const tooLong = [
      { kind: "motivation", gap: "她为什么不反驳", answer: "长".repeat(MAX_SCENE_GAP_TEXT + 1) },
      { kind: "pacing", gap: "这里停多久", answer: "一拍" },
    ];
    expect(parseSceneGaps(tooLong)).toEqual([{ kind: "pacing", gap: "这里停多久", answer: "一拍" }]);
  });

  it("写前提示文字只列有留白的场，没有留白时为空", () => {
    expect(renderChapterSceneGaps(4, [{ sceneId: "s1", ordinal: 1, title: "", gaps: [] }])).toBe("");
    const text = renderChapterSceneGaps(4, [
      { sceneId: "s1", ordinal: 1, title: "", gaps: [] },
      { sceneId: "s2", ordinal: 2, title: "夜谈", gaps: [{ kind: "motivation", gap: "她为何留下", answer: "欠他一条命" }] },
    ]);
    expect(text).toContain("第 4 章规划留白");
    expect(text).toContain("第 2 场「夜谈」");
    expect(text).toContain("[动机] 她为何留下 → 欠他一条命");
    expect(text).not.toContain("第 1 场");
  });
});

describe("迁移双路径", () => {
  it("新库从零迁移后 narrative_scene 带 gaps_json，插入读取正常", async () => {
    const storage = await createStorage();
    try {
      expect(runStorageMigrations(storage, MIGRATIONS).applied).toContain("0040_narrative_scene_gaps.sql");
      expect(runStorageMigrations(storage, MIGRATIONS).applied).toEqual([]);
      seedBook(storage, "b1");
      const columns = storage.sqlite.prepare<{ name: string; dflt_value: string | null }>("PRAGMA table_info(narrative_scene)").all();
      expect(columns.find((column) => column.name === "gaps_json")?.dflt_value).toBe("'[]'");
      const created = createScene(storage, { bookId: "b1", chapterNumber: 1, gaps: [{ kind: "detail", gap: "a", answer: "b" }] });
      expect(listScenesByChapter(storage, "b1", 1)[0]!.gaps).toEqual(created.data!.gaps);
    } finally {
      storage.close();
    }
  });

  it("旧库（0039 之前建的场景表，无 gaps_json）升级：0040 补列，旧行读出为空数组", async () => {
    const storage = await createStorage();
    try {
      // 模拟升级前的库：迁到最新后去掉 gaps_json 列、撤销 0040 的迁移记录，留一行旧场景。
      runStorageMigrations(storage, MIGRATIONS);
      seedBook(storage, "b_old");
      storage.sqlite.exec(`ALTER TABLE narrative_scene DROP COLUMN gaps_json`);
      storage.sqlite.prepare(`DELETE FROM drizzle_migrations WHERE name = '0040_narrative_scene_gaps.sql'`).run();
      const now = Date.now();
      storage.sqlite.prepare(`
        INSERT INTO narrative_scene (id, book_id, chapter_number, ordinal, created_at, updated_at)
        VALUES ('scene:old', 'b_old', 5, 1, ?, ?)
      `).run(now, now);

      expect(runStorageMigrations(storage, MIGRATIONS).applied).toEqual(["0040_narrative_scene_gaps.sql"]);
      ensureNarrativeMemorySchema(storage);
      const [old] = listScenesByChapter(storage, "b_old", 5);
      expect(old!.gaps).toEqual([]);
      const saved = updateSceneGaps(storage, { bookId: "b_old", sceneId: "scene:old", expectedUpdatedAt: old!.updatedAt, gaps: [{ kind: "pacing", gap: "快还是慢", answer: "一笔带过" }] });
      expect(saved.ok).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("只走 ensureNarrativeMemorySchema 的旧表（无迁移路径）也会补上 gaps_json", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      storage.sqlite.exec(`ALTER TABLE narrative_scene DROP COLUMN gaps_json`);
      ensureNarrativeMemorySchema(storage);
      const columns = new Set(storage.sqlite.prepare<{ name: string }>("PRAGMA table_info(narrative_scene)").all().map((row) => row.name));
      expect(columns.has("gaps_json")).toBe(true);
    } finally {
      storage.close();
    }
  });
});
