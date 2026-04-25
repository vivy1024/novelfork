import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository, createStorageDatabase, runStorageMigrations, seedQuestionnaireTemplates, type StorageDatabase } from "@vivy1024/novelfork-core";

import { createBibleRouter } from "./bible.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-studio-bible-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  await seedQuestionnaireTemplates(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 5,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Bible API routes", () => {
  it("creates, lists, updates, and soft-deletes characters", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });
      const createResponse = await router.request("http://localhost/api/books/book-1/bible/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "char-1",
          name: "韩立",
          aliases: ["韩老魔"],
          roleType: "protagonist",
          summary: "谨慎求长生。",
          traits: { careful: true },
          visibilityRule: { type: "tracked" },
          firstChapter: 1,
        }),
      });

      expect(createResponse.status).toBe(201);
      expect(await createResponse.json()).toMatchObject({
        character: {
          id: "char-1",
          bookId: "book-1",
          name: "韩立",
          aliases: ["韩老魔"],
          roleType: "protagonist",
          visibilityRule: { type: "tracked" },
        },
      });

      const updateResponse = await router.request("http://localhost/api/books/book-1/bible/characters/char-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: "谨慎、低调、重承诺。" }),
      });
      expect(updateResponse.status).toBe(200);
      expect(await updateResponse.json()).toMatchObject({ character: { summary: "谨慎、低调、重承诺。" } });

      const listResponse = await router.request("http://localhost/api/books/book-1/bible/characters");
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toMatchObject({ characters: [{ id: "char-1", name: "韩立" }] });

      const deleteResponse = await router.request("http://localhost/api/books/book-1/bible/characters/char-1", { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({ ok: true, id: "char-1" });
      expect(await (await router.request("http://localhost/api/books/book-1/bible/characters")).json()).toEqual({ characters: [] });
    } finally {
      storage.close();
    }
  });

  it("supports events, settings, and chapter summaries CRUD surfaces", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });

      const eventResponse = await postJson(router, "/api/books/book-1/bible/events", {
        id: "event-1",
        name: "小瓶现世",
        eventType: "foreshadow",
        chapterStart: 1,
        summary: "小瓶成为长线伏笔。",
        relatedCharacterIds: ["char-1"],
        visibilityRule: { type: "tracked" },
        foreshadowState: "buried",
      });
      expect(eventResponse.status).toBe(201);
      expect(await eventResponse.json()).toMatchObject({ event: { id: "event-1", relatedCharacterIds: ["char-1"] } });

      const settingResponse = await postJson(router, "/api/books/book-1/bible/settings", {
        id: "setting-1",
        category: "power-system",
        name: "修炼体系",
        content: "资源决定突破。",
        nestedRefs: ["event-1"],
      });
      expect(settingResponse.status).toBe(201);
      expect(await settingResponse.json()).toMatchObject({ setting: { id: "setting-1", nestedRefs: ["event-1"] } });

      const summaryResponse = await postJson(router, "/api/books/book-1/bible/chapter-summaries", {
        id: "summary-1",
        chapterNumber: 1,
        title: "初入山门",
        summary: "主角发现小瓶。",
        wordCount: 3200,
        keyEvents: ["event-1"],
        appearingCharacterIds: ["char-1"],
        pov: "韩立",
      });
      expect(summaryResponse.status).toBe(201);
      expect(await summaryResponse.json()).toMatchObject({ chapterSummary: { id: "summary-1", keyEvents: ["event-1"] } });
    } finally {
      storage.close();
    }
  });

  it("runs the Phase A author flow from book setup to bulk entries and preview", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });

      for (let index = 1; index <= 5; index += 1) {
        await postJson(router, "/api/books/book-1/bible/characters", {
          id: `flow-char-${index}`,
          name: `角色${index}`,
          aliases: [`角色别名${index}`],
          summary: `角色${index}的阶段性设定。`,
          visibilityRule: index === 1 ? { type: "tracked" } : { type: "global" },
        });
      }
      for (let index = 1; index <= 3; index += 1) {
        await postJson(router, "/api/books/book-1/bible/events", {
          id: `flow-event-${index}`,
          name: `事件${index}`,
          eventType: "key",
          summary: `事件${index}推动主线。`,
          visibilityRule: { type: "tracked" },
        });
      }
      for (let index = 1; index <= 5; index += 1) {
        await postJson(router, "/api/books/book-1/bible/settings", {
          id: `flow-setting-${index}`,
          category: "world",
          name: `设定${index}`,
          content: `设定${index}影响修炼资源。`,
          visibilityRule: { type: "global" },
        });
      }

      const previewResponse = await postJson(router, "/api/books/book-1/bible/preview-context", {
        currentChapter: 5,
        sceneText: "角色别名1卷入事件2。",
      });
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json();
      expect(preview.context.items.some((item: { id: string }) => item.id === "flow-char-1")).toBe(true);
      expect(preview.context.items.some((item: { id: string }) => item.id === "flow-setting-5")).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("supports Phase B premise, world model, conflicts, and character arcs", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });
      await postJson(router, "/api/books/book-1/bible/characters", {
        id: "char-1",
        name: "韩立",
        summary: "谨慎求长生。",
        visibilityRule: { type: "tracked" },
      });

      const premiseResponse = await router.request("http://localhost/api/books/book-1/bible/premise", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logline: "凡人靠小瓶求长生。", tone: "稳健", theme: ["长生"] }),
      });
      expect(premiseResponse.status).toBe(200);
      expect(await premiseResponse.json()).toMatchObject({ premise: { logline: "凡人靠小瓶求长生。", theme: ["长生"] } });

      const worldResponse = await router.request("http://localhost/api/books/book-1/bible/world-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ economy: { currency: "灵石" }, powerSystem: { levelTiers: ["练气", "筑基"] } }),
      });
      expect(worldResponse.status).toBe(200);
      expect(await worldResponse.json()).toMatchObject({ worldModel: { economy: { currency: "灵石" } } });

      const conflictResponse = await postJson(router, "/api/books/book-1/bible/conflicts", {
        id: "conflict-1",
        name: "资源稀缺",
        type: "system-scarcity",
        scope: "main",
        priority: 1,
        stakes: "主角必须突破资源封锁。",
        evolutionPath: [{ chapter: 1, state: "escalating", summary: "资源被克扣" }],
        resolutionState: "escalating",
      });
      expect(conflictResponse.status).toBe(201);
      expect(await conflictResponse.json()).toMatchObject({ conflict: { id: "conflict-1", protagonistSide: [] } });

      const activeResponse = await router.request("http://localhost/api/books/book-1/bible/conflicts/active?chapter=5");
      expect(activeResponse.status).toBe(200);
      expect(await activeResponse.json()).toMatchObject({ conflicts: [{ id: "conflict-1" }] });

      const arcResponse = await postJson(router, "/api/books/book-1/bible/character-arcs", {
        id: "arc-1",
        characterId: "char-1",
        arcType: "成长",
        startingState: "凡人杂役",
        endingState: "独当一面",
        currentPosition: "学会保命",
      });
      expect(arcResponse.status).toBe(201);
      expect(await arcResponse.json()).toMatchObject({ characterArc: { id: "arc-1", keyTurningPoints: [] } });

      const previewResponse = await postJson(router, "/api/books/book-1/bible/preview-context", {
        currentChapter: 5,
        sceneText: "韩立遭遇资源稀缺。",
      });
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json();
      expect(preview.context.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(["conflict-1", "arc-1"]));
    } finally {
      storage.close();
    }
  });

  it("proposes and accepts CoreShift records through API", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });
      await router.request("http://localhost/api/books/book-1/bible/premise", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "premise-1", logline: "旧基线", tone: "稳健" }),
      });
      await postJson(router, "/api/books/book-1/bible/chapter-summaries", {
        id: "summary-1",
        chapterNumber: 1,
        title: "第一章",
        summary: "旧基线推动剧情。",
        metadata: { refs: ["premise-1"] },
      });

      const proposeResponse = await postJson(router, "/api/books/book-1/core-shifts", {
        id: "shift-1",
        targetType: "premise",
        targetId: "premise-1",
        fromSnapshot: { logline: "旧基线", tone: "稳健" },
        toSnapshot: { logline: "新基线", tone: "热血" },
        triggeredBy: "author",
        chapterAt: 3,
      });
      expect(proposeResponse.status).toBe(201);
      expect(await proposeResponse.json()).toMatchObject({ coreShift: { id: "shift-1", status: "proposed", affectedChapters: [1] } });

      const acceptResponse = await postJson(router, "/api/books/book-1/core-shifts/shift-1/accept", {});
      expect(acceptResponse.status).toBe(200);
      expect(await acceptResponse.json()).toMatchObject({ coreShift: { id: "shift-1", status: "applied" } });

      const listResponse = await router.request("http://localhost/api/books/book-1/core-shifts?status=applied");
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toMatchObject({ coreShifts: [{ id: "shift-1", status: "applied" }] });
    } finally {
      storage.close();
    }
  });

  it("lists questionnaire templates and submits or updates questionnaire responses", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });

      const listResponse = await router.request("http://localhost/api/questionnaires?tier=1&genre=玄幻");
      expect(listResponse.status).toBe(200);
      const listJson = await listResponse.json();
      expect(listJson.templates.map((template: { id: string }) => template.id)).toEqual(expect.arrayContaining(["tier1-common-premise", "tier1-xuanhuan-premise"]));

      const submitResponse = await postJson(router, "/api/books/book-1/questionnaires/tier1-common-premise/responses", {
        id: "response-1",
        answers: {
          logline: "凡人靠小瓶求长生",
          theme: "谨慎,长生",
          tone: "热血",
          "target-readers": "修仙读者",
          "unique-hook": "小瓶催熟资源",
          "genre-tags": "玄幻,修仙",
        },
      });
      expect(submitResponse.status).toBe(201);
      expect(await submitResponse.json()).toMatchObject({ response: { id: "response-1", status: "submitted" }, targetObjectId: expect.any(String) });

      const updateResponse = await router.request("http://localhost/api/books/book-1/questionnaires/tier1-common-premise/responses/response-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft", answers: { logline: "稍后补完" } }),
      });
      expect(updateResponse.status).toBe(200);
      expect(await updateResponse.json()).toMatchObject({ response: { id: "response-1", status: "draft" } });

      const suggestResponse = await postJson(router, "/api/books/book-1/questionnaires/tier1-common-premise/ai-suggest", {
        questionId: "logline",
        existingAnswers: {},
      });
      expect(suggestResponse.status).toBe(200);
      expect(await suggestResponse.json()).toMatchObject({ suggestion: { degraded: true } });
    } finally {
      storage.close();
    }
  });

  it("previews buildBibleContext and patches book settings", async () => {
    const storage = await createStorage();
    try {
      const router = createBibleRouter({ storage });
      await postJson(router, "/api/books/book-1/bible/characters", {
        id: "char-1",
        name: "韩立",
        aliases: ["韩老魔"],
        summary: "谨慎求长生。",
        visibilityRule: { type: "tracked" },
      });
      await postJson(router, "/api/books/book-1/bible/settings", {
        id: "setting-1",
        category: "power-system",
        name: "修炼体系",
        content: "资源决定突破。",
        visibilityRule: { type: "global" },
      });

      const previewResponse = await postJson(router, "/api/books/book-1/bible/preview-context", {
        currentChapter: 5,
        sceneText: "韩老魔正在修炼。",
      });
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.json()).toMatchObject({
        context: {
          mode: "dynamic",
          items: [{ id: "char-1" }, { id: "setting-1" }],
        },
      });

      const settingsResponse = await router.request("http://localhost/api/books/book-1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibleMode: "static", currentChapter: 8 }),
      });
      expect(settingsResponse.status).toBe(200);
      expect(await settingsResponse.json()).toMatchObject({ book: { bibleMode: "static", currentChapter: 8 } });
    } finally {
      storage.close();
    }
  });
});

async function postJson(router: ReturnType<typeof createBibleRouter>, path: string, body: unknown): Promise<Response> {
  return router.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
