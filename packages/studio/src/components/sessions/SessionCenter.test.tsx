import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NarratorSessionRecord } from "@/shared/session-types";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, fetchJson: fetchJsonMock };
});

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

describe("SessionCenter", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/sessions?sort=recent&status=active") return [activeBook, activeChapter, activeStandalone];
      if (path === "/api/sessions?sort=recent&status=active&binding=book") return [activeBook];
      if (path === "/api/sessions?sort=recent&status=active&binding=chapter") return [activeChapter];
      if (path === "/api/sessions?sort=recent&status=active&binding=standalone") return [activeStandalone];
      if (path === "/api/sessions?sort=recent&status=archived") return [archivedSession];
      if (path === "/api/sessions?sort=recent&status=active&search=%E7%81%B5%E6%BD%AE") return [activeBook];
      if (path === "/api/sessions/session-book" && init?.method === "PUT") return { ...activeBook, status: "archived" };
      if (path === "/api/sessions/session-archived" && init?.method === "PUT") return { ...archivedSession, status: "active" };
      return [];
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders session list details and filters by binding", async () => {
    const openSession = vi.fn();
    render(<SessionCenter onOpenSession={openSession} />);

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions?sort=recent&status=active"));

    const bookRow = screen.getByTestId("session-center-row-session-book");
    expect(bookRow.textContent).toContain("灵潮纪元 · 叙述者");
    expect(bookRow.textContent).toContain("writer");
    expect(bookRow.textContent).toContain("anthropic:claude-sonnet-4-6");
    expect(bookRow.textContent).toContain("允许编辑");
    expect(bookRow.textContent).toContain("书籍绑定");
    expect(bookRow.textContent).toContain("未处理确认 2");
    expect(bookRow.textContent).toContain("最近失败：unsupported-tools · 当前模型不支持工具调用");

    fireEvent.click(screen.getByRole("button", { name: "书籍绑定" }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions?sort=recent&status=active&binding=book"));
    expect(screen.getByTestId("session-center-row-session-book")).toBeTruthy();
    expect(screen.queryByTestId("session-center-row-session-chapter")).toBeNull();

    fireEvent.click(within(screen.getByTestId("session-center-row-session-book")).getByRole("button", { name: "打开" }));
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-book", title: "灵潮纪元 · 叙述者" }));
  });

  it("archives and restores sessions from the center without deleting history", async () => {
    render(<SessionCenter onOpenSession={vi.fn()} />);

    const bookRow = await screen.findByTestId("session-center-row-session-book");
    fireEvent.click(within(bookRow).getByRole("button", { name: "归档" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/sessions/session-book",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ status: "archived" }),
      }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions?sort=recent&status=archived"));

    const archivedRow = await screen.findByTestId("session-center-row-session-archived");
    expect(archivedRow.textContent).toContain("已归档");
    fireEvent.click(within(archivedRow).getByRole("button", { name: "恢复" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/sessions/session-archived",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ status: "active" }),
      }),
    ));
  });

  it("searches sessions through the list API", async () => {
    render(<SessionCenter onOpenSession={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("搜索会话"), { target: { value: "灵潮" } });
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions?sort=recent&status=active&search=%E7%81%B5%E6%BD%AE"));
    expect(screen.getByTestId("session-center-row-session-book")).toBeTruthy();
  });
});

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
