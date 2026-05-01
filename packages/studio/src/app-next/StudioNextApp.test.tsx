import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/use-api", () => ({
  useApi: useApiMock,
  fetchJson: fetchJsonMock,
  putApi: vi.fn().mockResolvedValue({}),
}));

vi.mock("../hooks/use-ai-model-gate", () => ({
  useAiModelGate: () => ({ blockedResult: null, closeGate: vi.fn(), ensureModelFor: vi.fn(() => true) }),
}));

vi.mock("../components/InkEditor", () => ({
  getMarkdown: () => "",
  InkEditor: vi.fn(() => null),
}));

import { StudioNextApp } from "./StudioNextApp";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/books") return { data: { books: [{ id: "b1", title: "测试书" }] }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/books/b1") return { data: { book: { id: "b1", title: "测试书" }, chapters: [], nextChapter: 1 }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/books/b1/candidates") return { data: { candidates: [] }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/user") return { data: { modelDefaults: {}, runtimeControls: {} }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/release") return { data: { version: "0.1.0" }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/metrics") return { data: {}, loading: false, error: null, refetch: vi.fn() };
    if (path === "/providers") return { data: { providers: [] }, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
  fetchJsonMock.mockImplementation((path: string) => {
    if (path === "/settings/user") return Promise.resolve({ profile: {}, preferences: { theme: "light", fontSize: 14 }, runtimeControls: { defaultPermissionMode: "ask", toolAccess: { mcpStrategy: "inherit" }, recovery: {}, runtimeDebug: {} }, modelDefaults: {} });
    if (path === "/api/providers/models") return Promise.resolve({ models: [] });
    if (path === "/settings/metrics") return Promise.resolve({});
    return Promise.resolve({});
  });
});

describe("StudioNextApp", () => {
  it("defaults to the novel writing workspace instead of the legacy dashboard", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    expect(screen.getByRole("navigation", { name: "Studio Next 主导航" })).toBeTruthy();
    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByText("资源管理器")).toBeTruthy();
    expect(screen.getByText("驾驶舱")).toBeTruthy();
  });

  it("switches between the first-phase workspace, settings and routines pages", async () => {
    render(<StudioNextApp initialRoute="workspace" />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("个人设置")).toBeTruthy();
    expect(screen.getByText("实例管理")).toBeTruthy();
    const settingsNav = screen.getByRole("navigation", { name: "设置分区" });
    expect(within(settingsNav).getByRole("button", { name: /个人资料/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /模型/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /AI 供应商/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "套路" }));
    expect(screen.getByText("正在加载 Routines 配置…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "创作工作台" }));
    expect(screen.getByText("资源管理器")).toBeTruthy();
  });

  it("shows imported chapters in the workspace resource tree after dashboard chapter import", async () => {
    let bookDetail: {
      book: { id: string; title: string };
      chapters: Array<{ number: number; title: string; status: string; wordCount: number; updatedAt: string }>;
      nextChapter: number;
    } = { book: { id: "b1", title: "测试书" }, chapters: [], nextChapter: 1 };
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: { books: [{ id: "b1", title: "测试书" }] }, loading: false, error: null, refetch: vi.fn() };
      if (path === "/books/b1") return { data: bookDetail, loading: false, error: null, refetch: vi.fn() };
      if (path === "/books/b1/candidates") return { data: { candidates: [] }, loading: false, error: null, refetch: vi.fn() };
      if (path === "/books/b1/story-files") return { data: { files: [] }, loading: false, error: null, refetch: vi.fn() };
      if (path === "/books/b1/truth-files") return { data: { files: [] }, loading: false, error: null, refetch: vi.fn() };
      if (path === "/books/b1/drafts") return { data: { drafts: [] }, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    fetchJsonMock.mockImplementation((path: string) => {
      if (path === "/books/b1/import/chapters") {
        bookDetail = {
          book: { id: "b1", title: "测试书" },
          chapters: [{ number: 1, title: "第一章 导入章", status: "imported", wordCount: 8, updatedAt: "2026-04-29T00:00:00.000Z" }],
          nextChapter: 2,
        };
        return Promise.resolve({ importedCount: 1 });
      }
      if (path === "/books/b1/chapters/1") return Promise.resolve({ content: "# 第一章 导入章\n\n导入正文" });
      return Promise.resolve({});
    });

    render(<StudioNextApp initialRoute="dashboard" />);
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByPlaceholderText("粘贴章节文本，系统会自动按章节标题分割…"), { target: { value: "第一章 导入章\n导入正文" } });
    fireEvent.click(screen.getByRole("button", { name: "导入章节" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/books/b1/import/chapters", expect.objectContaining({ method: "POST" })));
    fireEvent.click(screen.getByRole("button", { name: "测试书" }));

    const explorer = await screen.findByRole("complementary", { name: "小说资源管理器" });
    expect(within(explorer).getByRole("button", { name: /第一章 导入章/ })).toBeTruthy();
  });
});
