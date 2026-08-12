import crypto from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { AuditResult } from "../../agents/continuity.js";
import { recordChapterCompletion } from "../writing-log.js";
import { persistChapterAuditLog } from "./audit-log-persist.js";
import { buildBookHealthSummary } from "./book-health-summary.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function createTestStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-health-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

function seedBook(storage: StorageDatabase, bookId: string): void {
  storage.sqlite.prepare(
    "INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at) VALUES (?, ?, 'static', 0, ?, ?)",
  ).run(bookId, "测试书", Date.now(), Date.now());
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("章节健康统计", () => {
  it("将章节审计结果写入 chapter_audit_log", async () => {
    const storage = await createTestStorage();
    seedBook(storage, "book-1");
    const auditResult: AuditResult = {
      passed: false,
      issues: [
        { severity: "critical", category: "ai-tell", description: "AI 味线索较多", suggestion: "人工改写" },
        { severity: "warning", category: "hook-debt", description: "伏笔未回收", suggestion: "检查伏笔" },
        { severity: "info", category: "sensitive-word", description: "敏感词线索", suggestion: "核对语境" },
      ],
      summary: "需要人工复核",
    };

    persistChapterAuditLog(storage, { bookId: "book-1", chapterNumber: 1, auditResult });

    const rows = storage.sqlite.prepare(
      "SELECT * FROM chapter_audit_log WHERE book_id = ?",
    ).all("book-1") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chapter_number: 1,
      continuity_passed: 0,
      continuity_issue_count: 3,
      ai_taste_score: 1,
      summary: "需要人工复核",
    });
  });

  it("以已接受章节的内部写入记录汇总书籍健康数据", async () => {
    const storage = await createTestStorage();
    seedBook(storage, "book-1");

    await recordChapterCompletion(storage, {
      bookId: "book-1", chapterNumber: 1, wordCount: 3000,
      completedAt: "2026-04-26T10:00:00Z", date: "2026-04-26",
    });
    await recordChapterCompletion(storage, {
      bookId: "book-1", chapterNumber: 2, wordCount: 4000,
      completedAt: "2026-04-27T10:00:00Z", date: "2026-04-27",
    });
    persistChapterAuditLog(storage, {
      bookId: "book-1",
      chapterNumber: 1,
      auditResult: {
        passed: true,
        issues: [{ severity: "warning", category: "sensitive-word", description: "d", suggestion: "s" }],
        summary: "ok",
      },
    });
    persistChapterAuditLog(storage, {
      bookId: "book-1",
      chapterNumber: 2,
      auditResult: {
        passed: false,
        issues: [
          { severity: "critical", category: "ai-tell", description: "d", suggestion: "s" },
          { severity: "warning", category: "sensitive-word", description: "d", suggestion: "s" },
        ],
        summary: "needs-review",
      },
    });

    const summary = buildBookHealthSummary(storage, "book-1");
    expect(summary.totalChapters).toBe(2);
    expect(summary.totalWords).toBe(7000);
    expect(summary.consistencyScore).toBe(0.5);
    expect(summary.aiTasteTrend).toHaveLength(2);
    expect(summary.sensitiveWordTotal).toBe(2);
  });
});
