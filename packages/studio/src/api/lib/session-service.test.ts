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

import { createSession, deleteSession, getSessionById } from "./session-service";
import { attachSessionChatTransport, handleSessionChatTransportMessage } from "./session-chat-service";

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

  it("removes the corresponding history file when deleting a session", async () => {
    const session = await createSession({
      title: "Delete History",
      agentId: "writer",
    });
    const transport = {
      send() {},
      close() {},
    };

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        messageId: "delete-history-message-1",
        content: "先写一条历史",
      }),
    );

    const historyFilePath = join(sessionStoreDir, "session-history", `${session.id}.json`);
    expect(existsSync(historyFilePath)).toBe(true);

    const deleted = await deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(existsSync(historyFilePath)).toBe(false);
  });

  it("does not recreate history when delete and message run concurrently", async () => {
    const session = await createSession({
      title: "Delete Race",
      agentId: "writer",
    });
    const transport = {
      send() {},
      close() {},
    };

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        messageId: "delete-race-message-1",
        content: "先写一条历史",
      }),
    );

    const historyFilePath = join(sessionStoreDir, "session-history", `${session.id}.json`);
    expect(existsSync(historyFilePath)).toBe(true);

    await Promise.all([
      deleteSession(session.id),
      handleSessionChatTransportMessage(
        session.id,
        transport,
        JSON.stringify({
          messageId: "delete-race-message-2",
          content: "删除时的消息",
        }),
      ),
    ]);

    expect(await getSessionById(session.id)).toBeNull();
    expect(existsSync(historyFilePath)).toBe(false);
  });
});
