/**
 * 场景 / 剧情线接口的行为契约 —— 打真实 HTTP 请求，不是源码断言。
 *
 * 两处产品判断值得锁住：
 *   · scene-graph 一次返回 scenes/storylines/mounts 三样。分三次拉会出现
 *     「场景已更新、挂载还是旧的」的中间态，因果树上就会凭空多出或少掉连线。
 *   · 界面上手建的场景与剧情线落 canon/confirmed，不背 needs-review——
 *     待审是给机器抽取用的门，作者自己敲进去的东西不该再要他确认一遍。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeMemoryRouter } from "./narrative-memory.js";

const tempDirs: string[] = [];
const BASE = "/api/books/book-1/narrative-memory";

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-scene-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

function routerFor(storage: StorageDatabase) {
  return createNarrativeMemoryRouter({ storage });
}

async function postJson(app: ReturnType<typeof routerFor>, path: string, body: unknown) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GET scene-graph", () => {
  it("空书返回三个空集合而不是报错", async () => {
    const storage = await createStorage();
    try {
      const res = await routerFor(storage).request(`${BASE}/scene-graph`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, scenes: [], storylines: [], mounts: [] });
    } finally {
      storage.close();
    }
  });

  it("一次返回场景、剧情线与挂载三样，避免半新半旧的中间态", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const line = await postJson(app, `${BASE}/storylines`, { name: "夺回师门", kind: "main" });
      const scene = await postJson(app, `${BASE}/scenes`, { chapterNumber: 12, title: "药园夜谈" });
      const lineId = (line.body.data as { id: string }).id;
      const sceneIdValue = (scene.body.data as { id: string }).id;
      await postJson(app, `${BASE}/scenes/${sceneIdValue}/mounts`, { storylineId: lineId });

      const graph = await (await app.request(`${BASE}/scene-graph`)).json() as {
        scenes: Array<{ id: string }>;
        storylines: Array<{ id: string }>;
        mounts: Array<{ sceneId: string; storylineId: string; role: string }>;
      };

      expect(graph.scenes.map((s) => s.id)).toEqual([sceneIdValue]);
      expect(graph.storylines.map((l) => l.id)).toEqual([lineId]);
      expect(graph.mounts).toEqual([
        { sceneId: sceneIdValue, storylineId: lineId, role: "primary", createdAt: expect.any(Number) },
      ]);
    } finally {
      storage.close();
    }
  });
});

describe("建场景与剧情线", () => {
  it("作者手建的落 canon/confirmed，不背 needs-review", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const line = await postJson(app, `${BASE}/storylines`, { name: "主线", kind: "main" });
      const scene = await postJson(app, `${BASE}/scenes`, { chapterNumber: 1 });

      expect(line.body.data).toMatchObject({ layer: "canon", status: "confirmed", source: "manual" });
      expect(scene.body.data).toMatchObject({ layer: "canon", status: "confirmed", source: "manual" });
    } finally {
      storage.close();
    }
  });

  it("空名剧情线与非正整数章号被拒，错误可读", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const noName = await postJson(app, `${BASE}/storylines`, { name: "  " });
      const badChapter = await postJson(app, `${BASE}/scenes`, { chapterNumber: 0 });

      expect(noName.status).toBe(400);
      expect(String(noName.body.summary)).toContain("无名节点");
      expect(badChapter.status).toBe(400);
      expect(String(badChapter.body.summary)).toContain("必须落在某一章上");
    } finally {
      storage.close();
    }
  });

  it("剧情线类别与场景功能只接受枚举内的值，无效值被拒而不是原样落库", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      // 曾经前端把「支线」「人物成长」写成 subplot / character，接口照单全收
      const badKind = await postJson(app, `${BASE}/storylines`, { name: "支线A", kind: "subplot" });
      const badFunction = await postJson(app, `${BASE}/scenes`, { chapterNumber: 1, function: "fight" });
      expect(badKind.status).toBe(400);
      expect(String(badKind.body.summary)).toContain("subplot");
      expect(badFunction.status).toBe(400);

      const okSub = await postJson(app, `${BASE}/storylines`, { name: "支线B", kind: "sub" });
      const okArc = await postJson(app, `${BASE}/storylines`, { name: "成长线", kind: "character-arc" });
      expect(okSub.status).toBe(200);
      expect(okArc.status).toBe(200);

      const graph = await (await app.request(`${BASE}/scene-graph`)).json() as { storylines: Array<{ kind: string }> };
      expect(graph.storylines.map((line) => line.kind).sort()).toEqual(["character-arc", "sub"]);
    } finally {
      storage.close();
    }
  });

  it("不给次序时按章追加", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const first = await postJson(app, `${BASE}/scenes`, { chapterNumber: 3, title: "A" });
      const second = await postJson(app, `${BASE}/scenes`, { chapterNumber: 3, title: "B" });
      expect((first.body.data as { ordinal: number }).ordinal).toBe(1);
      expect((second.body.data as { ordinal: number }).ordinal).toBe(2);
    } finally {
      storage.close();
    }
  });
});

describe("重排与挂载", () => {
  it("重排改变章内次序，正文与 id 不动", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const a = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 5, title: "A" })).body.data as { id: string }).id;
      const b = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 5, title: "B" })).body.data as { id: string }).id;

      const res = await app.request(`${BASE}/chapters/5/scene-order`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneIds: [b, a] }),
      });
      expect(res.status).toBe(200);

      const graph = await (await app.request(`${BASE}/scene-graph`)).json() as { scenes: Array<{ id: string; title: string }> };
      expect(graph.scenes.map((s) => s.title)).toEqual(["B", "A"]);
    } finally {
      storage.close();
    }
  });

  it("重排给不全被拒，并说明少给会留下空号", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const a = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 5, title: "A" })).body.data as { id: string }).id;
      await postJson(app, `${BASE}/scenes`, { chapterNumber: 5, title: "B" });

      const res = await app.request(`${BASE}/chapters/5/scene-order`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneIds: [a] }),
      });
      expect(res.status).toBe(400);
      expect(String((await res.json() as { summary: string }).summary)).toContain("空号");
    } finally {
      storage.close();
    }
  });

  it("同一场景可挂多条线，摘下未挂载的返回 404 而不是假装成功", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const main = ((await postJson(app, `${BASE}/storylines`, { name: "主线", kind: "main" })).body.data as { id: string }).id;
      const romance = ((await postJson(app, `${BASE}/storylines`, { name: "感情线", kind: "romance" })).body.data as { id: string }).id;
      const sceneIdValue = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 9 })).body.data as { id: string }).id;

      await postJson(app, `${BASE}/scenes/${sceneIdValue}/mounts`, { storylineId: main });
      await postJson(app, `${BASE}/scenes/${sceneIdValue}/mounts`, { storylineId: romance, role: "supporting" });

      const graph = await (await app.request(`${BASE}/scene-graph`)).json() as { mounts: Array<{ storylineId: string; role: string }> };
      expect(graph.mounts).toHaveLength(2);
      expect(graph.mounts.map((m) => m.role).sort()).toEqual(["primary", "supporting"]);

      const notMounted = await app.request(`${BASE}/scenes/${sceneIdValue}/mounts/不存在的线`, { method: "DELETE" });
      expect(notMounted.status).toBe(404);

      const removed = await app.request(`${BASE}/scenes/${sceneIdValue}/mounts/${romance}`, { method: "DELETE" });
      expect(removed.status).toBe(200);
      const after = await (await app.request(`${BASE}/scene-graph`)).json() as { mounts: unknown[] };
      expect(after.mounts).toHaveLength(1);
    } finally {
      storage.close();
    }
  });
});

describe("挂载只能在同一本书内进行", () => {
  async function seedTwoBooks(app: ReturnType<typeof routerFor>) {
    const other = "/api/books/book-2/narrative-memory";
    const line = ((await postJson(app, `${BASE}/storylines`, { name: "主线", kind: "main" })).body.data as { id: string }).id;
    const scene = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 1 })).body.data as { id: string }).id;
    const foreignLine = ((await postJson(app, `${other}/storylines`, { name: "别的书的线" })).body.data as { id: string }).id;
    const foreignScene = ((await postJson(app, `${other}/scenes`, { chapterNumber: 1 })).body.data as { id: string }).id;
    return { line, scene, foreignLine, foreignScene };
  }

  it("拿别的书的场景或剧情线 id 挂载、摘除、改主线，一律 404，数据不动", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const { line, scene, foreignLine, foreignScene } = await seedTwoBooks(app);
      await postJson(app, `/api/books/book-2/narrative-memory/scenes/${foreignScene}/mounts`, { storylineId: foreignLine });

      // 用 book-1 的路径去碰 book-2 的场景
      expect((await postJson(app, `${BASE}/scenes/${foreignScene}/mounts`, { storylineId: line })).status).toBe(404);
      // 把 book-1 的场景挂到 book-2 的线上
      expect((await postJson(app, `${BASE}/scenes/${scene}/mounts`, { storylineId: foreignLine })).status).toBe(404);
      expect((await app.request(`${BASE}/scenes/${foreignScene}/mounts/${foreignLine}`, { method: "DELETE" })).status).toBe(404);
      const moved = await app.request(`${BASE}/scenes/${foreignScene}/primary-storyline`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storylineId: null }),
      });
      expect(moved.status).toBe(404);

      const book2 = await (await app.request("/api/books/book-2/narrative-memory/scene-graph")).json() as { mounts: unknown[] };
      expect(book2.mounts).toHaveLength(1);
      const book1 = await (await app.request(`${BASE}/scene-graph`)).json() as { mounts: unknown[] };
      expect(book1.mounts).toHaveLength(0);
    } finally {
      storage.close();
    }
  });
});

describe("改主剧情线（因果画布拖动场景换泳道）", () => {
  async function put(app: ReturnType<typeof routerFor>, sceneId: string, body: unknown) {
    const res = await app.request(`${BASE}/scenes/${sceneId}/primary-storyline`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { data?: Array<{ storylineId: string; role: string }> } };
  }

  it("换到另一条线：原主挂载摘掉，辅助挂载保留；目标原是辅助挂载的升为主挂载", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const main = ((await postJson(app, `${BASE}/storylines`, { name: "主线", kind: "main" })).body.data as { id: string }).id;
      const romance = ((await postJson(app, `${BASE}/storylines`, { name: "感情线", kind: "romance" })).body.data as { id: string }).id;
      const mystery = ((await postJson(app, `${BASE}/storylines`, { name: "悬疑线", kind: "mystery" })).body.data as { id: string }).id;
      const scene = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 2 })).body.data as { id: string }).id;
      await postJson(app, `${BASE}/scenes/${scene}/mounts`, { storylineId: main });
      await postJson(app, `${BASE}/scenes/${scene}/mounts`, { storylineId: romance, role: "supporting" });
      await postJson(app, `${BASE}/scenes/${scene}/mounts`, { storylineId: mystery, role: "supporting" });

      const moved = await put(app, scene, { storylineId: romance });
      expect(moved.status).toBe(200);
      const roles = Object.fromEntries(moved.body.data!.map((mount) => [mount.storylineId, mount.role]));
      expect(roles).toEqual({ [romance]: "primary", [mystery]: "supporting" });
    } finally {
      storage.close();
    }
  });

  it("拖进「未挂线」（storylineId 为 null）摘下全部挂载；缺 storylineId 被拒", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const main = ((await postJson(app, `${BASE}/storylines`, { name: "主线", kind: "main" })).body.data as { id: string }).id;
      const scene = ((await postJson(app, `${BASE}/scenes`, { chapterNumber: 2 })).body.data as { id: string }).id;
      await postJson(app, `${BASE}/scenes/${scene}/mounts`, { storylineId: main, role: "supporting" });

      expect((await put(app, scene, {})).status).toBe(400);
      const cleared = await put(app, scene, { storylineId: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toEqual([]);
    } finally {
      storage.close();
    }
  });
});

describe("POST storylines/:storylineId/review", () => {
  async function createDraft(storage: StorageDatabase, bookId: string): Promise<string> {
    const { createStoryline } = await import("../engine/narrative-memory/scene-store.js");
    const result = createStoryline(storage, {
      bookId, name: "归纳草稿·主线", kind: "main",
      layer: "dynamic", status: "needs-review", source: "inferred",
    });
    return result.data!.id;
  }

  it("待审草稿可确认、可驳回；confirmed 线不再被改写", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const id = await createDraft(storage, "book-1");

      const confirmed = await postJson(app, `${BASE}/storylines/${id}/review`, { decision: "confirmed" });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.data).toMatchObject({ status: "confirmed" });

      // 已确认的线不能再走 review 门
      expect((await postJson(app, `${BASE}/storylines/${id}/review`, { decision: "rejected" })).status).toBe(400);

      const other = await createDraft(storage, "book-1");
      const rejected = await postJson(app, `${BASE}/storylines/${other}/review`, { decision: "rejected" });
      expect(rejected.status).toBe(200);
    } finally {
      storage.close();
    }
  });

  it("跨书的剧情线一律 404，不泄露对象存在性", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const id = await createDraft(storage, "book-2");
      const res = await postJson(app, `${BASE}/storylines/${id}/review`, { decision: "confirmed" });
      expect(res.status).toBe(404);
    } finally {
      storage.close();
    }
  });

  it("decision 非法被拒", async () => {
    const storage = await createStorage();
    try {
      const app = routerFor(storage);
      const id = await createDraft(storage, "book-1");
      expect((await postJson(app, `${BASE}/storylines/${id}/review`, { decision: "maybe" })).status).toBe(400);
    } finally {
      storage.close();
    }
  });
});
