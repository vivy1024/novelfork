import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { NarratorSessionChatMessage } from "../../shared/session-types.js";

vi.mock("./user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => ({
    runtimeControls: { defaultPermissionMode: "ask", defaultReasoningEffort: "medium" },
    modelDefaults: { defaultSessionModel: "sub2api:gpt-5.4", summaryModel: "sub2api:gpt-5.4", subagentModelPool: [] },
  })),
}));

async function loadSessionService() {
  return import("./session-service");
}

async function loadSessionChatService() {
  return import("./session-chat-service");
}

async function loadSessionCompactService() {
  return import("./session-compact-service");
}

function message(id: string, role: NarratorSessionChatMessage["role"], content: string, seq: number): NarratorSessionChatMessage {
  return { id, role, content, seq, timestamp: 1_779_206_400_000 + seq };
}

describe("session-compact-service", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-compact-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
  });

  afterEach(async () => {
    const { __testing } = await loadSessionService();
    __testing.resetSessionStoreMutationQueue();
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("compacts older session messages into a summary and keeps recent messages", async () => {
    const { createSession } = await loadSessionService();
    const { getSessionChatSnapshot, replaceSessionChatState } = await loadSessionChatService();
    const { compactSession } = await loadSessionCompactService();
    const session = await createSession({
      title: "第三章会话",
      agentId: "writer",
      projectId: "book-1",
      sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
    });
    await replaceSessionChatState(session.id, [
      message("m1", "user", `第一轮：主角发现灵潮异常。${"灵潮异常、宗门追杀、主角隐瞒修为。".repeat(24)}`, 1),
      message("m2", "assistant", `已记录灵潮异常与宗门追杀伏笔。${"追杀线索进入第三章暗线，长老态度摇摆。".repeat(24)}`, 2),
      message("m3", "user", `第二轮：加入法宝线索。${"法宝残片呼应反派动机，必须保留因果。".repeat(24)}`, 3),
      message("m4", "assistant", "法宝与反派动机已经串联", 4),
      message("m5", "user", "最近：准备继续第三章", 5),
    ]);

    const result = await compactSession({ sessionId: session.id, preserveRecentMessages: 2, instructions: "保留灵潮与法宝线索" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({
      beforeMessageCount: 5,
      afterMessageCount: 3,
      compactedMessageCount: 3,
      sourceRange: { fromSeq: 1, toSeq: 3 },
      preservedRange: { fromSeq: 4, toSeq: 5 },
      model: { providerId: "sub2api", modelId: "gpt-5.4" },
    });
    expect(result.summary).toContain("保留灵潮与法宝线索");
    expect(result.budget.estimatedTokensBefore).toBeGreaterThan(result.budget.estimatedTokensAfter);

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages).toHaveLength(3);
    expect(snapshot?.messages[0]).toMatchObject({ role: "system", metadata: { kind: "session-compact-summary" } });
    expect(snapshot?.messages[0]?.content).toContain("上下文压缩摘要");
    expect(snapshot?.messages[0]?.content).toContain("第一轮：主角发现灵潮异常");
    expect(snapshot?.messages[1]?.id).toBe("m4");
    expect(snapshot?.messages[2]?.id).toBe("m5");
  });

  it("preserves original history when there is not enough history to compact", async () => {
    const { createSession } = await loadSessionService();
    const { getSessionChatSnapshot, replaceSessionChatState } = await loadSessionChatService();
    const { compactSession } = await loadSessionCompactService();
    const session = await createSession({ title: "短会话", agentId: "writer" });
    await replaceSessionChatState(session.id, [message("m1", "user", "只有一条", 1)]);

    const result = await compactSession({ sessionId: session.id, preserveRecentMessages: 2 });

    expect(result).toEqual({ ok: false, status: 400, code: "not_enough_messages", error: "Not enough messages to compact" });
    expect((await getSessionChatSnapshot(session.id))?.messages.map((item) => item.id)).toEqual(["m1"]);
  });

  it("returns a real not-found error for missing sessions", async () => {
    const { compactSession } = await loadSessionCompactService();

    await expect(compactSession({ sessionId: "missing-session" })).resolves.toEqual({ ok: false, status: 404, code: "session_not_found", error: "Session not found" });
  });
});
