import { describe, expect, it, vi } from "vitest";
import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";

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
});
