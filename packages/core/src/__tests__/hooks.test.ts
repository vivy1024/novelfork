import { describe, it, expect, beforeEach } from "vitest";
import { HookManager } from "../hooks/hook-manager.js";
import { createNotificationHook as createBuiltinNotificationHook } from "../hooks/builtin-hooks.js";
import type { HookContext, PipelineStage } from "../hooks/types.js";
import type { BookConfig } from "../models/book.js";

describe("HookManager", () => {
  let hookManager: HookManager;

  beforeEach(() => {
    hookManager = new HookManager();
  });

  it("should register and execute hooks", async () => {
    const calls: string[] = [];

    hookManager.register("before-write", async (ctx) => {
      calls.push(`before-write:${ctx.chapterNumber}`);
    });

    hookManager.register("after-write", async (ctx) => {
      calls.push(`after-write:${ctx.chapterNumber}`);
    });

    const ctx: HookContext = {
      book: { id: "test", title: "Test Book" } as BookConfig,
      chapterNumber: 1,
      stage: "before-write",
      metadata: {},
      timestamp: new Date(),
    };

    await hookManager.execute("before-write", ctx);
    await hookManager.execute("after-write", { ...ctx, stage: "after-write" });

    expect(calls).toEqual(["before-write:1", "after-write:1"]);
  });

  it("should handle multiple hooks for same stage", async () => {
    const calls: string[] = [];

    hookManager.register("before-write", async () => {
      calls.push("hook1");
    });

    hookManager.register("before-write", async () => {
      calls.push("hook2");
    });

    const ctx: HookContext = {
      book: { id: "test", title: "Test Book" } as BookConfig,
      chapterNumber: 1,
      stage: "before-write",
      metadata: {},
      timestamp: new Date(),
    };

    await hookManager.execute("before-write", ctx);

    expect(calls).toContain("hook1");
    expect(calls).toContain("hook2");
  });

  it("should not throw if hook fails", async () => {
    hookManager.register("before-write", async () => {
      throw new Error("Hook failed");
    });

    const ctx: HookContext = {
      book: { id: "test", title: "Test Book" } as BookConfig,
      chapterNumber: 1,
      stage: "before-write",
      metadata: {},
      timestamp: new Date(),
    };

    // Should not throw
    await expect(hookManager.execute("before-write", ctx)).resolves.toBeUndefined();
  });

  it("should share metadata across hooks", async () => {
    hookManager.register("before-write", async (ctx) => {
      ctx.metadata.value = 42;
    });

    hookManager.register("after-write", async (ctx) => {
      expect(ctx.metadata.value).toBe(42);
    });

    const metadata = {};
    const ctx: HookContext = {
      book: { id: "test", title: "Test Book" } as BookConfig,
      chapterNumber: 1,
      stage: "before-write",
      metadata,
      timestamp: new Date(),
    };

    await hookManager.execute("before-write", ctx);
    await hookManager.execute("after-write", { ...ctx, stage: "after-write" });
  });

  it("should return correct hook count", () => {
    hookManager.register("before-write", async () => {});
    hookManager.register("before-write", async () => {});
    hookManager.register("after-write", async () => {});

    expect(hookManager.getHookCount("before-write")).toBe(2);
    expect(hookManager.getHookCount("after-write")).toBe(1);
    expect(hookManager.getHookCount("before-audit")).toBe(0);
  });

  it("should clear all hooks", () => {
    hookManager.register("before-write", async () => {});
    hookManager.register("after-write", async () => {});

    hookManager.clear();

    expect(hookManager.getHookCount("before-write")).toBe(0);
    expect(hookManager.getHookCount("after-write")).toBe(0);
  });
});

describe("createBuiltinNotificationHook", () => {
  it("should create notification hook for chapter-complete", async () => {
    const mockChannels = [
      {
        type: "telegram" as const,
        botToken: "test-token",
        chatId: "test-chat",
      },
    ];

    const hooks = createBuiltinNotificationHook(mockChannels);
    expect(hooks.onChapterComplete).toBeDefined();
    expect(hooks.onChapterFailed).toBeDefined();
  });
});
