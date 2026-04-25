import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository, createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core";

import { createJingweiRouter } from "./jingwei.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-studio-jingwei-route-${crypto.randomUUID()}`);
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

async function postJson(router: ReturnType<typeof createJingweiRouter>, path: string, body: unknown): Promise<Response> {
  return router.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Jingwei API routes", () => {
  it("applies templates and manages sections through CRUD routes", async () => {
    const storage = await createStorage();
    try {
      const router = createJingweiRouter({ storage });

      const applyResponse = await postJson(router, "/api/books/book-1/jingwei/templates/apply", { templateId: "enhanced" });
      expect(applyResponse.status).toBe(201);
      const applied = await applyResponse.json() as { sections: Array<{ id: string; key: string; name: string }> };
      expect(applied.sections.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要", "伏笔", "名场面", "核心记忆"]);

      const duplicateApply = await postJson(router, "/api/books/book-1/jingwei/templates/apply", { templateId: "enhanced" });
      expect(duplicateApply.status).toBe(200);
      expect(((await duplicateApply.json()) as { sections: unknown[] }).sections).toHaveLength(7);

      const peopleId = applied.sections[0]!.id;
      const updateResponse = await router.request(`http://localhost/api/books/book-1/jingwei/sections/${peopleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "角色",
          enabled: false,
          participatesInAi: false,
          fieldsJson: [{ id: "field-alias", key: "alias", label: "别名", type: "text", required: false }],
        }),
      });
      expect(updateResponse.status).toBe(200);
      expect(await updateResponse.json()).toMatchObject({ section: { name: "角色", enabled: false, participatesInAi: false } });

      const listResponse = await router.request("http://localhost/api/books/book-1/jingwei/sections");
      expect(listResponse.status).toBe(200);
      const listed = await listResponse.json() as { sections: Array<{ id: string; name: string }> };
      expect(listed.sections.find((section) => section.id === peopleId)).toMatchObject({ id: peopleId, name: "角色" });

      const deleteResponse = await router.request(`http://localhost/api/books/book-1/jingwei/sections/${peopleId}`, { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({ ok: true, id: peopleId });
      const afterDelete = await router.request("http://localhost/api/books/book-1/jingwei/sections");
      expect(((await afterDelete.json()) as { sections: Array<{ id: string }> }).sections.some((section) => section.id === peopleId)).toBe(false);
    } finally {
      storage.close();
    }
  });

  it("manages generic entries and filters by section", async () => {
    const storage = await createStorage();
    try {
      const router = createJingweiRouter({ storage });
      const sectionResponse = await postJson(router, "/api/books/book-1/jingwei/sections", {
        id: "section-people",
        key: "people",
        name: "人物",
        description: "人物关系",
        order: 1,
        defaultVisibility: "tracked",
      });
      expect(sectionResponse.status).toBe(201);

      const entryResponse = await postJson(router, "/api/books/book-1/jingwei/entries", {
        id: "entry-1",
        sectionId: "section-people",
        title: "韩立",
        contentMd: "谨慎求长生。",
        tags: ["主角"],
        aliases: ["韩老魔"],
        customFields: { realm: "练气" },
        relatedChapterNumbers: [1, 2],
        relatedEntryIds: [],
        visibilityRule: { type: "tracked", keywords: ["小瓶"] },
        tokenBudget: 512,
      });
      expect(entryResponse.status).toBe(201);
      expect(await entryResponse.json()).toMatchObject({ entry: { id: "entry-1", aliases: ["韩老魔"], customFields: { realm: "练气" } } });

      const listResponse = await router.request("http://localhost/api/books/book-1/jingwei/entries?sectionId=section-people");
      expect(await listResponse.json()).toMatchObject({ entries: [{ id: "entry-1", title: "韩立" }] });

      const updateResponse = await router.request("http://localhost/api/books/book-1/jingwei/entries/entry-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "韩天尊", participatesInAi: false }),
      });
      expect(updateResponse.status).toBe(200);
      expect(await updateResponse.json()).toMatchObject({ entry: { title: "韩天尊", participatesInAi: false } });

      const deleteResponse = await router.request("http://localhost/api/books/book-1/jingwei/entries/entry-1", { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({ ok: true, id: "entry-1" });
      expect(await (await router.request("http://localhost/api/books/book-1/jingwei/entries?sectionId=section-people")).json()).toEqual({ entries: [] });
    } finally {
      storage.close();
    }
  });

  it("returns structured errors for invalid book IDs and previews current jingwei context", async () => {
    const storage = await createStorage();
    try {
      const router = createJingweiRouter({ storage });
      const invalidResponse = await router.request("http://localhost/api/books/..bad/jingwei/sections");
      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toMatchObject({ error: { code: "INVALID_BOOK_ID" } });

      await postJson(router, "/api/books/book-1/jingwei/sections", {
        id: "section-memory",
        key: "core-memory",
        name: "核心记忆",
        description: "给 AI 常驻使用的小而硬书设",
        order: 1,
        defaultVisibility: "global",
      });
      await postJson(router, "/api/books/book-1/jingwei/entries", {
        id: "entry-memory",
        sectionId: "section-memory",
        title: "小瓶规则",
        contentMd: "小瓶可以催熟灵草。",
        visibilityRule: { type: "global", visibleAfterChapter: 1 },
        participatesInAi: true,
      });

      const previewResponse = await postJson(router, "/api/books/book-1/jingwei/preview-context", { currentChapter: 2 });
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.json()).toMatchObject({
        items: [{ entryId: "entry-memory", sectionName: "核心记忆", text: "【核心记忆】小瓶规则：小瓶可以催熟灵草。" }],
        totalTokens: expect.any(Number),
        droppedEntryIds: [],
        sectionStats: [{ sectionId: "section-memory", sectionName: "核心记忆", count: 1 }],
      });
    } finally {
      storage.close();
    }
  });
});
