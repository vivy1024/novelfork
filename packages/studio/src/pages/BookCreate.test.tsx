import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();
let providerStatusMock = {
  hasUsableModel: false,
  defaultProvider: undefined as string | undefined,
  defaultModel: undefined as string | undefined,
};

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
    if (url === "/providers/status") {
      return { data: { status: providerStatusMock } };
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
    providerStatusMock = {
      hasUsableModel: false,
      defaultProvider: undefined,
      defaultModel: undefined,
    };
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
        permissionMode: "edit",
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

  it("presents local-first book creation even when AI model setup is not done", () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toProjectCreate: vi.fn(),
    };

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

    expect(screen.getAllByText(/尚未配置 AI 模型/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/仍可先创建本地书籍/).length).toBeGreaterThan(0);
    expect(screen.getByText("AI 初始化")).toBeTruthy();
    expect(screen.getByText(/配置模型后可启用初始经纬、简介卖点和前三章方向生成/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "生成初始故事经纬" })).toBeNull();
    expect(screen.getByText("故事经纬结构")).toBeTruthy();
    expect(screen.getByRole("button", { name: /基础经纬/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建本地书籍" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "创建书籍并进入工作区" })).toBeNull();
  });

  it("submits the selected jingwei template with the local book request", async () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toProjectCreate: vi.fn(),
    };
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

    fireEvent.click(screen.getByRole("button", { name: /增强经纬/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/create", expect.objectContaining({
        jingweiTemplate: { templateId: "enhanced" },
      }));
    });
  });

  it("offers optional AI initialization when a usable model exists", async () => {
    providerStatusMock = {
      hasUsableModel: true,
      defaultProvider: "openai",
      defaultModel: "gpt-4-turbo",
    };
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toProjectCreate: vi.fn(),
    };
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

    expect(screen.getByText(/当前模型：openai \/ gpt-4-turbo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "生成初始故事经纬" }));
    fireEvent.click(screen.getByRole("switch", { name: "生成简介 / 卖点" }));
    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/create", expect.objectContaining({
        aiInitialization: {
          generateJingwei: true,
          generatePitch: true,
          generateFirstChapterDirections: false,
        },
      }));
    });
  });

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

    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

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

    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

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

    expect(screen.getByText(/未配置 AI 模型也不影响本地写作/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

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

    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

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
