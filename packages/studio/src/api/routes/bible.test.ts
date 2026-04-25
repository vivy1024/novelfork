import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository, createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core";

import { createBibleRouter } from "./bible.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-studio-bible-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
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
          items: [{ id: "setting-1" }, { id: "char-1" }],
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
