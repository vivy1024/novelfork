import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("serves incremental chat history by sinceSeq", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Writer 会话",
        agentId: "writer",
        sessionMode: "chat",
      }),
    });
    const created = await createResponse.json();

    const transport = new MockTransport();
    expect(await attachSessionChatTransport(created.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "history-message-1",
        content: "第一句",
        sessionMode: "chat",
      }),
    );
    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "history-message-2",
        content: "第二句",
        sessionMode: "chat",
      }),
    );

    const historyResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/history?sinceSeq=2`);
    expect(historyResponse.status).toBe(200);

    const history = await historyResponse.json();
    expect(history).toMatchObject({
      sessionId: created.id,
      sinceSeq: 2,
      availableFromSeq: 1,
      resetRequired: false,
      cursor: {
        lastSeq: 4,
      },
    });
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]).toMatchObject({
      id: "history-message-2",
      role: "user",
      seq: 3,
    });
    expect(history.messages[1]).toMatchObject({
      id: "history-message-2-assistant",
      role: "assistant",
      seq: 4,
    });
  });

  it("replays persisted history even when the in-memory runtime buffer has been trimmed", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Long Writer 会话",
        agentId: "writer",
        sessionMode: "chat",
      }),
    });
    const created = await createResponse.json();

    const transport = new MockTransport();
    expect(await attachSessionChatTransport(created.id, transport)).toBe(true);

    for (let index = 0; index < 30; index += 1) {
      await handleSessionChatTransportMessage(
        created.id,
        transport,
        JSON.stringify({
          type: "session:message",
          messageId: `trimmed-message-${index + 1}`,
          content: `第 ${index + 1} 句`,
          sessionMode: "chat",
        }),
      );
    }

    const historyResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/history?sinceSeq=1`);
    expect(historyResponse.status).toBe(200);

    const history = await historyResponse.json();
    expect(history).toMatchObject({
      sessionId: created.id,
      sinceSeq: 1,
      availableFromSeq: 1,
      resetRequired: false,
      cursor: {
        lastSeq: 60,
      },
    });
    expect(history.messages).toHaveLength(59);
    expect(history.messages[0]).toMatchObject({
      id: "trimmed-message-1-assistant",
      seq: 2,
      role: "assistant",
    });
    expect(history.messages.at(-1)).toMatchObject({
      id: "trimmed-message-30-assistant",
      seq: 60,
      role: "assistant",
    });
  });
});
