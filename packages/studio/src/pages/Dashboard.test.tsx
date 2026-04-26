import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "./Dashboard";

const { useApiMock, fetchJsonMock, postApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  fetchJsonMock: vi.fn(),
  postApiMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
  useApi: (...args: unknown[]) => useApiMock(...args),
}));

vi.mock("@/lib/notify", () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const t = (key: string) => {
  const map: Record<string, string> = {
    "dash.title": "书库",
    "dash.subtitle": "管理你的故事",
    "nav.newBook": "新建书籍",
    "dash.chapters": "章",
    "dash.writeNext": "写下一章",
    "dash.writing": "写作中",
    "dash.stats": "统计",
    "book.settings": "设置",
    "book.export": "导出",
    "book.deleteBook": "删除书籍",
    "book.statusActive": "连载中",
    "book.statusPaused": "暂停",
    "book.statusOutlining": "大纲中",
    "book.statusCompleted": "完结",
    "book.statusDropped": "弃坑",
    "common.delete": "删除",
    "common.cancel": "取消",
    "book.confirmDelete": "确认删除",
    "dash.noBooks": "还没有书籍",
    "dash.createFirst": "创建第一本书",
  };
  return map[key] ?? key;
};

function mockApi({ dismissedGettingStarted = false } = {}) {
  useApiMock.mockImplementation((path: string) => {
    if (path === "/books") {
      return {
        data: {
          books: [
            {
              id: "book-1",
              title: "烟测样书",
              genre: "horror",
              status: "active",
              chaptersWritten: 0,
            },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (path === "/onboarding/status") {
      return {
        data: {
          status: {
            dismissedGettingStarted,
            provider: { hasUsableModel: false },
            tasks: {
              modelConfigured: false,
              hasAnyBook: true,
              hasOpenedJingwei: false,
              hasAnyChapter: false,
              hasTriedAiWriting: false,
              hasTriedAiTasteScan: false,
              hasReadWorkbenchIntro: false,
            },
          },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (path === "/daily-stats") {
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    }
    if (path === "/providers/status") {
      return {
        data: { status: { hasUsableModel: false } },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
}

describe("Dashboard getting started checklist", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    mockApi();
  });

  it("renders the getting-started checklist on the dashboard", () => {
    render(
      <Dashboard
        nav={{
          toBook: vi.fn(),
          toAnalytics: vi.fn(),
          toBookCreate: vi.fn(),
          toAdmin: vi.fn(),
        }}
        sse={{ messages: [] }}
        theme="light"
        t={t}
      />,
    );

    expect(screen.getByText("开始使用 NovelFork")).toBeTruthy();
    expect(screen.getByText("未配置模型，不影响本地写作")).toBeTruthy();
    expect(screen.getByRole("button", { name: /试用 AI 写作与评点/ })).toBeTruthy();
  });

  it("persists checklist dismissal and keeps a reopen entry", () => {
    fetchJsonMock.mockResolvedValueOnce({ status: { dismissedGettingStarted: true } });

    render(
      <Dashboard
        nav={{
          toBook: vi.fn(),
          toAnalytics: vi.fn(),
          toBookCreate: vi.fn(),
          toAdmin: vi.fn(),
        }}
        sse={{ messages: [] }}
        theme="light"
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭任务清单" }));

    expect(fetchJsonMock).toHaveBeenCalledWith("/onboarding/status", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ dismissedGettingStarted: true }),
    }));
    expect(screen.getByRole("button", { name: "重新打开任务清单" })).toBeTruthy();
  });

  it("reopens a dismissed checklist from the dashboard", () => {
    mockApi({ dismissedGettingStarted: true });
    fetchJsonMock.mockResolvedValueOnce({ status: { dismissedGettingStarted: false } });

    render(
      <Dashboard
        nav={{
          toBook: vi.fn(),
          toAnalytics: vi.fn(),
          toBookCreate: vi.fn(),
          toAdmin: vi.fn(),
        }}
        sse={{ messages: [] }}
        theme="light"
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新打开任务清单" }));

    expect(fetchJsonMock).toHaveBeenCalledWith("/onboarding/status", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ dismissedGettingStarted: false }),
    }));
  });

  it("shows the AI gate instead of posting write-next when checklist CTA has no model", async () => {
    render(
      <Dashboard
        nav={{
          toBook: vi.fn(),
          toAnalytics: vi.fn(),
          toBookCreate: vi.fn(),
          toAdmin: vi.fn(),
        }}
        sse={{ messages: [] }}
        theme="light"
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /试用 AI 写作与评点/ }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    expect(postApiMock).not.toHaveBeenCalled();
  });

  it("shows the AI gate instead of posting card write-next when no model is configured", async () => {
    render(
      <Dashboard
        nav={{
          toBook: vi.fn(),
          toAnalytics: vi.fn(),
          toBookCreate: vi.fn(),
          toAdmin: vi.fn(),
        }}
        sse={{ messages: [] }}
        theme="light"
        t={t}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "写下一章" })[0]!);

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    expect(postApiMock).not.toHaveBeenCalled();
  });
});
