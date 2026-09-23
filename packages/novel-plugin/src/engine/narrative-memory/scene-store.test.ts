/**
 * 场景 / 剧情线存取层的行为契约。
 *
 * 重点不在 CRUD 跑不跑得通，而在两件此前根本无法表达的事：
 *   · 调整叙事顺序只改 ordinal，不动正文；
 *   · 一个场景同时服务多条剧情线，两棵树各自查得到它。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  createScene,
  createStoryline,
  listSceneMounts,
  listScenesByChapter,
  listScenesByStoryline,
  listStorylines,
  mountSceneToStoryline,
  reorderChapterScenes,
  replaceChapterScenes,
  sceneFromSpec,
  unmountSceneFromStoryline,
} from "./scene-store.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-scene-store-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("剧情线", () => {
  it("主线排在其他线前面，便于因果树默认展开主干", async () => {
    const storage = await createStorage();
    try {
      createStoryline(storage, { bookId: "b1", name: "感情线", kind: "romance" });
      createStoryline(storage, { bookId: "b1", name: "夺回师门", kind: "main" });
      expect(listStorylines(storage, "b1").map((line) => line.name)).toEqual(["夺回师门", "感情线"]);
    } finally {
      storage.close();
    }
  });

  it("空名被拒，否则树上会出现点不中的无名节点", async () => {
    const storage = await createStorage();
    try {
      const result = createStoryline(storage, { bookId: "b1", name: "   " });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid-input");
    } finally {
      storage.close();
    }
  });

  it("默认落在待审一侧，机器抽取不会直接成为权威设定", async () => {
    const storage = await createStorage();
    try {
      const created = createStoryline(storage, { bookId: "b1", name: "主线", kind: "main" });
      expect(created.data).toMatchObject({ layer: "dynamic", status: "needs-review", source: "inferred" });
    } finally {
      storage.close();
    }
  });
});

describe("场景", () => {
  it("不指定次序时追加到该章末尾", async () => {
    const storage = await createStorage();
    try {
      const first = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "药园夜谈" });
      const second = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "守门人试炼" });
      expect(first.data?.ordinal).toBe(1);
      expect(second.data?.ordinal).toBe(2);
      // 另一章从头计数，互不干扰
      expect(createScene(storage, { bookId: "b1", chapterNumber: 13 }).data?.ordinal).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("章号非正整数被拒 —— 场景必须落在某一章上", async () => {
    const storage = await createStorage();
    try {
      expect(createScene(storage, { bookId: "b1", chapterNumber: 0 }).error).toBe("invalid-input");
      expect(createScene(storage, { bookId: "b1", chapterNumber: 1.5 }).error).toBe("invalid-input");
    } finally {
      storage.close();
    }
  });

  it("重排只改 ordinal，正文与 id 不动", async () => {
    const storage = await createStorage();
    try {
      const a = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "A" }).data!;
      const b = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "B" }).data!;
      const c = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "C" }).data!;

      const result = reorderChapterScenes(storage, "b1", 12, [c.id, a.id, b.id]);
      expect(result.ok).toBe(true);
      expect(listScenesByChapter(storage, "b1", 12).map((scene) => scene.title)).toEqual(["C", "A", "B"]);
      expect(listScenesByChapter(storage, "b1", 12).map((scene) => scene.ordinal)).toEqual([1, 2, 3]);
    } finally {
      storage.close();
    }
  });

  it("重排给不全会被拒，不留下空号", async () => {
    const storage = await createStorage();
    try {
      const a = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "A" }).data!;
      createScene(storage, { bookId: "b1", chapterNumber: 12, title: "B" });

      const result = reorderChapterScenes(storage, "b1", 12, [a.id]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("incomplete-order");
      // 失败后原序不变
      expect(listScenesByChapter(storage, "b1", 12).map((scene) => scene.ordinal)).toEqual([1, 2]);
    } finally {
      storage.close();
    }
  });

  it("重排里出现重复或外章场景会被拒", async () => {
    const storage = await createStorage();
    try {
      const a = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "A" }).data!;
      createScene(storage, { bookId: "b1", chapterNumber: 12, title: "B" });
      const outsider = createScene(storage, { bookId: "b1", chapterNumber: 13, title: "别章" }).data!;

      expect(reorderChapterScenes(storage, "b1", 12, [a.id, a.id]).error).toBe("duplicate-scene");
      expect(reorderChapterScenes(storage, "b1", 12, [a.id, outsider.id]).error).toBe("unknown-scene");
    } finally {
      storage.close();
    }
  });
});

describe("正交挂载", () => {
  it("同一场景挂两条线，两棵树各自查得到", async () => {
    const storage = await createStorage();
    try {
      const main = createStoryline(storage, { bookId: "b1", name: "夺回师门", kind: "main" }).data!;
      const romance = createStoryline(storage, { bookId: "b1", name: "与苏晚", kind: "romance" }).data!;
      const scene = createScene(storage, { bookId: "b1", chapterNumber: 12, title: "药园夜谈" }).data!;

      mountSceneToStoryline(storage, scene.id, main.id, "primary");
      mountSceneToStoryline(storage, scene.id, romance.id, "supporting");

      // 承载树方向
      expect(listScenesByChapter(storage, "b1", 12).map((s) => s.id)).toEqual([scene.id]);
      // 因果树方向：两条线都能取到它
      expect(listScenesByStoryline(storage, main.id).map((s) => s.id)).toEqual([scene.id]);
      expect(listScenesByStoryline(storage, romance.id).map((s) => s.id)).toEqual([scene.id]);
    } finally {
      storage.close();
    }
  });

  it("剧情线上的场景跨章按叙事顺序排 —— 「这条线上次推进是哪章」第一次能回答", async () => {
    const storage = await createStorage();
    try {
      const main = createStoryline(storage, { bookId: "b1", name: "主线", kind: "main" }).data!;
      const later = createScene(storage, { bookId: "b1", chapterNumber: 30, title: "晚" }).data!;
      const early = createScene(storage, { bookId: "b1", chapterNumber: 8, title: "早" }).data!;
      const middle = createScene(storage, { bookId: "b1", chapterNumber: 8, title: "早·第二场" }).data!;

      for (const scene of [later, early, middle]) mountSceneToStoryline(storage, scene.id, main.id);

      const onLine = listScenesByStoryline(storage, main.id);
      expect(onLine.map((s) => s.title)).toEqual(["早", "早·第二场", "晚"]);
      expect(onLine.at(-1)?.chapterNumber).toBe(30);
    } finally {
      storage.close();
    }
  });

  it("重复挂载视为改 role，不报错 —— 抽取管线会反复跑同一章", async () => {
    const storage = await createStorage();
    try {
      const line = createStoryline(storage, { bookId: "b1", name: "主线", kind: "main" }).data!;
      const scene = createScene(storage, { bookId: "b1", chapterNumber: 1 }).data!;

      mountSceneToStoryline(storage, scene.id, line.id, "supporting");
      const again = mountSceneToStoryline(storage, scene.id, line.id, "primary");

      expect(again.ok).toBe(true);
      expect(listSceneMounts(storage, scene.id)).toEqual([
        { sceneId: scene.id, storylineId: line.id, role: "primary", createdAt: expect.any(Number) },
      ]);
    } finally {
      storage.close();
    }
  });

  it("摘下未挂载的场景如实报告，不假装成功", async () => {
    const storage = await createStorage();
    try {
      const line = createStoryline(storage, { bookId: "b1", name: "主线" }).data!;
      const scene = createScene(storage, { bookId: "b1", chapterNumber: 1 }).data!;

      expect(unmountSceneFromStoryline(storage, scene.id, line.id).error).toBe("not-mounted");
      mountSceneToStoryline(storage, scene.id, line.id);
      expect(unmountSceneFromStoryline(storage, scene.id, line.id).ok).toBe(true);
      expect(listSceneMounts(storage, scene.id)).toEqual([]);
    } finally {
      storage.close();
    }
  });
});

describe("SceneSpec 对齐与旧表兼容性 (任务 1 验收)", () => {
  it("同一份 SceneSpec 经 sceneFromSpec 落盘后，六项字段逐一可读回且无丢失", async () => {
    const storage = await createStorage();
    try {
      const spec = {
        characters: ["林冲", "鲁智深"],
        location: "野猪林古松下",
        conflict: "董超薛霸欲下杀手，鲁智深禅杖救人",
        mood: "惊险肃杀转为酣畅淋漓",
        outcome: "鲁智深打跑董超薛霸，护送林冲前往沧州",
        hooks_used: ["前面鲁智深在相国寺道别时的伏笔"],
        hooks_planted: ["埋下野猪林事发高俅震怒的伏笔"],
      };

      const beatBudget = [
        { summary: "解差下套，林冲被绑", density: "normal" as const, words: 800 },
        { summary: "水火棍举起，千钧一发", density: "dense" as const, words: 1200 },
        { summary: "禅杖破空，鲁智深现身", density: "dense" as const, words: 1000 },
      ];

      const input = sceneFromSpec("b_spec_test", 9, 2, spec, {
        beatBudget,
        function: "climax",
        confidence: 0.95,
      });

      const result = createScene(storage, input);
      expect(result.ok).toBe(true);
      const sceneId = result.data!.id;

      const scenes = listScenesByChapter(storage, "b_spec_test", 9);
      const found = scenes.find((s) => s.id === sceneId);
      expect(found).toBeDefined();

      // 六项字段逐一可读回，无丢失
      expect(found!.conflict).toBe(spec.conflict);
      expect(found!.mood).toBe(spec.mood);
      expect(found!.outcome).toBe(spec.outcome);
      expect(found!.characters).toEqual(["林冲", "鲁智深"]);
      expect(found!.hooksUsed).toEqual(spec.hooks_used);
      expect(found!.hooksPlanted).toEqual(spec.hooks_planted);
      expect(found!.beatBudget).toEqual(beatBudget);
      expect(found!.function).toBe("climax");
      expect(found!.confidence).toBe(0.95);

      // location 存入 summary，不污染 locationEntityId
      expect(found!.summary).toContain("[地点: 野猪林古松下]");
      expect(found!.summary).toContain(spec.outcome);
      expect(found!.locationEntityId).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("ensureNarrativeMemorySchema 在已存在旧表（缺 7 列）的库上能正确补齐所有新列", async () => {
    const dir = join(tmpdir(), `novelfork-old-scene-schema-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    tempDirs.push(dir);
    const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });

    try {
      // 1. 手动建一张旧版 0035 的 narrative_scene（故意不包含 conflict 等 7 个新列）
      storage.sqlite.exec(`
        CREATE TABLE narrative_scene (
          id TEXT PRIMARY KEY NOT NULL,
          book_id TEXT NOT NULL,
          chapter_number INTEGER NOT NULL,
          ordinal INTEGER NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          function TEXT NOT NULL DEFAULT 'advance',
          pov_entity_id TEXT,
          location_entity_id TEXT,
          word_count INTEGER NOT NULL DEFAULT 0,
          layer TEXT NOT NULL DEFAULT 'dynamic',
          status TEXT NOT NULL DEFAULT 'needs-review',
          source TEXT NOT NULL DEFAULT 'inferred',
          confidence REAL NOT NULL DEFAULT 1.0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // 验证旧表确实缺新列
      const getCols = () =>
        new Set(
          storage.sqlite
            .prepare<{ name: string }>("PRAGMA table_info(narrative_scene)")
            .all()
            .map((r) => r.name),
        );
      expect(getCols().has("conflict")).toBe(false);
      expect(getCols().has("characters_json")).toBe(false);
      expect(getCols().has("beat_budget_json")).toBe(false);

      // 2. 调用 ensureNarrativeMemorySchema
      const { ensureNarrativeMemorySchema } = await import("./storage.js");
      ensureNarrativeMemorySchema(storage);

      // 3. 断言所有 7 个新列都被成功补齐
      const newCols = getCols();
      expect(newCols.has("conflict")).toBe(true);
      expect(newCols.has("mood")).toBe(true);
      expect(newCols.has("outcome")).toBe(true);
      expect(newCols.has("characters_json")).toBe(true);
      expect(newCols.has("hooks_used_json")).toBe(true);
      expect(newCols.has("hooks_planted_json")).toBe(true);
      expect(newCols.has("beat_budget_json")).toBe(true);

      // 4. 验证在升级后的表上可正常插入和读取
      const created = createScene(storage, {
        bookId: "b_old_upgrade",
        chapterNumber: 1,
        conflict: "测试冲突",
        characters: ["主角"],
      });
      expect(created.ok).toBe(true);
      const readBack = listScenesByChapter(storage, "b_old_upgrade", 1);
      expect(readBack[0].conflict).toBe("测试冲突");
      expect(readBack[0].characters).toEqual(["主角"]);
    } finally {
      storage.close();
    }
  });

  it("replaceChapterScenes 幂等：同章重写时机器场景被替换而不是累积", async () => {
    const storage = await createStorage();
    try {
      const bookId = "b_replace_test";
      const chapterNumber = 12;

      // 1. 首次写入 3 场
      const firstInputs = [
        { bookId, chapterNumber, ordinal: 1, title: "开端", conflict: "遭遇埋伏" },
        { bookId, chapterNumber, ordinal: 2, title: "激战", conflict: "以一敌三" },
        { bookId, chapterNumber, ordinal: 3, title: "撤退", conflict: "突围成功" },
      ];
      const res1 = replaceChapterScenes(storage, bookId, chapterNumber, firstInputs);
      expect(res1.ok).toBe(true);
      expect(res1.data).toHaveLength(3);

      const check1 = listScenesByChapter(storage, bookId, chapterNumber);
      expect(check1).toHaveLength(3);
      expect(check1.map((s) => s.title)).toEqual(["开端", "激战", "撤退"]);

      // 2. 第二次重写同一章：替换为 2 场全新的场景
      const secondInputs = [
        { bookId, chapterNumber, ordinal: 1, title: "全新开局", conflict: "潜伏潜入" },
        { bookId, chapterNumber, ordinal: 2, title: "全新高潮", conflict: "窃取密信" },
      ];
      const res2 = replaceChapterScenes(storage, bookId, chapterNumber, secondInputs);
      expect(res2.ok).toBe(true);
      expect(res2.data).toHaveLength(2);

      // 验证场景数没有累积成 5 场，而是精确更新为 2 场
      const check2 = listScenesByChapter(storage, bookId, chapterNumber);
      expect(check2).toHaveLength(2);
      expect(check2.map((s) => s.title)).toEqual(["全新开局", "全新高潮"]);
      expect(check2.map((s) => s.status)).toEqual(["needs-review", "needs-review"]);
      expect(check2.map((s) => s.source)).toEqual(["workflow", "workflow"]);
    } finally {
      storage.close();
    }
  });

  it("重写同一章不会抹掉作者的劳动：手建场景、已确认场景、已挂线场景及其挂载全部保留", async () => {
    const storage = await createStorage();
    try {
      const bookId = "b_preserve";
      const chapterNumber = 7;
      const line = createStoryline(storage, { bookId, name: "感情线", kind: "romance" }).data!;

      // 作者在看板上点「+」建的场景
      const manual = createScene(storage, {
        bookId, chapterNumber, title: "作者手建", layer: "canon", status: "confirmed", source: "manual",
      }).data!;
      // 机器产出、但作者已点头确认
      const confirmed = createScene(storage, {
        bookId, chapterNumber, title: "机器产出已确认", status: "confirmed", source: "workflow",
      }).data!;
      // 机器产出、作者没确认，但已经把它挂到了剧情线上
      const mounted = createScene(storage, {
        bookId, chapterNumber, title: "机器产出已挂线", source: "workflow",
      }).data!;
      mountSceneToStoryline(storage, mounted.id, line.id, "primary");
      // 机器产出且作者完全没动过——只有它应当被替换
      createScene(storage, { bookId, chapterNumber, title: "机器产出未动", source: "workflow" });

      const result = replaceChapterScenes(storage, bookId, chapterNumber, [
        { bookId, chapterNumber, title: "新蓝图场景" },
      ]);
      expect(result.ok).toBe(true);

      const titles = listScenesByChapter(storage, bookId, chapterNumber).map((s) => s.title);
      expect(titles).toContain("作者手建");
      expect(titles).toContain("机器产出已确认");
      expect(titles).toContain("机器产出已挂线");
      expect(titles).toContain("新蓝图场景");
      expect(titles).not.toContain("机器产出未动");

      // 挂载关系原样保留
      expect(listSceneMounts(storage, mounted.id).map((m) => m.storylineId)).toEqual([line.id]);
      // 保留的场景 id 不变（没有被删了重建）
      const ids = listScenesByChapter(storage, bookId, chapterNumber).map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining([manual.id, confirmed.id, mounted.id]));
    } finally {
      storage.close();
    }
  });

  it("新场景追加在保留场景之后，不与保留场景撞号", async () => {
    const storage = await createStorage();
    try {
      const bookId = "b_ordinal";
      createScene(storage, { bookId, chapterNumber: 3, title: "作者手建", status: "confirmed", source: "manual" });

      replaceChapterScenes(storage, bookId, 3, [
        { bookId, chapterNumber: 3, ordinal: 1, title: "蓝图一" },
        { bookId, chapterNumber: 3, ordinal: 2, title: "蓝图二" },
      ]);

      const scenes = listScenesByChapter(storage, bookId, 3);
      expect(scenes.map((s) => s.title)).toEqual(["作者手建", "蓝图一", "蓝图二"]);
      expect(scenes.map((s) => s.ordinal)).toEqual([1, 2, 3]);
    } finally {
      storage.close();
    }
  });
});
