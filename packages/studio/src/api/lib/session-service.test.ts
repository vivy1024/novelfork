import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { createSession } from "./session-service";

describe("session-service", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-service-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
  });

  afterEach(async () => {
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("uses runtime control defaults when creating sessions", async () => {
    const session = await createSession({
      title: "Runtime Defaults",
      agentId: "planner",
    });

    expect(session.sessionConfig.permissionMode).toBe("ask");
    expect(session.sessionConfig.reasoningEffort).toBe("high");
    expect(session.sessionConfig.providerId).toBe("openai");
    expect(session.sessionConfig.modelId).toBe("gpt-4-turbo");
  });
});
