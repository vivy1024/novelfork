import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { persistChapterAuditLog } from "../tools/health/audit-log-persist.js";
import { buildBookHealthSummary } from "../tools/health/book-health-summary.js";
import { recordChapterCompletion } from "../tools/progress/daily-tracker.js";
import type { AuditResult } from "../agents/continuity.js";

const tempDirs: string[] = [];

async function createTestStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-health-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

async function seedBook(storage: StorageDatabase, bookId: string): Promise<void> {
  storage.sqlite.exec(
    `INSERT INTO "book" ("id", "name", "bible_mode", "current_chapter", "created_at", "updated_at")
     VALUES ('${bookId}', 'test', 'static', 0, ${Date.now()}, ${Date.now()})`,
  );
}

afterEach(() => {
  tempDirs.length = 0;
});

describe("Task 13: hookSuggestionAvailable in ChapterPipelineResult", () => {
  it("ChapterPipelineResult type includes hookSuggestionAvailable", async () => {
    // Type-level check: import the type and verify it compiles with the field
    const result: import("../pipeline/runner.js").ChapterPipelineResult = {
      chapterNumber: 1,
      title: "test",
      wordCount: 3000,
      auditResult: { passed: true, issues: [], summary: "" },
      revised: false,
      status: "ready-for-review",
      hookSuggestionAvailable: true,
    };
    expect(result.hookSuggestionAvailable).toBe(true);
  });
});

describe("Task 15: chapter audit log persistence", () => {
  it("persists audit log to chapter_audit_log table", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    const auditResult: AuditResult = {
      passed: false,
      issues: [
        { severity: "critical", category: "ai-tell", description: "AI味过重", suggestion: "修改" },
        { severity: "warning", category: "hook-debt", description: "伏笔未回收", suggestion: "回收" },
        { severity: "info", category: "sensitive-word", description: "敏感词", suggestion: "替换" },
      ],
      summary: "审计未通过",
    };

    persistChapterAuditLog(storage, {
      bookId: "book-1",
      chapterNumber: 1,
      auditResult,
    });

    const rows = storage.sqlite.prepare(
      `SELECT * FROM chapter_audit_log WHERE book_id = ?`,
    ).all("book-1") as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.chapter_number).toBe(1);
    expect(rows[0]!.continuity_passed).toBe(0);
    expect(rows[0]!.continuity_issue_count).toBe(3);
    expect(rows[0]!.ai_taste_score).toBe(1);
    expect(rows[0]!.summary).toBe("审计未通过");
  });

  it("persists passed audit with zero issues", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    persistChapterAuditLog(storage, {
      bookId: "book-1",
      chapterNumber: 1,
      auditResult: { passed: true, issues: [], summary: "通过" },
    });

    const rows = storage.sqlite.prepare(
      `SELECT * FROM chapter_audit_log WHERE book_id = ?`,
    ).all("book-1") as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.continuity_passed).toBe(1);
    expect(rows[0]!.continuity_issue_count).toBe(0);
  });
});

describe("Task 16: book health summary aggregation", () => {
  it("returns default values for empty book", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    const summary = buildBookHealthSummary(storage, "book-1");

    expect(summary.totalChapters).toBe(0);
    expect(summary.totalWords).toBe(0);
    expect(summary.consistencyScore).toBe(1);
    expect(summary.hookRecoveryRate).toBe(1);
    expect(summary.aiTasteAvg).toBe(0);
    expect(summary.aiTasteTrend).toEqual([]);
    expect(summary.sensitiveWordTotal).toBe(0);
  });

  it("aggregates across multiple chapters", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    // Seed writing logs
    await recordChapterCompletion(storage, {
      bookId: "book-1", chapterNumber: 1, wordCount: 3000,
      completedAt: "2026-04-26T10:00:00Z", date: "2026-04-26",
    });
    await recordChapterCompletion(storage, {
      bookId: "book-1", chapterNumber: 2, wordCount: 4000,
      completedAt: "2026-04-27T10:00:00Z", date: "2026-04-27",
    });

    // Seed audit logs
    persistChapterAuditLog(storage, {
      bookId: "book-1",
      chapterNumber: 1,
      auditResult: {
        passed: true, issues: [
          { severity: "warning", category: "sensitive-word", description: "d", suggestion: "s" },
        ], summary: "ok",
      },
    });
    persistChapterAuditLog(storage, {
      bookId: "book-1",
      chapterNumber: 2,
      auditResult: {
        passed: false, issues: [
          { severity: "critical", category: "ai-tell", description: "d", suggestion: "s" },
          { severity: "warning", category: "sensitive-word", description: "d", suggestion: "s" },
        ], summary: "fail",
      },
    });

    const summary = buildBookHealthSummary(storage, "book-1");

    expect(summary.totalChapters).toBe(2);
    expect(summary.totalWords).toBe(7000);
    expect(summary.consistencyScore).toBe(0.5); // 1 passed out of 2
    expect(summary.aiTasteTrend).toHaveLength(2);
    expect(summary.sensitiveWordTotal).toBe(2);
  });
});
