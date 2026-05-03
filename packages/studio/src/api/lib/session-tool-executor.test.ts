import { describe, expect, it, vi } from "vitest";
import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";
import { createCockpitService } from "./cockpit-service.js";

function input(overrides: Partial<SessionToolExecutionInput> = {}): SessionToolExecutionInput {
  return {
    sessionId: "session-1",
    toolName: "cockpit.get_snapshot",
    input: { bookId: "book-1" },
    permissionMode: "read",
    canvasContext: {
      activeTabId: "tab-1",
      activeResource: { kind: "chapter", id: "chapter-1", bookId: "book-1" },
    },
    ...overrides,
  };
}

describe("session tool executor", () => {
  it("returns an invalid-tool result for unknown tools without executing handlers", async () => {
    const fallbackHandler = vi.fn();
    const executor = createSessionToolExecutor({ handlers: { "cockpit.get_snapshot": fallbackHandler } });

    const result = await executor.execute(input({ toolName: "missing.tool" }));

    expect(result).toMatchObject({
      ok: false,
      error: "unknown-tool",
      summary: "未知 session tool：missing.tool",
    });
    expect(fallbackHandler).not.toHaveBeenCalled();
  });

  it("validates object schema required fields and additional properties before executing", async () => {
    const handler = vi.fn();
    const executor = createSessionToolExecutor({ handlers: { "cockpit.get_snapshot": handler } });

    await expect(executor.execute(input({ input: {} }))).resolves.toMatchObject({
      ok: false,
      error: "invalid-tool-input",
      summary: expect.stringContaining("bookId"),
    });
    await expect(executor.execute(input({ input: { bookId: "book-1", extra: true } }))).resolves.toMatchObject({
      ok: false,
      error: "invalid-tool-input",
      summary: expect.stringContaining("extra"),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks write-risk tools in read and plan modes", async () => {
    const handler = vi.fn();
    const executor = createSessionToolExecutor({ handlers: { "candidate.create_chapter": handler } });

    for (const permissionMode of ["read", "plan"] as const) {
      await expect(executor.execute(input({
        toolName: "candidate.create_chapter",
        permissionMode,
        input: { bookId: "book-1", chapterIntent: "写下一章" },
      }))).resolves.toMatchObject({
        ok: false,
        error: "permission-denied",
        summary: expect.stringContaining(permissionMode),
      });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("converts confirmed-write tools into pending confirmations without executing them", async () => {
    const handler = vi.fn();
    const executor = createSessionToolExecutor({ handlers: { "guided.exit": handler } });

    const result = await executor.execute(input({
      toolName: "guided.exit",
      permissionMode: "edit",
      input: {
        bookId: "book-1",
        sessionId: "session-1",
        guidedStateId: "guided-state-1",
        plan: { title: "第二章计划" },
      },
    }));

    expect(result).toMatchObject({
      ok: true,
      renderer: "guided.plan",
      data: { status: "pending-confirmation" },
      confirmation: {
        id: expect.any(String),
        toolName: "guided.exit",
        risk: "confirmed-write",
        target: "book-1",
        options: ["approve", "reject", "open-in-canvas"],
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks write-risk tools when the active canvas resource is dirty", async () => {
    const handler = vi.fn();
    const executor = createSessionToolExecutor({ handlers: { "candidate.create_chapter": handler } });

    const result = await executor.execute(input({
      toolName: "candidate.create_chapter",
      permissionMode: "edit",
      input: { bookId: "book-1", chapterIntent: "写下一章" },
      canvasContext: {
        activeTabId: "chapter:book-1:2",
        activeResource: { kind: "chapter", id: "chapter:book-1:2", bookId: "book-1", title: "第二章 入城" },
        dirty: true,
      },
    }));

    expect(result).toMatchObject({
      ok: false,
      renderer: "candidate.created",
      error: "dirty-resource-blocked",
      data: {
        status: "dirty-resource-blocked",
        activeTabId: "chapter:book-1:2",
        activeResource: { id: "chapter:book-1:2", title: "第二章 入城" },
      },
    });
    expect(result.summary).toContain("未保存编辑");
    expect(handler).not.toHaveBeenCalled();
  });

  it("wraps handler exceptions as failed tool results without fake success", async () => {
    const executor = createSessionToolExecutor({
      handlers: {
        "cockpit.get_snapshot": async () => {
          throw new Error("storage offline");
        },
      },
    });

    await expect(executor.execute(input())).resolves.toMatchObject({
      ok: false,
      renderer: "cockpit.snapshot",
      error: "tool-execution-failed",
      summary: "工具 cockpit.get_snapshot 执行失败：storage offline",
    });
  });

  it("passes execution context to handlers and preserves renderer, artifact and duration", async () => {
    const executor = createSessionToolExecutor({
      handlers: {
        "cockpit.get_snapshot": async ({ input: toolInput, canvasContext, definition }) => ({
          ok: true,
          renderer: definition.renderer,
          summary: "已读取驾驶舱快照。",
          data: { bookId: toolInput.bookId, activeTabId: canvasContext?.activeTabId },
          artifact: {
            id: "artifact-cockpit-1",
            kind: "tool-result",
            title: "驾驶舱快照",
            renderer: definition.renderer,
            openInCanvas: true,
          },
        }),
      },
    });

    const result = await executor.execute(input());

    expect(result).toMatchObject({
      ok: true,
      renderer: "cockpit.snapshot",
      summary: "已读取驾驶舱快照。",
      data: { bookId: "book-1", activeTabId: "tab-1" },
      artifact: { id: "artifact-cockpit-1", openInCanvas: true },
    });
    expect(typeof result.durationMs).toBe("number");
  });

  it("wires narrative.read_line to the narrative line service", async () => {
    const narrativeService = {
      getSnapshot: vi.fn(async () => ({
        bookId: "book-1",
        nodes: [],
        edges: [],
        warnings: [],
        generatedAt: "2026-05-03T00:00:00.000Z",
      })),
    };
    const executor = createSessionToolExecutor({ narrativeService });

    const result = await executor.execute(input({
      toolName: "narrative.read_line",
      permissionMode: "read",
      input: { bookId: "book-1", includeWarnings: true },
    }));

    expect(narrativeService.getSnapshot).toHaveBeenCalledWith({ bookId: "book-1", includeWarnings: true });
    expect(result).toMatchObject({
      ok: true,
      renderer: "narrative.line",
      summary: "已读取叙事线快照。",
      narrative: { snapshot: { bookId: "book-1" } },
      artifact: { kind: "narrative-line", renderer: "narrative.line", openInCanvas: true },
    });
  });

  it("wires narrative.propose_change to mutation preview without confirmation in edit mode", async () => {
    const narrativeService = {
      getSnapshot: vi.fn(),
      proposeChange: vi.fn(async () => ({
        id: "preview-1",
        bookId: "book-1",
        summary: "补节点",
        nodes: [{ id: "node-1", bookId: "book-1", type: "event" as const, title: "补节点" }],
      })),
    };
    const executor = createSessionToolExecutor({ narrativeService });

    const result = await executor.execute(input({
      toolName: "narrative.propose_change",
      permissionMode: "edit",
      input: { bookId: "book-1", summary: "补节点", nodes: [{ id: "node-1", title: "补节点" }], reason: "补齐主线" },
    }));

    expect(narrativeService.proposeChange).toHaveBeenCalledWith({
      bookId: "book-1",
      summary: "补节点",
      nodes: [{ id: "node-1", title: "补节点" }],
      reason: "补齐主线",
    });
    expect(result).toMatchObject({
      ok: true,
      renderer: "narrative.mutationPreview",
      summary: "已生成叙事线变更草案。",
      narrative: { mutationPreview: { id: "preview-1", bookId: "book-1" } },
      artifact: { kind: "narrative-line", renderer: "narrative.mutationPreview", openInCanvas: true },
    });
  });

  it("wires default cockpit handlers to the shared cockpit service", async () => {
    const cockpitService = createCockpitService({
      state: {
        loadBookConfig: vi.fn().mockResolvedValue({
          id: "book-1",
          title: "天墟试炼",
          platform: "qidian",
          genre: "玄幻",
          status: "active",
          targetChapters: 100,
          chapterWordCount: 3000,
        }),
        loadChapterIndex: vi.fn().mockResolvedValue([]),
        bookDir: vi.fn(() => "D:/missing/book-1"),
      } as never,
      providerStore: { listProviders: vi.fn().mockResolvedValue([]), listPlatformAccounts: vi.fn().mockResolvedValue([]) } as never,
      now: () => new Date("2026-05-02T00:00:00.000Z"),
    });
    const executor = createSessionToolExecutor({ cockpitService });

    const snapshot = await executor.execute(input({ toolName: "cockpit.get_snapshot", input: { bookId: "book-1", includeModelStatus: true } }));
    const hooks = await executor.execute(input({ toolName: "cockpit.list_open_hooks", input: { bookId: "book-1", limit: 5 } }));
    const candidates = await executor.execute(input({ toolName: "cockpit.list_recent_candidates", input: { bookId: "book-1", limit: 5 } }));

    expect(snapshot).toMatchObject({
      ok: true,
      renderer: "cockpit.snapshot",
      summary: "已读取驾驶舱快照。",
      data: { status: "available", book: { id: "book-1" } },
      artifact: { kind: "tool-result", renderer: "cockpit.snapshot", openInCanvas: true },
    });
    expect(hooks).toMatchObject({ ok: true, renderer: "cockpit.openHooks", summary: "已读取 0 条开放伏笔。", data: { status: "empty", items: [] } });
    expect(candidates).toMatchObject({ ok: true, renderer: "cockpit.recentCandidates", summary: "已读取 0 条候选稿。", data: { status: "empty", items: [] } });
  });
});
