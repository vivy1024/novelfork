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
