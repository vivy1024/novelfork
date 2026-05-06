import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCapabilityUiDecision, type ContractResult } from "@/app-next/backend-contract";
import type { NarratorSessionRecord } from "@/shared/session-types";

import { SessionCenter } from "./SessionCenter";

const activeStandalone = createSession({
  id: "session-free",
  title: "自由讨论",
  agentId: "planner",
  sessionMode: "plan",
  permissionMode: "plan",
  providerId: "openai",
  modelId: "gpt-5.4-mini",
});
const activeBook = createSession({
  id: "session-book",
  title: "灵潮纪元 · 叙述者",
  agentId: "writer",
  projectId: "book-1",
  permissionMode: "edit",
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  pendingToolCallCount: 2,
  lastFailure: { reason: "unsupported-tools", message: "当前模型不支持工具调用", at: "2026-05-02T02:00:00.000Z" },
});
const activeChapter = createSession({
  id: "session-chapter",
  title: "第二章入城 · 修订",
  agentId: "reviser",
  kind: "chapter",
  projectId: "book-1",
  chapterId: "2",
  permissionMode: "ask",
});
const archivedSession = createSession({
  id: "session-archived",
  title: "旧书归档会话",
  agentId: "auditor",
  projectId: "book-2",
  status: "archived",
  permissionMode: "read",
});

type SessionCenterClient = {
  listActiveSessions: ReturnType<typeof vi.fn>;
  updateSession: ReturnType<typeof vi.fn>;
  continueLatestSession: ReturnType<typeof vi.fn>;
  forkSession: ReturnType<typeof vi.fn>;
  getMemoryStatus: ReturnType<typeof vi.fn>;
};

describe("SessionCenter", () => {
  let sessionClient: SessionCenterClient;

  beforeEach(() => {
    sessionClient = createSessionClientStub();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders session list details and filters by binding through the session domain client", async () => {
    const openSession = vi.fn();
    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={openSession} />);

    await waitFor(() => expect(sessionClient.listActiveSessions).toHaveBeenCalledWith({ status: "active" }));

    const bookRow = screen.getByTestId("session-center-row-session-book");
    expect(bookRow.textContent).toContain("灵潮纪元 · 叙述者");
    expect(bookRow.textContent).toContain("writer");
    expect(bookRow.textContent).toContain("anthropic:claude-sonnet-4-6");
    expect(bookRow.textContent).toContain("允许编辑");
    expect(bookRow.textContent).toContain("书籍绑定");
    expect(bookRow.textContent).toContain("未处理确认 2");
    expect(bookRow.textContent).toContain("最近失败：unsupported-tools · 当前模型不支持工具调用");

    fireEvent.click(screen.getByRole("button", { name: "书籍绑定" }));
    await waitFor(() => expect(sessionClient.listActiveSessions).toHaveBeenCalledWith({ status: "active", binding: "book" }));
    expect(screen.getByTestId("session-center-row-session-book")).toBeTruthy();
    expect(screen.queryByTestId("session-center-row-session-chapter")).toBeNull();

    fireEvent.click(within(screen.getByTestId("session-center-row-session-book")).getByRole("button", { name: "打开" }));
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-book", title: "灵潮纪元 · 叙述者" }));
  });

  it("archives and restores sessions through the session domain client without deleting history", async () => {
    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={vi.fn()} />);

    const bookRow = await screen.findByTestId("session-center-row-session-book");
    fireEvent.click(within(bookRow).getByRole("button", { name: "归档" }));

    await waitFor(() => expect(sessionClient.updateSession).toHaveBeenCalledWith("session-book", { status: "archived" }));

    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    await waitFor(() => expect(sessionClient.listActiveSessions).toHaveBeenCalledWith({ status: "archived" }));

    const archivedRow = await screen.findByTestId("session-center-row-session-archived");
    expect(archivedRow.textContent).toContain("已归档");
    fireEvent.click(within(archivedRow).getByRole("button", { name: "恢复" }));

    await waitFor(() => expect(sessionClient.updateSession).toHaveBeenCalledWith("session-archived", { status: "active" }));
  });

  it("searches sessions through the session domain client", async () => {
    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("搜索会话"), { target: { value: "灵潮" } });
    await waitFor(() => expect(sessionClient.listActiveSessions).toHaveBeenCalledWith({ status: "active", search: "灵潮" }));
    expect(screen.getByTestId("session-center-row-session-book")).toBeTruthy();
  });

  it("shows an empty state when the session client returns no records", async () => {
    sessionClient.listActiveSessions.mockResolvedValue(okResult([]));

    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={vi.fn()} />);

    expect(await screen.findByText("没有匹配的会话。")).toBeTruthy();
  });

  it("continues the latest scoped session through the lifecycle client", async () => {
    const openSession = vi.fn();
    render(<SessionCenter projectId="book-1" sessionClient={sessionClient as never} onOpenSession={openSession} />);

    fireEvent.click(await screen.findByRole("button", { name: "继续最近会话" }));

    await waitFor(() => expect(sessionClient.continueLatestSession).toHaveBeenCalledWith("book-1", undefined));
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-book" }));
  });

  it("shows the session memory boundary as readonly when no writer is configured", async () => {
    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={vi.fn()} />);

    const bookRow = await screen.findByTestId("session-center-row-session-book");
    expect(within(bookRow).getByText("Memory：只读（未接入写入器）")).toBeTruthy();
    expect(within(bookRow).getByText("临时剧情草稿不会自动写入长期 memory；偏好/项目事实写入需审计来源。")).toBeTruthy();
    expect(sessionClient.getMemoryStatus).toHaveBeenCalledWith("session-book");
  });

  it("forks a selected session from the dialog and opens the new session", async () => {
    const openSession = vi.fn();
    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={openSession} />);

    const bookRow = await screen.findByTestId("session-center-row-session-book");
    fireEvent.click(within(bookRow).getByRole("button", { name: "Fork" }));
    expect(screen.getByRole("dialog", { name: "Fork 会话" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Fork 标题"), { target: { value: "灵潮支线" } });
    fireEvent.change(screen.getByLabelText("继承说明"), { target: { value: "保留宗门追杀线" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 fork" }));

    await waitFor(() => expect(sessionClient.forkSession).toHaveBeenCalledWith("session-book", { title: "灵潮支线", inheritanceNote: "保留宗门追杀线" }));
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-fork", title: "灵潮支线" }));
  });

  it("shows lifecycle errors without opening an empty session", async () => {
    const openSession = vi.fn();
    sessionClient.continueLatestSession.mockResolvedValue(errorResult("session_not_found", "Session not found"));
    render(<SessionCenter projectId="missing-book" sessionClient={sessionClient as never} onOpenSession={openSession} />);

    fireEvent.click(await screen.findByRole("button", { name: "继续最近会话" }));

    expect(await screen.findByText("Session not found")).toBeTruthy();
    expect(openSession).not.toHaveBeenCalled();
  });

  it("shows the session client error when loading fails", async () => {
    sessionClient.listActiveSessions.mockResolvedValue(errorResult("session-list-failed", "会话列表加载失败"));

    render(<SessionCenter sessionClient={sessionClient as never} onOpenSession={vi.fn()} />);

    expect(await screen.findByText("会话列表加载失败")).toBeTruthy();
  });
});

function createSessionClientStub(): SessionCenterClient {
  return {
    listActiveSessions: vi.fn(async (query?: { status?: string; binding?: string; search?: string }) => {
      if (query?.status === "active" && query?.binding === "book") return okResult([activeBook]);
      if (query?.status === "active" && query?.binding === "chapter") return okResult([activeChapter]);
      if (query?.status === "active" && query?.binding === "standalone") return okResult([activeStandalone]);
      if (query?.status === "archived") return okResult([archivedSession]);
      if (query?.status === "active" && query?.search === "灵潮") return okResult([activeBook]);
      return okResult([activeBook, activeChapter, activeStandalone]);
    }),
    updateSession: vi.fn(async (sessionId: string, payload: { status: NarratorSessionRecord["status"] }) => {
      if (sessionId === "session-book" && payload.status === "archived") return okResult({ ...activeBook, status: "archived" });
      if (sessionId === "session-archived" && payload.status === "active") return okResult({ ...archivedSession, status: "active" });
      return okResult(activeStandalone);
    }),
    continueLatestSession: vi.fn(async () => okResult(lifecycleResult(activeBook))),
    forkSession: vi.fn(async (_sessionId: string, payload: { title?: string; inheritanceNote?: string }) => okResult(lifecycleResult(createSession({
      ...activeBook,
      id: "session-fork",
      title: payload.title ?? "灵潮支线",
    })))),
    getMemoryStatus: vi.fn(async (sessionId: string) => okResult({
      ok: true,
      sessionId,
      status: sessionId === "session-book" ? "readonly" : "writable",
      writable: sessionId !== "session-book",
      categories: ["user-preference", "project-fact", "temporary-story-draft"],
      ...(sessionId === "session-book" ? { reason: "memory_writer_not_configured" } : {}),
    })),
  };
}

function lifecycleResult(session: NarratorSessionRecord) {
  return {
    ok: true,
    readonly: session.status === "archived",
    session,
    snapshot: {
      session,
      messages: [],
      cursor: { lastSeq: session.recovery?.lastSeq ?? 0, ackedSeq: session.recovery?.lastAckedSeq ?? 0 },
    },
  };
}

function okResult<T>(data: T): ContractResult<T> {
  return {
    ok: true,
    data,
    raw: data,
    httpStatus: 200,
    capability: { id: "sessions.active", status: "current", ui: getCapabilityUiDecision("current") },
  };
}

function errorResult(code: string, message: string): ContractResult<never> {
  return {
    ok: false,
    code,
    error: { error: { code, message } },
    raw: { error: { code, message } },
    httpStatus: 500,
    capability: { id: "sessions.active", status: "current", ui: getCapabilityUiDecision("current") },
  };
}

function createSession(input: {
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly kind?: NarratorSessionRecord["kind"];
  readonly sessionMode?: NarratorSessionRecord["sessionMode"];
  readonly status?: NarratorSessionRecord["status"];
  readonly projectId?: string;
  readonly chapterId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly permissionMode?: NarratorSessionRecord["sessionConfig"]["permissionMode"];
  readonly pendingToolCallCount?: number;
  readonly lastFailure?: NonNullable<NarratorSessionRecord["recovery"]>["lastFailure"];
}): NarratorSessionRecord {
  return {
    id: input.id,
    title: input.title,
    agentId: input.agentId,
    kind: input.kind ?? "standalone",
    sessionMode: input.sessionMode ?? "chat",
    status: input.status ?? "active",
    createdAt: "2026-05-01T00:00:00.000Z",
    lastModified: "2026-05-02T00:00:00.000Z",
    messageCount: 7,
    sortOrder: 0,
    projectId: input.projectId,
    chapterId: input.chapterId,
    sessionConfig: {
      providerId: input.providerId ?? "sub2api",
      modelId: input.modelId ?? "gpt-5.4",
      permissionMode: input.permissionMode ?? "edit",
      reasoningEffort: "medium",
    },
    recovery: {
      lastSeq: 12,
      lastAckedSeq: 10,
      availableFromSeq: 1,
      pendingMessageCount: 2,
      pendingToolCallCount: input.pendingToolCallCount ?? 0,
      pendingToolCallSummary: input.pendingToolCallCount ? ["guided.exit 等待确认"] : undefined,
      lastFailure: input.lastFailure,
      updatedAt: "2026-05-02T03:00:00.000Z",
    },
  };
}
