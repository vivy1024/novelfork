// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/hooks/use-api";
import { LearnPage } from "./LearnPage";

vi.mock("@/hooks/use-api", () => ({ fetchJson: vi.fn() }));

const mockedFetchJson = vi.mocked(fetchJson);

const indexResponse = {
  categories: [
    { id: "start", label: "从这里开始", description: "核心概念与最短可用路径。" },
    { id: "automation", label: "自动化", description: "套路、技能与工作流。" },
    { id: "novelfork-writing", label: "NovelFork 写作", description: "创建作品、章节与写作工作台。" },
  ],
  docs: [
    {
      id: "overview",
      category: "start",
      title: "一页理解 NovelFork",
      summary: "核心概念",
      tags: ["intro", "workflow"],
      actions: [],
    },
    {
      id: "routines",
      category: "automation",
      title: "套路",
      summary: "可复用自动化流程",
      tags: ["automation"],
      actions: [],
    },
    {
      id: "book-management",
      category: "novelfork-writing",
      title: "小说创建与书籍管理",
      summary: "创建由 Runtime 管理的作品并进入工作台",
      tags: ["novelfork", "books", "写作"],
      actions: [],
    },
  ],
};

const overviewDoc = {
  ...indexResponse.docs[0],
  sections: [{ title: "核心心智模型", body: "叙述者是带工具的 AI 工作会话。" }],
  workflow: ["配置模型"],
  bestPractices: ["先验证再交付"],
  pitfalls: ["不要跳过运行验证"],
  agentHints: ["这个字段属于 Runtime 契约，但原版 Learn 页面不展示。"],
  actions: [{ label: "打开设置", description: "配置模型", href: "/settings" }],
};

const routinesDoc = {
  ...indexResponse.docs[1],
  sections: [{ title: "什么是套路", body: "把稳定流程沉淀为可复用指令。" }],
  workflow: ["识别重复工作流"],
  bestPractices: [],
  pitfalls: [],
  agentHints: [],
  actions: [{ label: "打开套路", description: "管理套路", href: "/routines" }],
};

const novelBooksDoc = {
  ...indexResponse.docs[2],
  sections: [{ title: "可信书籍身份", body: "真实目录与叙述者绑定由 Runtime 服务端维护。" }],
  workflow: ["打开我的作品并新建作品"],
  bestPractices: ["绑定异常时使用修复绑定"],
  pitfalls: ["bookId 不是文件路径"],
  agentHints: [],
  actions: [{ label: "打开我的作品", description: "创建或打开作品", href: "/next/books" }],
};

function installSuccessfulRuntimeMock() {
  mockedFetchJson.mockImplementation(async (path) => {
    if (path.startsWith("/learning?")) return indexResponse as never;
    if (path.startsWith("/learning/overview?")) return overviewDoc as never;
    if (path.startsWith("/learning/routines?")) return routinesDoc as never;
    if (path.startsWith("/learning/book-management?")) return novelBooksDoc as never;
    throw new Error(`unexpected path: ${path}`);
  });
}

afterEach(() => cleanup());

beforeEach(() => {
  mockedFetchJson.mockReset();
  window.history.replaceState(null, "", "/next/learn?doc=overview");
  installSuccessfulRuntimeMock();
});

describe("LearnPage Runtime learning contract", () => {
  it("loads the real index/detail shapes and honors a valid doc deep link", async () => {
    render(<LearnPage />);

    expect(await screen.findByText("核心心智模型")).toBeTruthy();
    expect(screen.getByText("这里汇总 NovelFork 的主要功能文档、使用流程与最佳实践。")).toBeTruthy();
    expect(screen.getByText("叙述者是带工具的 AI 工作会话。")).toBeTruthy();
    expect(screen.getByText("配置模型")).toBeTruthy();
    expect(screen.getByRole("link", { name: /打开设置/ }).getAttribute("href")).toBe("/next/settings");
    expect(screen.queryByText(/这个字段属于 Runtime 契约/)).toBeNull();

    expect(mockedFetchJson.mock.calls.some(([path]) => path === "/learning?lang=zh-CN")).toBe(true);
    expect(mockedFetchJson.mock.calls.some(([path]) => path === "/learning/overview?lang=zh-CN")).toBe(true);
    expect(new URLSearchParams(window.location.search).get("doc")).toBe("overview");
  });

  it("removes an invalid doc deep link and falls back to the first available document", async () => {
    window.history.replaceState(null, "", "/next/learn?doc=missing");
    render(<LearnPage />);

    expect(await screen.findByText("核心心智模型")).toBeTruthy();
    await waitFor(() => expect(new URLSearchParams(window.location.search).has("doc")).toBe(false));
    expect(mockedFetchJson.mock.calls.some(([path]) => path.includes("/learning/missing?"))).toBe(false);
  });

  it("filters the Runtime summaries like the original UI, clears doc in the URL, and loads the first match", async () => {
    render(<LearnPage />);
    await screen.findByText("核心心智模型");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索学习文档" }), { target: { value: "automation" } });

    expect(await screen.findByText("什么是套路")).toBeTruthy();
    expect(screen.queryByText("一页理解 NovelFork")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("automation");
    expect(new URLSearchParams(window.location.search).has("doc")).toBe(false);
    expect(mockedFetchJson.mock.calls.some(([path]) => path.startsWith("/learning/search"))).toBe(false);
    expect(screen.getByRole("link", { name: /打开套路/ }).getAttribute("href")).toBe("/next/routines");
  });

  it("pushes document selections into browser history and keeps the active category expanded", async () => {
    render(<LearnPage />);
    await screen.findByText("核心心智模型");

    const activeCategory = screen.getByRole("button", { name: /从这里开始/ });
    expect(activeCategory.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(activeCategory);
    expect(activeCategory.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /套路可复用自动化流程/ }));
    expect(await screen.findByText("什么是套路")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("doc")).toBe("routines");
  });

  it("shows Runtime and contributed NovelFork docs together and supports a NovelFork deep link", async () => {
    window.history.replaceState(null, "", "/next/learn?doc=book-management");
    render(<LearnPage />);

    expect(await screen.findByText("可信书籍身份")).toBeTruthy();
    expect(screen.getByRole("button", { name: /从这里开始/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /NovelFork 写作/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /打开我的作品/ }).getAttribute("href")).toBe("/next/books");
    expect(new URLSearchParams(window.location.search).get("doc")).toBe("book-management");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索学习文档" }), { target: { value: "写作" } });
    expect(await screen.findByText("可信书籍身份")).toBeTruthy();
    expect(screen.queryByText("一页理解 NovelFork")).toBeNull();
  });

  it("shows retryable catalog and detail errors without presenting fake empty data", async () => {
    mockedFetchJson.mockRejectedValueOnce(new Error("500 Internal Server Error"));
    render(<LearnPage />);

    expect(await screen.findByText(/学习目录加载失败：500 Internal Server Error/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "重试" })[0]);
    expect(await screen.findByText("核心心智模型")).toBeTruthy();

    cleanup();
    mockedFetchJson.mockReset();
    mockedFetchJson.mockImplementation(async (path) => {
      if (path.startsWith("/learning?")) return indexResponse as never;
      throw new Error("404 Learning document not found");
    });
    render(<LearnPage />);

    expect(await screen.findByText(/文档加载失败：404 Learning document not found/)).toBeTruthy();
    const detailCalls = () => mockedFetchJson.mock.calls.filter(([path]) => path.startsWith("/learning/overview?")).length;
    const beforeRetry = detailCalls();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(beforeRetry));
  });
});
