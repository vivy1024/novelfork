import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { chapterContentFingerprint } from "../narrative-memory/settlement-idempotency.js";
import { readChapterIndex } from "./chapter-layout.js";
import { createWritingResourceService } from "./service.js";

const tempDirs: string[] = [];
const BOOK_ID = "book-1";

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-chapter-reconcile-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const timestamp = Date.now();
  storage.sqlite.prepare(
    "INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at) VALUES (?, ?, 'static', 0, ?, ?)",
  ).run(BOOK_ID, "测试书籍", timestamp, timestamp);
  return storage;
}

async function createBookDir(): Promise<string> {
  const dir = join(tmpdir(), `novelfork-reconcile-book-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** 模拟绕过产品层的写入（叙述者通用工具、Runtime 编辑器、外部编辑器），并把修改时间推到记录之后。 */
async function writeExternally(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  const later = new Date(Date.now() + 5_000);
  await utimes(path, later, later);
}

function writingLogTotal(storage: StorageDatabase): number {
  return storage.sqlite.prepare<{ total: number }>(
    "SELECT COALESCE(SUM(word_count), 0) AS total FROM writing_log WHERE book_id = ?",
  ).get(BOOK_ID)?.total ?? 0;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("章节文件对账", () => {
  it("产品层自己写入的章节不会被误判为外部改动", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir });
      const created = await service.create(BOOK_ID, { type: "chapter", status: "accepted", title: "山门", content: "字".repeat(100) });
      await service.update(BOOK_ID, created.id, { content: "字".repeat(150) });

      await expect(service.reconcileChapters(BOOK_ID)).resolves.toEqual([]);
      expect(writingLogTotal(storage)).toBe(150);
    } finally {
      storage.close();
    }
  });

  it("外部改写后补记字数增量并更新索引，重复对账不再计入", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir });
      await service.create(BOOK_ID, { type: "chapter", status: "accepted", title: "山门", content: "字".repeat(100) });
      const path = join(bookDir, "chapters", "卷01", "0001_山门.md");
      await writeExternally(path, `# 山门\n\n${"字".repeat(400)}`);

      const changes = await service.reconcileChapters(BOOK_ID);
      expect(changes).toEqual([
        expect.objectContaining({
          chapterNumber: 1,
          kind: "modified",
          relativePath: "chapters/卷01/0001_山门.md",
          previousWordCount: 100,
          wordCount: 400,
        }),
      ]);
      expect(writingLogTotal(storage)).toBe(400);
      const [entry] = await readChapterIndex(bookDir);
      expect(entry).toEqual(expect.objectContaining({ wordCount: 400, contentHash: chapterContentFingerprint(await readFile(path, "utf8")) }));
      expect(entry?.fileModifiedAt).toBe(Math.floor((await stat(path)).mtimeMs));

      await expect(service.reconcileChapters(BOOK_ID)).resolves.toEqual([]);
      expect(writingLogTotal(storage)).toBe(400);
      await expect(service.findAcceptedChapter(BOOK_ID, 1)).resolves.toEqual(expect.objectContaining({ wordCount: 400 }));
    } finally {
      storage.close();
    }
  });

  it("外部删减正文只更新字数，不记负数", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir });
      await service.create(BOOK_ID, { type: "chapter", status: "accepted", title: "山门", content: "字".repeat(300) });
      await writeExternally(join(bookDir, "chapters", "卷01", "0001_山门.md"), "字".repeat(120));

      const [change] = await service.reconcileChapters(BOOK_ID);
      expect(change).toEqual(expect.objectContaining({ previousWordCount: 300, wordCount: 120 }));
      expect(writingLogTotal(storage)).toBe(300);
    } finally {
      storage.close();
    }
  });

  it("外部新建的章节文件按从零新增计入", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir });
      await service.create(BOOK_ID, { type: "chapter", status: "accepted", title: "山门", content: "字".repeat(100) });
      await mkdir(join(bookDir, "chapters", "卷01"), { recursive: true });
      await writeExternally(join(bookDir, "chapters", "卷01", "0002_夜雪.md"), `# 夜雪\n\n${"雪".repeat(250)}`);

      const changes = await service.reconcileChapters(BOOK_ID);
      expect(changes).toEqual([
        expect.objectContaining({ chapterNumber: 2, kind: "created", previousWordCount: 0, wordCount: 250 }),
      ]);
      expect(writingLogTotal(storage)).toBe(350);
      await expect(service.reconcileChapters(BOOK_ID)).resolves.toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("只改了修改时间、正文没变不算变更", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir });
      const content = "字".repeat(100);
      await service.create(BOOK_ID, { type: "chapter", status: "accepted", title: "山门", content });
      await writeExternally(join(bookDir, "chapters", "卷01", "0001_山门.md"), content);

      await expect(service.reconcileChapters(BOOK_ID)).resolves.toEqual([]);
      expect(writingLogTotal(storage)).toBe(100);
    } finally {
      storage.close();
    }
  });

  it("外部改写后把按旧正文做的审计标记为过期", async () => {
    const storage = await createStorage();
    const bookDir = await createBookDir();
    try {
      const service = createWritingResourceService({ storage, resolveBookDir: () => bookDir });
      const original = "字".repeat(100);
      await service.create(BOOK_ID, { type: "chapter", status: "accepted", title: "山门", content: original });
      storage.sqlite.prepare(
        "INSERT INTO chapter_audit_log (book_id, chapter_number, audited_at, content_fingerprint) VALUES (?, 1, ?, ?)",
      ).run(BOOK_ID, new Date().toISOString(), chapterContentFingerprint(original));

      await writeExternally(join(bookDir, "chapters", "卷01", "0001_山门.md"), `${original}改`);
      await service.reconcileChapters(BOOK_ID);

      const row = storage.sqlite.prepare<{ stale: number }>(
        "SELECT stale FROM chapter_audit_log WHERE book_id = ? AND chapter_number = 1",
      ).get(BOOK_ID);
      expect(row?.stale).toBe(1);
    } finally {
      storage.close();
    }
  });
});
