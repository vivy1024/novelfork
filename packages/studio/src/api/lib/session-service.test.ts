import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("./user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => ({
    runtimeControls: {
      defaultPermissionMode: "ask",
      defaultReasoningEffort: "high",
    },
    modelDefaults: {
      defaultSessionModel: "openai:gpt-4-turbo",
      summaryModel: "anthropic:claude-haiku-4-5",
      subagentModelPool: ["openai:gpt-4-turbo", "deepseek:deepseek-chat"],
    },
  })),
}));

async function loadSessionService() {
  return import("./session-service");
}

describe("session-service", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-service-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
  });

  afterEach(async () => {
    const { __testing } = await loadSessionService();
    __testing.resetSessionStoreMutationQueue();
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("uses runtime control defaults when creating sessions", async () => {
    const { createSession } = await loadSessionService();
    const session = await createSession({
      title: "Runtime Defaults",
      agentId: "planner",
    });

    expect(session.sessionConfig.permissionMode).toBe("ask");
    expect(session.sessionConfig.reasoningEffort).toBe("high");
    expect(session.sessionConfig.providerId).toBe("openai");
    expect(session.sessionConfig.modelId).toBe("gpt-4-turbo");
  });

  it("persists session tool policy in session config updates", async () => {
    const { createSession, getSessionById, updateSession } = await loadSessionService();
    const session = await createSession({ title: "Policy Session", agentId: "writer" });

    await updateSession(session.id, {
      sessionConfig: {
        toolPolicy: {
          allow: ["cockpit.*"],
          deny: ["pipeline.revise"],
          ask: ["guided.exit"],
        },
      },
    });

    const persisted = await getSessionById(session.id);
    expect(persisted?.sessionConfig.toolPolicy).toEqual({
      allow: ["cockpit.*"],
      deny: ["pipeline.revise"],
      ask: ["guided.exit"],
    });
  });

  it("rolls back history and the session tombstone together when persistence deletion fails, then exposes retryable diagnostics", async () => {
    const { createSession, deleteSessionWithRuntimeReport, getSessionById, __testing } = await loadSessionService();
    const { loadSessionChatHistory, saveSessionChatHistory } = await import("./session-history-store.js");
    const session = await createSession({ title: "Atomic Delete", agentId: "writer" });
    await saveSessionChatHistory(session.id, [{
      id: "delete-atomic-message",
      role: "user",
      content: "must survive rollback",
      timestamp: 1,
      seq: 1,
    }]);
    __testing.setSessionDeleteTransactionHook(() => {
      throw new Error("injected delete failure");
    });

    const failed = await deleteSessionWithRuntimeReport(session.id);

    expect(failed).toMatchObject({
      deleted: false,
      error: "persistence-delete-failed",
      diagnostic: expect.stringContaining("injected delete failure"),
    });
    expect(await getSessionById(session.id)).not.toBeNull();
    expect(await loadSessionChatHistory(session.id)).toEqual([
      expect.objectContaining({ id: "delete-atomic-message", content: "must survive rollback" }),
    ]);

    __testing.setSessionDeleteTransactionHook(undefined);
    await expect(deleteSessionWithRuntimeReport(session.id)).resolves.toMatchObject({ deleted: true });
  });

  it("shares one atomic delete operation across concurrent callers", async () => {
    const { createSession, deleteSessionWithRuntimeReport } = await loadSessionService();
    const session = await createSession({ title: "Concurrent Delete", agentId: "writer" });

    const firstDelete = deleteSessionWithRuntimeReport(session.id);
    const secondDelete = deleteSessionWithRuntimeReport(session.id);
    expect(secondDelete).toBe(firstDelete);
    const [first, second] = await Promise.all([firstDelete, secondDelete]);

    expect(first).toMatchObject({ deleted: true });
    expect(second).toEqual(first);
  });

  it("persists concurrent session updates through SQLite without sessions.json", async () => {
    const { createSession, getSessionById, updateSession } = await loadSessionService();
    const session = await createSession({
      title: "Queued Session",
      agentId: "writer",
    });

    const [, updatedSession] = await Promise.all([
      updateSession(session.id, { messageCount: 1 }),
      updateSession(session.id, { messageCount: 2 }),
    ]);

    expect(updatedSession?.messageCount).toBeGreaterThanOrEqual(1);
    const persisted = await getSessionById(session.id);
    expect(persisted?.messageCount).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(sessionStoreDir, "novelfork.db"))).toBe(true);
    expect(existsSync(join(sessionStoreDir, "sessions.json"))).toBe(false);
  });
});
