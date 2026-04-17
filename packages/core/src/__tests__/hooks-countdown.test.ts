/**
 * Tests for hooks countdown system
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDB } from "../state/memory-db.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StoredHook } from "../state/memory-db.js";

describe("Hooks Countdown System", () => {
  let testDir: string;
  let db: MemoryDB;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "inkos-hooks-test-"));
    mkdirSync(join(testDir, "story"), { recursive: true });
    db = new MemoryDB(testDir);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create hook with expected resolve chapter", () => {
    const hook: StoredHook = {
      hookId: "test-hook-1",
      startChapter: 5,
      type: "plot",
      status: "pending",
      lastAdvancedChapter: 5,
      expectedPayoff: "主角发现真相",
      payoffTiming: "第15章",
      expectedResolveChapter: 15,
      notes: "重要伏笔",
    };

    db.upsertHook(hook);

    const retrieved = db.getHookById("test-hook-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.expectedResolveChapter).toBe(15);
    expect(retrieved?.hookId).toBe("test-hook-1");
  });

  it("should get all hooks", () => {
    const hooks: StoredHook[] = [
      {
        hookId: "hook-1",
        startChapter: 1,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 1,
        expectedPayoff: "伏笔1",
        expectedResolveChapter: 10,
        notes: "",
      },
      {
        hookId: "hook-2",
        startChapter: 3,
        type: "character",
        status: "pending",
        lastAdvancedChapter: 3,
        expectedPayoff: "伏笔2",
        expectedResolveChapter: 8,
        notes: "",
      },
      {
        hookId: "hook-3",
        startChapter: 5,
        type: "plot",
        status: "resolved",
        lastAdvancedChapter: 12,
        expectedPayoff: "伏笔3",
        expectedResolveChapter: 12,
        notes: "",
      },
    ];

    for (const hook of hooks) {
      db.upsertHook(hook);
    }

    const allHooks = db.getAllHooks();
    expect(allHooks).toHaveLength(3);
  });

  it("should get overdue hooks", () => {
    const hooks: StoredHook[] = [
      {
        hookId: "overdue-1",
        startChapter: 1,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 1,
        expectedPayoff: "应该在第5章回收",
        expectedResolveChapter: 5,
        notes: "",
      },
      {
        hookId: "overdue-2",
        startChapter: 2,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 2,
        expectedPayoff: "应该在第8章回收",
        expectedResolveChapter: 8,
        notes: "",
      },
      {
        hookId: "pending-1",
        startChapter: 5,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 5,
        expectedPayoff: "应该在第15章回收",
        expectedResolveChapter: 15,
        notes: "",
      },
    ];

    for (const hook of hooks) {
      db.upsertHook(hook);
    }

    const currentChapter = 10;
    const overdueHooks = db.getOverdueHooks(currentChapter);

    expect(overdueHooks).toHaveLength(2);
    expect(overdueHooks[0]?.hookId).toBe("overdue-1");
    expect(overdueHooks[1]?.hookId).toBe("overdue-2");
  });

  it("should get pending hooks (not yet due)", () => {
    const hooks: StoredHook[] = [
      {
        hookId: "pending-1",
        startChapter: 5,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 5,
        expectedPayoff: "应该在第15章回收",
        expectedResolveChapter: 15,
        notes: "",
      },
      {
        hookId: "pending-2",
        startChapter: 8,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 8,
        expectedPayoff: "应该在第20章回收",
        expectedResolveChapter: 20,
        notes: "",
      },
      {
        hookId: "overdue-1",
        startChapter: 1,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 1,
        expectedPayoff: "应该在第5章回收",
        expectedResolveChapter: 5,
        notes: "",
      },
    ];

    for (const hook of hooks) {
      db.upsertHook(hook);
    }

    const currentChapter = 10;
    const pendingHooks = db.getPendingHooks(currentChapter);

    expect(pendingHooks).toHaveLength(2);
    expect(pendingHooks[0]?.hookId).toBe("pending-1");
    expect(pendingHooks[1]?.hookId).toBe("pending-2");
  });

  it("should update hook status", () => {
    const hook: StoredHook = {
      hookId: "test-hook",
      startChapter: 5,
      type: "plot",
      status: "pending",
      lastAdvancedChapter: 5,
      expectedPayoff: "测试伏笔",
      expectedResolveChapter: 15,
      notes: "",
    };

    db.upsertHook(hook);
    db.updateHookStatus("test-hook", "resolved");

    const updated = db.getHookById("test-hook");
    expect(updated?.status).toBe("resolved");
  });

  it("should delete hook", () => {
    const hook: StoredHook = {
      hookId: "delete-me",
      startChapter: 5,
      type: "plot",
      status: "pending",
      lastAdvancedChapter: 5,
      expectedPayoff: "将被删除",
      expectedResolveChapter: 15,
      notes: "",
    };

    db.upsertHook(hook);
    expect(db.getHookById("delete-me")).not.toBeNull();

    db.deleteHook("delete-me");
    expect(db.getHookById("delete-me")).toBeNull();
  });

  it("should calculate remaining chapters correctly", () => {
    const hook: StoredHook = {
      hookId: "countdown-test",
      startChapter: 5,
      type: "plot",
      status: "pending",
      lastAdvancedChapter: 5,
      expectedPayoff: "倒计时测试",
      expectedResolveChapter: 15,
      notes: "",
    };

    db.upsertHook(hook);

    const currentChapter = 10;
    const retrieved = db.getHookById("countdown-test");
    const remainingChapters = retrieved?.expectedResolveChapter
      ? retrieved.expectedResolveChapter - currentChapter
      : null;

    expect(remainingChapters).toBe(5);
  });

  it("should handle hooks without expected resolve chapter", () => {
    const hook: StoredHook = {
      hookId: "no-deadline",
      startChapter: 5,
      type: "plot",
      status: "pending",
      lastAdvancedChapter: 5,
      expectedPayoff: "无截止日期",
      notes: "",
    };

    db.upsertHook(hook);

    const retrieved = db.getHookById("no-deadline");
    // SQLite returns null for undefined fields
    expect(retrieved?.expectedResolveChapter).toBeNull();

    const currentChapter = 10;
    const remainingChapters = retrieved?.expectedResolveChapter
      ? retrieved.expectedResolveChapter - currentChapter
      : null;
    expect(remainingChapters).toBeNull();
  });

  it("should sort overdue hooks by expected resolve chapter", () => {
    const hooks: StoredHook[] = [
      {
        hookId: "overdue-3",
        startChapter: 3,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 3,
        expectedPayoff: "最晚逾期",
        expectedResolveChapter: 9,
        notes: "",
      },
      {
        hookId: "overdue-1",
        startChapter: 1,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 1,
        expectedPayoff: "最早逾期",
        expectedResolveChapter: 5,
        notes: "",
      },
      {
        hookId: "overdue-2",
        startChapter: 2,
        type: "plot",
        status: "pending",
        lastAdvancedChapter: 2,
        expectedPayoff: "中间逾期",
        expectedResolveChapter: 7,
        notes: "",
      },
    ];

    for (const hook of hooks) {
      db.upsertHook(hook);
    }

    const currentChapter = 10;
    const overdueHooks = db.getOverdueHooks(currentChapter);

    expect(overdueHooks).toHaveLength(3);
    expect(overdueHooks[0]?.hookId).toBe("overdue-1");
    expect(overdueHooks[1]?.hookId).toBe("overdue-2");
    expect(overdueHooks[2]?.hookId).toBe("overdue-3");
  });
});
