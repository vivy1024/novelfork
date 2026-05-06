import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCapabilityUiDecision, type ContractResult } from "@/app-next/backend-contract";
import type { ToolConfirmationRequest } from "@/shared/agent-native-workspace";
import type {
  NarratorSessionChatMessage,
  NarratorSessionChatSnapshot,
  NarratorSessionRecord,
} from "@/shared/session-types";

const useWindowStoreMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("Admin SessionsTab must not use windowStore");
}));
const useWindowRuntimeStoreMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("Admin SessionsTab must not use windowRuntimeStore");
}));

vi.mock("@/stores/windowStore", () => ({
  useWindowStore: useWindowStoreMock,
}));

vi.mock("@/stores/windowRuntimeStore", async () => {
  const actual = await vi.importActual<typeof import("@/stores/windowRuntimeStore")>("@/stores/windowRuntimeStore");
  return { ...actual, useWindowRuntimeStore: useWindowRuntimeStoreMock };
});

import { SessionsTab } from "./SessionsTab";

type SessionClientStub = {
  listActiveSessions: ReturnType<typeof vi.fn>;
  getChatState: ReturnType<typeof vi.fn>;
  listPendingTools: ReturnType<typeof vi.fn>;
};

const activeSession = createSession({
  id: "session-active",
  title: "灵潮纪元 · Writer",
  agentId: "writer",
  projectId: "book-1",
  providerId: "sub2api",
  modelId: "gpt-5.4",
  pendingToolCallCount: 1,
});
const archivedSession = createSession({
  id: "session-archived",
  title: "归档审校",
  agentId: "auditor",
  status: "archived",
  permissionMode: "read",
});

describe("Admin · SessionsTab", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an empty state when the session service has no sessions", async () => {
    const sessionClient = createSessionClientStub({ active: [], archived: [] });

    render(<SessionsTab sessionClient={sessionClient as never} />);

    expect(await screen.findByText(/当前没有会话记录/)).toBeTruthy();
    expect(useWindowStoreMock).not.toHaveBeenCalled();
    expect(useWindowRuntimeStoreMock).not.toHaveBeenCalled();
  });

  it("renders active and archived sessions from session/runtime truth", async () => {
    const sessionClient = createSessionClientStub({ active: [activeSession], archived: [archivedSession] });

    render(<SessionsTab sessionClient={sessionClient as never} />);

    await waitFor(() => expect(sessionClient.listActiveSessions).toHaveBeenCalledWith({ status: "active" }));
    await waitFor(() => expect(sessionClient.listActiveSessions).toHaveBeenCalledWith({ status: "archived" }));
    await waitFor(() => expect(sessionClient.getChatState).toHaveBeenCalledWith("session-active"));
    await waitFor(() => expect(sessionClient.listPendingTools).toHaveBeenCalledWith("session-active"));

    expect(screen.getByText("会话运行态")).toBeTruthy();
    expect(screen.getByText("全部会话")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);

    const activeRow = await screen.findByTestId("admin-session-row-session-active");
    expect(activeRow.textContent).toContain("灵潮纪元 · Writer");
    expect(activeRow.textContent).toContain("session-active");
    expect(activeRow.textContent).toContain("writer");
    expect(activeRow.textContent).toContain("活跃");
    expect(activeRow.textContent).toContain("sub2api:gpt-5.4");
    expect(activeRow.textContent).toContain("未处理确认 1");
    expect(activeRow.textContent).toContain("recent assistant");
    expect(activeRow.textContent).toContain("guided.exit 等待确认");
    expect(activeRow.textContent).toContain("回放中");

    const archivedRow = screen.getByTestId("admin-session-row-session-archived");
    expect(archivedRow.textContent).toContain("归档审校");
    expect(archivedRow.textContent).toContain("已归档");
    expect(archivedRow.textContent).toContain("只读");
  });

  it("surfaces missing chat state without dropping the session row", async () => {
    const sessionClient = createSessionClientStub({ active: [activeSession], archived: [] });
    sessionClient.getChatState.mockResolvedValue(errorResult("not-found", "Session not found", 404));
    sessionClient.listPendingTools.mockResolvedValue(errorResult("not-found", "Session not found", 404));

    render(<SessionsTab sessionClient={sessionClient as never} />);

    const row = await screen.findByTestId("admin-session-row-session-active");
    expect(row.textContent).toContain("chat state 缺失");
    expect(row.textContent).toContain("pending tools 缺失");
  });
});

function createSessionClientStub(input: {
  readonly active: readonly NarratorSessionRecord[];
  readonly archived: readonly NarratorSessionRecord[];
}): SessionClientStub {
  return {
    listActiveSessions: vi.fn(async (query?: { status?: string }) => {
      return okResult(query?.status === "archived" ? input.archived : input.active);
    }),
    getChatState: vi.fn(async (sessionId: string) => okResult(createSnapshot(sessionId))),
    listPendingTools: vi.fn(async () => okResult({ pending: [createPendingTool()] })),
  };
}

function okResult<T>(data: T): ContractResult<T> {
  return {
    ok: true,
    data,
    raw: data,
    httpStatus: 200,
    capability: { id: "sessions.runtime", status: "current", ui: getCapabilityUiDecision("current") },
  };
}

function errorResult(code: string, message: string, httpStatus: number): ContractResult<never> {
  return {
    ok: false,
    code,
    error: { error: { code, message } },
    raw: { error: { code, message } },
    httpStatus,
    capability: { id: "sessions.runtime", status: "current", ui: getCapabilityUiDecision("current") },
  };
}

function createSession(input: {
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly status?: NarratorSessionRecord["status"];
  readonly projectId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly permissionMode?: NarratorSessionRecord["sessionConfig"]["permissionMode"];
  readonly pendingToolCallCount?: number;
}): NarratorSessionRecord {
  return {
    id: input.id,
    title: input.title,
    agentId: input.agentId,
    kind: "standalone",
    sessionMode: "chat",
    status: input.status ?? "active",
    createdAt: "2026-05-06T00:00:00.000Z",
    lastModified: "2026-05-06T01:00:00.000Z",
    messageCount: 3,
    sortOrder: 0,
    projectId: input.projectId,
    sessionConfig: {
      providerId: input.providerId ?? "sub2api",
      modelId: input.modelId ?? "gpt-5.4-mini",
      permissionMode: input.permissionMode ?? "edit",
      reasoningEffort: "medium",
    },
    recovery: {
      lastSeq: 3,
      lastAckedSeq: 3,
      availableFromSeq: 1,
      pendingMessageCount: 0,
      pendingToolCallCount: input.pendingToolCallCount ?? 0,
      pendingToolCallSummary: input.pendingToolCallCount ? ["guided.exit 等待确认"] : undefined,
      updatedAt: "2026-05-06T01:00:00.000Z",
    },
  };
}

function createSnapshot(sessionId: string): NarratorSessionChatSnapshot {
  const messages: NarratorSessionChatMessage[] = [
    { id: `${sessionId}-m1`, role: "user", content: "recent user", timestamp: 1778029200000, seq: 1 },
    { id: `${sessionId}-m2`, role: "assistant", content: "recent assistant", timestamp: 1778029201000, seq: 2 },
  ];
  return {
    session: sessionId === activeSession.id ? activeSession : archivedSession,
    messages,
    cursor: { lastSeq: 2, ackedSeq: 2 },
  };
}

function createPendingTool(): ToolConfirmationRequest {
  return {
    id: "confirm-1",
    sessionId: activeSession.id,
    toolName: "guided.exit",
    target: "写作计划",
    risk: "confirmed-write",
    summary: "guided.exit 等待确认",
    options: ["approve", "reject"],
    createdAt: "2026-05-06T01:00:00.000Z",
  };
}
