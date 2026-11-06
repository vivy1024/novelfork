import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { reportStaleChapterRows } from "./stale-chapter-rows";

const dirs: string[] = [];
const storages: StorageDatabase[] = [];

afterEach(async () => {
  storages.splice(0).forEach((storage) => storage.close());
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("过时旧章节行报告", () => {
  it("只列软删除与归档的章节行，统计正文字节；不改动任何行", async () => {
    const dir = join(tmpdir(), `novelfork-stale-chapters-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    dirs.push(dir);
    const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
    storages.push(storage);
    runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
    const insert = storage.sqlite.prepare(
      `INSERT INTO writing_resource (id, book_id, type, status, title, content, chapter_number, version, created_at, updated_at, deleted_at)
       VALUES (?, 'book-1', ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
    );
    insert.run("live", "chapter", "accepted", "在用", "正文", 1, 1, null);
    insert.run("deleted", "chapter", "accepted", "删了", "旧正文", 1, 2, 123);
    insert.run("archived", "chapter", "archived", "归档", "abc", 2, 1, null);
    insert.run("draft", "draft", "accepted", "草稿", "不是章节", null, 1, 456);

    const report = reportStaleChapterRows(storage);
    expect(report.dryRun).toBe(true);
    expect(report.rows.map((row) => [row.id, row.reason])).toEqual([
      ["deleted", "soft-deleted"],
      ["archived", "archived"],
    ]);
    expect(report.totalContentBytes).toBe(Buffer.byteLength("旧正文") + 3);
    expect(report.liveRows).toBe(1);
    expect(storage.sqlite.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM writing_resource`).get()!.n).toBe(4);
    expect(reportStaleChapterRows(storage, { bookId: "other" }).rows).toEqual([]);
  });
});
