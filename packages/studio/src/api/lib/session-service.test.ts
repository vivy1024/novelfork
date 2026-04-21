import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("serializes concurrent session updates before writing sessions.json", async () => {
    const { __testing, createSession, updateSession } = await loadSessionService();
    const session = await createSession({
      title: "Queued Session",
      agentId: "writer",
    });

    let releaseFirstMutation: (() => void) | undefined;
    let firstMutationPending = true;
    let mutationEntries = 0;
    const firstMutationGate = new Promise<void>((resolve) => {
      releaseFirstMutation = resolve;
    });

    __testing.setSessionStoreMutationHook(async () => {
      mutationEntries += 1;
      if (firstMutationPending) {
        firstMutationPending = false;
        await firstMutationGate;
      }
    });

    const firstUpdate = updateSession(session.id, { messageCount: 1 });
    await Promise.resolve();
    const secondUpdate = updateSession(session.id, { messageCount: 2 });
    await Promise.resolve();

    expect(mutationEntries).toBe(1);

    releaseFirstMutation?.();
    const [, updatedSession] = await Promise.all([firstUpdate, secondUpdate]);
    expect(updatedSession?.messageCount).toBe(2);
    expect(mutationEntries).toBe(2);

    const persistedRecords = JSON.parse(
      await readFile(join(sessionStoreDir, "sessions.json"), "utf-8"),
    ) as Array<{ id: string; messageCount: number }>;
    expect(persistedRecords.find((record) => record.id === session.id)?.messageCount).toBe(2);
  });
});
