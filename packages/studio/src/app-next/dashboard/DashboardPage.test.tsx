import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJsonMock, postApiMock, useApiMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
  postApiMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("../../hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return {
    ...actual,
    fetchJson: fetchJsonMock,
    postApi: postApiMock,
    useApi: useApiMock,
  };
});

import { DashboardPage } from "./DashboardPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchJsonMock.mockReset();
  postApiMock.mockReset();
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/books") {
      return {
        data: { books: [{ id: "book-1", title: "灵潮纪元", status: "active", genre: "xuanhuan", totalChapters: 2, totalWords: 6200, progress: 40 }] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    if (path === "/daily-stats") {
      return {
        data: { todayWords: 3200, todayChapters: 1, trend: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
});

describe("DashboardPage", () => {
  it("uses clear primary/outline semantics for create and import actions with disabled import submit states", () => {
    render(<DashboardPage />);

    const importToggle = screen.getByRole("button", { name: "导入" });
    const createToggle = screen.getByRole("button", { name: "+ 创建新书" });

    expect(importToggle.className).toContain("border-border");
    expect(importToggle.className).toContain("hover:bg-muted");

    expect(createToggle.className).toContain("bg-primary");
    expect(createToggle.className).toContain("text-primary-foreground");

    fireEvent.click(createToggle);

    const submitCreate = screen.getByRole("button", { name: "创建" });
    expect(submitCreate.hasAttribute("disabled")).toBe(true);
    expect(submitCreate.className).toContain("bg-primary");
    expect(submitCreate.className).toContain("disabled:opacity-50");

    fireEvent.change(screen.getByPlaceholderText("输入书名"), { target: { value: "新书测试" } });
    expect(submitCreate.hasAttribute("disabled")).toBe(false);

    fireEvent.click(importToggle);

    const chaptersMode = screen.getByRole("button", { name: "章节文本" });
    const urlMode = screen.getByRole("button", { name: "URL 导入" });
    const importChapters = screen.getByRole("button", { name: "导入章节" });

    expect(chaptersMode.className).toContain("bg-primary");
    expect(chaptersMode.className).toContain("text-primary-foreground");
    expect(urlMode.className).toContain("border-border");
    expect(urlMode.className).toContain("hover:bg-muted");

    expect(importChapters.hasAttribute("disabled")).toBe(true);
    expect(importChapters.className).toContain("bg-primary");
    expect(importChapters.className).toContain("disabled:opacity-50");

    fireEvent.change(screen.getByPlaceholderText("粘贴章节文本，系统会自动按章节标题分割…"), { target: { value: "第一章\n测试内容" } });
    expect(importChapters.hasAttribute("disabled")).toBe(false);

    fireEvent.click(urlMode);
    const importUrl = screen.getByRole("button", { name: "URL 导入暂未接入" });
    expect(importUrl.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/URL 章节导入暂未接入/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("输入 URL 地址"), { target: { value: "https://example.com/chapter-1" } });
    expect(importUrl.hasAttribute("disabled")).toBe(true);
  });

  it("keeps URL chapter import transparent instead of calling a fake success path", () => {
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    fireEvent.click(screen.getByRole("button", { name: "URL 导入" }));
    fireEvent.change(screen.getByPlaceholderText("输入 URL 地址"), { target: { value: "https://example.com/chapter-1" } });

    const importUrl = screen.getByRole("button", { name: "URL 导入暂未接入" });
    expect(importUrl.hasAttribute("disabled")).toBe(true);
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByText(/请先使用章节文本导入/)).toBeTruthy();
  });
});
