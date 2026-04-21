import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSession } from "../lib/session-service";
import { attachSessionChatTransport, handleSessionChatTransportMessage } from "../lib/session-chat-service";
import sessionRouter from "./session";
import {
  attachSessionChatTransport,
  handleSessionChatTransportMessage,
} from "../lib/session-chat-service";

class MockTransport {
  readonly sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {}
}

describe("sessionRouter", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-route-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
  });

  afterEach(async () => {
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("creates and returns formal narrator session records", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Planner 会话",
        agentId: "planner",
        kind: "standalone",
        sessionMode: "plan",
        worktree: "feature/session-core",
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
          permissionMode: "ask",
          reasoningEffort: "high",
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();

    expect(created).toMatchObject({
      title: "Planner 会话",
      agentId: "planner",
      kind: "standalone",
      sessionMode: "plan",
      worktree: "feature/session-core",
      status: "active",
      sortOrder: 0,
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        permissionMode: "ask",
        reasoningEffort: "high",
      },
    });
    expect(typeof created.id).toBe("string");
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.lastModified).toBe("string");

    const stateResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`);
    expect(stateResponse.status).toBe(200);

    const state = await stateResponse.json();
    expect(state).toMatchObject({
      session: {
        id: created.id,
        agentId: "planner",
        kind: "standalone",
        sessionMode: "plan",
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
        },
      },
      messages: [],
      cursor: {
        lastSeq: 0,
      },
    });

    const listResponse = await sessionRouter.request("http://localhost/");
    expect(listResponse.status).toBe(200);

    const sessions = await listResponse.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: created.id,
      agentId: "planner",
      kind: "standalone",
      sessionMode: "plan",
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
      },
    });
  });

  it("returns the full persisted chat history, not just the recent snapshot", async () => {
    const session = await createSession({
      title: "History 会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = {
      send() {},
      close() {},
    };

    const attached = await attachSessionChatTransport(session.id, transport);
    expect(attached).toBe(true);

    for (let index = 1; index <= 26; index += 1) {
      await handleSessionChatTransportMessage(
        session.id,
        transport,
        JSON.stringify({
          messageId: `history-message-${index}`,
          content: `第 ${index} 条消息`,
        }),
      );
    }

    const response = await sessionRouter.request(`http://localhost/${session.id}/chat/history`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      sessionId: session.id,
    });
    expect(payload.messages).toHaveLength(52);
    expect(payload.messages[0]).toMatchObject({
      id: "history-message-1",
      role: "user",
      content: "第 1 条消息",
    });
    expect(payload.messages.at(-1)).toMatchObject({
      role: "assistant",
    });
  });
});
