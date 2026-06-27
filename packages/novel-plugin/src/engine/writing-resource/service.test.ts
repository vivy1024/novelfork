import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeEvent } from "../narrative-memory/events.js";
import { createWritingResourceService, applyNarrativeEventsForChapterResult } from "./service.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-writing-resource-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

async function createBookDir(): Promise<string> {
  const dir = join(tmpdir(), `novelfork-book-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writing resource file-system service", () => {
  it("creates accepted chapters on disk and preserves chapter lookup", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir, now: () => 1_700_000_000_000 });

      const created = await service.create("book-1", {
        type: "chapter",
        status: "accepted",
        title: "第一章",
        content: "这是正式章节正文。",
      });

      expect(created.id).toBe("chapter:1");
      expect(created.chapterNumber).toBe(1);
      expect(created.status).toBe("accepted");
      await expect(readFile(join(bookDir, "chapters", "0001_第一章.md"), "utf-8")).resolves.toBe("这是正式章节正文。");
      await expect(service.getById("book-1", "chapter:1")).resolves.toEqual(expect.objectContaining({ title: "第一章", content: "这是正式章节正文。", chapterNumber: 1 }));
      await expect(service.findAcceptedChapter("book-1", 1)).resolves.toEqual(expect.objectContaining({ id: "chapter:1", status: "accepted" }));
    } finally {
      storage.close();
    }
  });

  it("requires explicit file-system book resolution", async () => {
    const storage = await createStorage();
    try {
      expect(() => createWritingResourceService({ storage, now: () => 1_700_000_000_000 })).toThrow("resolveBookDir is required");
    } finally {
      storage.close();
    }
  });

  it("updates and soft-deletes accepted chapters on disk", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir, now: () => 1_700_000_000_000 });
      const created = await service.create("book-1", {
        type: "chapter",
        status: "accepted",
        title: "第二章",
        content: "初始正文。",
      });

      const updated = await service.update("book-1", created.id, { title: "第二章修订", content: "修订正文。" });
      expect(updated).toEqual(expect.objectContaining({ title: "第二章修订", content: "修订正文。" }));
      await expect(readFile(join(bookDir, "chapters", "0001_第二章修订.md"), "utf-8")).resolves.toBe("修订正文。");

      const deleted = await service.softDelete("book-1", created.id);
      expect(deleted).toEqual(expect.objectContaining({ id: created.id }));
      await expect(service.findAcceptedChapter("book-1", 1)).resolves.toBeNull();
    } finally {
      storage.close();
    }
  });
});


describe("writing resource chapter-result narrative events", () => {
  it("persists chapter result narrativeEvents and applies low-risk events", async () => {
    const storage = await createStorage();
    try {
      const event = createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 12,
        eventType: "location_changed",
        subject: "韩立",
        predicate: "抵达",
        object: "药园",
        evidenceText: "韩立抵达药园。",
        confidence: 0.9,
        layer: "dynamic",
        source: "settle",
      });

      const result = await applyNarrativeEventsForChapterResult(storage, "book-1", { narrativeEvents: [event] });

      expect(result?.appliedEventIds).toEqual([event.id]);
      const factRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE subject = ? AND object = ?").get("韩立", "药园");
      expect(factRows?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("keeps high-risk canon/world narrativeEvents pending", async () => {
    const storage = await createStorage();
    try {
      const event = createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 12,
        eventType: "world_fact_introduced",
        subject: "小瓶",
        predicate: "能够",
        object: "催熟药草",
        evidenceText: "药草一夜成熟。",
        confidence: 0.95,
        layer: "canon",
        source: "settle",
      });

      const result = await applyNarrativeEventsForChapterResult(storage, "book-1", { narrativeEvents: [event] });

      expect(result?.pendingEventIds).toEqual([event.id]);
      const factRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get();
      expect(factRows?.count).toBe(0);
      const eventRow = storage.sqlite.prepare<{ status: string }>("SELECT status FROM narrative_event WHERE id = ?").get(event.id);
      expect(eventRow?.status).toBe("pending");
    } finally {
      storage.close();
    }
  });

  it("ignores absent or invalid narrativeEvents", async () => {
    const storage = await createStorage();
    try {
      await expect(applyNarrativeEventsForChapterResult(storage, "book-1", {})).resolves.toBeUndefined();
      await expect(applyNarrativeEventsForChapterResult(storage, "book-1", { narrativeEvents: "bad" })).resolves.toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("does not throw when narrativeEvents were already persisted", async () => {
    const storage = await createStorage();
    try {
      const event = createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 12,
        eventType: "location_changed",
        subject: "韩立",
        predicate: "抵达",
        object: "药园",
        evidenceText: "韩立抵达药园。",
        confidence: 0.9,
        layer: "dynamic",
        source: "settle",
      });
      await applyNarrativeEventsForChapterResult(storage, "book-1", { narrativeEvents: [event] });

      await expect(applyNarrativeEventsForChapterResult(storage, "book-1", { narrativeEvents: [event] })).resolves.toEqual(expect.objectContaining({ failedEvents: [] }));
    } finally {
      storage.close();
    }
  });
});
