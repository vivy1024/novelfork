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

const presetBundlesMock = [
  {
    id: "mortal-sect-xianxia",
    name: "凡人宗门修仙",
    category: "bundle",
    description: "宗门/家族/资源分配驱动的修仙基底。",
    promptInjection: "",
    genreIds: ["xuanhuan"],
    toneId: "austere-pragmatic",
    settingBaseId: "sect-family-xianxia",
    logicRiskIds: ["information-flow"],
    difficulty: "medium",
    prerequisites: ["资源账本"],
    suitableFor: ["凡人流"],
    notSuitableFor: ["纯沙雕"],
  },
];

const presetsMock = [
  {
    id: "austere-pragmatic",
    name: "冷峻质朴",
    category: "tone",
    description: "克制而冷硬的语言质感。",
    promptInjection: "tone:austere-pragmatic",
    compatibleGenres: ["xuanhuan"],
    conflictGroup: "tone",
  },
  {
    id: "tragic-solitude",
    name: "悲苦孤独",
    category: "tone",
    description: "悲苦而克制。",
    promptInjection: "tone:tragic-solitude",
    compatibleGenres: ["xuanhuan"],
    conflictGroup: "tone",
  },
  {
    id: "sect-family-xianxia",
    name: "宗门家族修仙社会",
    category: "setting-base",
    description: "宗门、家族与资源分配。",
    promptInjection: "setting:sect-family-xianxia",
    compatibleGenres: ["xuanhuan"],
    conflictGroup: "setting-base",
  },
  {
    id: "historical-court-livelihood",
    name: "朝堂民生基底",
    category: "setting-base",
    description: "朝堂、民生、军政与技术差。",
    promptInjection: "setting:historical-court-livelihood",
    compatibleGenres: ["xuanhuan"],
    conflictGroup: "setting-base",
  },
  {
    id: "information-flow",
    name: "信息传播速度",
    category: "logic-risk",
    description: "检查消息传播和认知边界。",
    promptInjection: "logic:information-flow",
    compatibleGenres: ["xuanhuan"],
  },
  {
    id: "institution-response",
    name: "机构响应",
    category: "logic-risk",
    description: "检查制度和组织的反应。",
    promptInjection: "logic:institution-response",
    compatibleGenres: ["xuanhuan"],
  },
];

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
    if (url === "/api/presets/bundles") {
      return { data: { bundles: presetBundlesMock } };
    }
    if (url === "/api/presets") {
      return { data: { presets: presetsMock } };
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

  it("applies a recommended bundle and lets authors toggle individual preset items before create", async () => {
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

    expect(screen.getByText("写作预设")).toBeTruthy();
    const bundleButton = screen.getByRole("button", { name: /凡人宗门修仙/ });
    fireEvent.click(bundleButton);
    expect(bundleButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("启用项")).toBeTruthy();
    expect(screen.getByRole("button", { name: "austere-pragmatic" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "sect-family-xianxia" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "information-flow" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("适合：凡人流")).toBeTruthy();
    expect(screen.getByText("不适合：纯沙雕")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "information-flow" }));
    expect(screen.getByRole("button", { name: "information-flow" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "information-flow" }));
    expect(screen.getByRole("button", { name: "information-flow" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "austere-pragmatic" }));
    expect(screen.getByRole("button", { name: "austere-pragmatic" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "创建本地书籍" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/create", expect.objectContaining({
        enabledPresetIds: [
          "sect-family-xianxia",
          "information-flow",
        ],
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
