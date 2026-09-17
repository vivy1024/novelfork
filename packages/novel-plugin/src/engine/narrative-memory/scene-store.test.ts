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
      // 按 role 过滤时各归各的
      expect(listScenesByStoryline(storage, romance.id, { role: "primary" })).toEqual([]);
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
