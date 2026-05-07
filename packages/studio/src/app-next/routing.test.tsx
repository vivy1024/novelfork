import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useShellDataMock = vi.hoisted(() => vi.fn());

vi.mock("./shell", async () => {
  const actual = await vi.importActual<typeof import("./shell")>("./shell");
  return {
    ...actual,
    useShellData: useShellDataMock,
  };
});

vi.mock("../hooks/use-ai-model-gate", () => ({
  useAiModelGate: () => ({ blockedResult: null, closeGate: vi.fn(), ensureModelFor: vi.fn(() => true) }),
}));

vi.mock("../components/InkEditor", () => ({
  getMarkdown: () => "",
  InkEditor: vi.fn(() => null),
}));

import { resolveStudioNextRoute } from "./entry";
import { StudioNextApp } from "./StudioNextApp";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  useShellDataMock.mockReturnValue({
    books: [{ id: "b1", title: "测试书" }],
    sessions: [],
    providerSummary: null,
    providerStatus: null,
    loading: false,
    error: null,
  });
});

describe("Studio Next routing", () => {
  it("resolves sub-routes within the entry", () => {
    expect(resolveStudioNextRoute("/next")).toEqual({ kind: "home" });
    expect(resolveStudioNextRoute("/next/narrators/s1")).toEqual({ kind: "narrator", sessionId: "s1" });
    expect(resolveStudioNextRoute("/next/books/b1")).toEqual({ kind: "book", bookId: "b1" });
    expect(resolveStudioNextRoute("/next/settings")).toEqual({ kind: "settings" });
    expect(resolveStudioNextRoute("/next/routines")).toEqual({ kind: "routines" });
    expect(resolveStudioNextRoute("/next/search")).toEqual({ kind: "search" });
    expect(resolveStudioNextRoute("/next/unknown")).toEqual({ kind: "home" });
  });

  it("renders shell sidebar and content area", () => {
    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    const sidebar = screen.getByTestId("shell-sidebar");
    expect(sidebar).toBeTruthy();
    expect(within(screen.getByTestId("shell-main")).getByRole("heading", { name: "作者首页" })).toBeTruthy();
  });

  it("shows author-facing home sections instead of the Agent Shell placeholder", () => {
    useShellDataMock.mockReturnValue({
      books: [{ id: "book-1", title: "灵潮纪元", status: "drafting", genre: "xuanhuan", totalChapters: 1, totalWords: 3000, progress: 30 }],
      sessions: [{
        id: "session-1",
        title: "主叙述者",
        agentId: "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: "2026-05-04T00:00:00.000Z",
        lastModified: "2026-05-04T00:00:00.000Z",
        messageCount: 0,
        sortOrder: 0,
        projectId: "book-1",
        sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
      }],
      providerSummary: { providers: [{ id: "sub2api", label: "Sub2API" }], activeProviderId: "sub2api" },
      providerStatus: { configured: true, providerId: "sub2api", modelId: "gpt-5.4" },
      loading: false,
      error: null,
    });

    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    const main = screen.getByTestId("shell-main");
    expect(within(main).getByRole("heading", { name: "最近作品" })).toBeTruthy();
    expect(within(main).getByRole("heading", { name: "最近会话" })).toBeTruthy();
    expect(within(main).getByRole("heading", { name: "模型健康" })).toBeTruthy();
    expect(within(main).getByRole("button", { name: "新建作品" })).toBeTruthy();
    expect(within(main).getByRole("button", { name: "新建会话" })).toBeTruthy();
    expect(within(main).getByRole("button", { name: "打开设置" })).toBeTruthy();
  });

  it("shows an empty state when the home shell has no books, sessions, or provider data", () => {
    useShellDataMock.mockReturnValue({
      books: [],
      sessions: [],
      providerSummary: null,
      providerStatus: null,
      loading: false,
      error: null,
    });

    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    const main = screen.getByTestId("shell-main");
    expect(within(main).getByText("还没有可用内容，先新建作品或新建会话。")).toBeTruthy();
    expect(within(main).getByRole("button", { name: "新建作品" })).toBeTruthy();
    expect(within(main).getByRole("heading", { name: "最近作品" })).toBeTruthy();
    expect(within(main).getByRole("heading", { name: "最近会话" })).toBeTruthy();
  });
});
