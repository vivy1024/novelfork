import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { NarratorSessionChatMessage } from "../../shared/session-types.js";

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

async function loadSessionChatService() {
  return import("./session-chat-service");
}

async function loadSessionLifecycleService() {
  return import("./session-lifecycle-service");
}

function message(id: string, role: NarratorSessionChatMessage["role"], content: string, seq: number): NarratorSessionChatMessage {
  return { id, role, content, seq, timestamp: 1_779_206_400_000 + seq };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("session-lifecycle-service", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-lifecycle-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
  });

  afterEach(async () => {
    const { __testing } = await loadSessionService();
    __testing.resetSessionStoreMutationQueue();
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("continues the most recent active session within a project scope", async () => {
    const { createSession, updateSession } = await loadSessionService();
    const { continueLatestSession } = await loadSessionLifecycleService();

    const olderBookSession = await createSession({ title: "第一章", agentId: "writer", projectId: "book-1" });
    await tick();
    await createSession({ title: "第二本书", agentId: "writer", projectId: "book-2" });
    await tick();
    const archivedBookSession = await createSession({ title: "归档会话", agentId: "writer", projectId: "book-1" });
    await updateSession(archivedBookSession.id, { status: "archived" });
    await tick();
    await updateSession(olderBookSession.id, { messageCount: 3 });

    const result = await continueLatestSession({ projectId: "book-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.session.id).toBe(olderBookSession.id);
    expect(result.session.status).toBe("active");
    expect(result.readonly).toBe(false);
    expect(result.snapshot.session.id).toBe(olderBookSession.id);
  });

  it("returns a real not-found error when resuming a missing session", async () => {
    const { resumeSession } = await loadSessionLifecycleService();

    const result = await resumeSession("missing-session");

    expect(result).toEqual({ ok: false, status: 404, code: "session_not_found", error: "Session not found" });
  });

  it("opens archived sessions as readonly until explicitly restored", async () => {
    const { createSession, getSessionById, updateSession } = await loadSessionService();
    const { replaceSessionChatState } = await loadSessionChatService();
    const { restoreSessionForContinue, resumeSession } = await loadSessionLifecycleService();
    const session = await createSession({ title: "归档剧情", agentId: "writer", projectId: "book-1" });
    await replaceSessionChatState(session.id, [
      message("m1", "user", "继续第三章", 1),
      message("m2", "assistant", "第三章概要", 2),
    ]);
    await updateSession(session.id, { status: "archived" });

    const readonlyResult = await resumeSession(session.id);

    expect(readonlyResult.ok).toBe(true);
    if (!readonlyResult.ok) throw new Error(readonlyResult.error);
    expect(readonlyResult.readonly).toBe(true);
    expect(readonlyResult.snapshot.cursor.lastSeq).toBe(2);
    expect((await getSessionById(session.id))?.status).toBe("archived");

    const restored = await restoreSessionForContinue(session.id);

    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.session.status).toBe("active");
    expect(restored.readonly).toBe(false);
    expect((await getSessionById(session.id))?.status).toBe("active");
  });

  it("forks a session into a new active session with inherited config and summary context", async () => {
    const { createSession } = await loadSessionService();
    const { getSessionChatSnapshot, replaceSessionChatState } = await loadSessionChatService();
    const { forkSession } = await loadSessionLifecycleService();
    const source = await createSession({
      title: "主线会话",
      agentId: "writer",
      kind: "chapter",
      sessionMode: "chat",
      projectId: "book-1",
      chapterId: "chapter-3",
      sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
    });
    await replaceSessionChatState(source.id, [
      message("m1", "user", "第三章要铺垫宗门追杀", 1),
      message("m2", "assistant", "已建立追杀线索", 2),
      message("m3", "user", "fork 出支线", 3),
    ]);

    const result = await forkSession({ sourceSessionId: source.id, title: "支线会话" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.session.id).not.toBe(source.id);
    expect(result.session).toMatchObject({
      title: "支线会话",
      agentId: "writer",
      kind: "chapter",
      sessionMode: "chat",
      projectId: "book-1",
      chapterId: "chapter-3",
      status: "active",
      sessionConfig: source.sessionConfig,
    });
    expect(result.snapshot.messages).toHaveLength(1);
    expect(result.snapshot.messages[0]).toMatchObject({ role: "system" });
    expect(result.snapshot.messages[0]?.content).toContain(source.id);
    expect(result.snapshot.messages[0]?.content).toContain("主线会话");
    expect(result.snapshot.messages[0]?.content).toContain("3 条历史消息");

    const sourceSnapshot = await getSessionChatSnapshot(source.id);
    expect(sourceSnapshot?.messages).toHaveLength(3);
  });

  it("does not create an empty session when fork source is missing", async () => {
    const { listSessions } = await loadSessionService();
    const { forkSession } = await loadSessionLifecycleService();

    const result = await forkSession({ sourceSessionId: "missing-session", title: "不应创建" });

    expect(result).toEqual({ ok: false, status: 404, code: "source_session_not_found", error: "Source session not found" });
    expect(await listSessions()).toEqual([]);
  });
});
