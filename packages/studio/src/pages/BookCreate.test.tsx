import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
  useApi: (url: string) => {
    if (url === "/genres") {
      return {
        data: {
          genres: [
            { id: "xuanhuan", name: "玄幻", source: "builtin", language: "zh" },
          ],
        },
      };
    }
    if (url === "/project") {
      return { data: { language: "zh" } };
    }
    return { data: undefined };
  },
}));

interface MockWindowStore {
  addWindow: (input: { title: string; agentId: string; sessionId?: string; sessionMode?: "chat" | "plan" }) => void;
}

let addWindowMock = vi.fn();

vi.mock("@/stores/windowStore", () => ({
  useWindowStore: (selector: (state: MockWindowStore) => unknown) =>
    selector({
      addWindow: addWindowMock,
    }),
}));

import { BookCreate } from "./BookCreate";

describe("BookCreate", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    postApiMock.mockReset();
    addWindowMock = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  function createDefaultSessionResponse(bookId = "book-demo") {
    return {
      id: `session-${bookId}`,
      title: "新书《仙路长明》写作会话",
      agentId: "writer",
      kind: "standalone",
      sessionMode: "chat",
      status: "active",
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messageCount: 0,
      sortOrder: 0,
      projectId: bookId,
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        permissionMode: "allow",
        reasoningEffort: "medium",
      },
      recentMessages: [],
    };
  }

  function createBookResponse(bookId = "book-demo") {
    const defaultSession = createDefaultSessionResponse(bookId);
    return {
      bookId,
      status: "creating",
      defaultSession,
      defaultSessionSnapshot: {
        session: defaultSession,
        messages: [],
        cursor: { lastSeq: 0 },
      },
    };
  }

  it("shows staged progress and locks project-create edits while the create workflow is running", async () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toProjectCreate: vi.fn(),
    };

    let resolveBookReady: (() => void) | null = null;
    postApiMock.mockResolvedValueOnce(createBookResponse("book-demo"));
    fetchJsonMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (url === "/books/book-demo") {
        return new Promise((resolve) => {
          resolveBookReady = () => resolve({ id: "book-demo" });
        });
      }
      throw new Error(`Unexpected fetchJson call: ${url}`);
    });

    render(
      <BookCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
        projectCreateDraft={{
          title: "仙路长明",
          projectInit: {
            repositorySource: "new",
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "xianlu-main",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建书籍并进入工作区" }));

    expect(screen.getByText("正在提交建书请求…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "创建中..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "返回修改初始化" }) as HTMLButtonElement).disabled).toBe(true);

    await waitFor(() => expect(screen.getByText("正在等待书籍骨架就绪…")).toBeTruthy());
  });

  it("translates worktree ownership conflicts into actionable guidance", async () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toProjectCreate: vi.fn(),
    };

    const conflict = new Error("Worktree \"draft-main\" is already owned by book \"occupied-book\" in repository \"D:/repo\".") as Error & { code?: string };
    conflict.code = "PROJECT_BOOTSTRAP_WORKTREE_CONFLICT";
    postApiMock.mockRejectedValueOnce(conflict);

    render(
      <BookCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
        projectCreateDraft={{
          title: "仙路长明",
          projectInit: {
            repositorySource: "existing",
            repositoryPath: "D:/repo",
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-main",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建书籍并进入工作区" }));

    await waitFor(() => {
      expect(screen.getByText(/当前 worktree 已被其他书占用/)).toBeTruthy();
    });
    expect(screen.getByText(/可以返回上一步修改 worktree 名称或仓库来源/)).toBeTruthy();
  });

  it("creates a default writer session and enters the formal session workspace after the book becomes ready", async () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toSessions: vi.fn(),
      toProjectCreate: vi.fn(),
    } as any;

    postApiMock.mockResolvedValueOnce(createBookResponse("book-demo"));
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/books/book-demo") {
        return { id: "book-demo" };
      }
      throw new Error(`Unexpected fetchJson call: ${url}`);
    });

    render(
      <BookCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
        projectCreateDraft={{
          title: "仙路长明",
          projectInit: {
            repositorySource: "new",
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "xianlu-main",
          },
        }}
      />,
    );

    expect(screen.getByText(/创建完成后会自动打开默认写作会话/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建书籍并进入工作区" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postApiMock).toHaveBeenCalledWith("/books/create", expect.objectContaining({
      title: "仙路长明",
      genre: "xuanhuan",
    }));
    expect(fetchJsonMock).not.toHaveBeenCalledWith("/api/sessions", expect.anything());
    expect(addWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "新书《仙路长明》写作会话",
      agentId: "writer",
      sessionId: "session-book-demo",
      sessionMode: "chat",
    }));
    expect(nav.toSessions).toHaveBeenCalledTimes(1);
    expect(nav.toBook).not.toHaveBeenCalled();
  });

  it("shows actionable guidance when the book scaffold is ready but default session creation fails", async () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toSessions: vi.fn(),
      toProjectCreate: vi.fn(),
    } as any;

    postApiMock.mockResolvedValueOnce({
      bookId: "book-demo",
      status: "creating",
      defaultSession: createDefaultSessionResponse("book-demo"),
      defaultSessionSnapshot: null,
    });
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/books/book-demo") {
        return { id: "book-demo" };
      }
      throw new Error(`Unexpected fetchJson call: ${url}`);
    });

    render(
      <BookCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
        projectCreateDraft={{
          title: "仙路长明",
          projectInit: {
            repositorySource: "new",
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "xianlu-main",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建书籍并进入工作区" }));

    await waitFor(() => {
      expect(screen.getByText(/书籍骨架已经创建成功/)).toBeTruthy();
    });
    expect(screen.getByText(/默认写作会话创建失败/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "先看书籍详情" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "先看书籍详情" }));
    expect(nav.toBook).toHaveBeenCalledWith("book-demo");
    expect(nav.toSessions).not.toHaveBeenCalled();
    expect(addWindowMock).not.toHaveBeenCalled();
  });
});
