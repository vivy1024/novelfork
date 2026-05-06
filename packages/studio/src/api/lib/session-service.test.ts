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
          deny: ["candidate.create_chapter"],
          ask: ["guided.exit"],
        },
      },
    });

    const persisted = await getSessionById(session.id);
    expect(persisted?.sessionConfig.toolPolicy).toEqual({
      allow: ["cockpit.*"],
      deny: ["candidate.create_chapter"],
      ask: ["guided.exit"],
    });
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
