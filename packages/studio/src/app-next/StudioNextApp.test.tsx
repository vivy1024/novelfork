import { cleanup, render, screen } from "@testing-library/react";
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
    if (path === "/settings/user") return { data: { preferences: { workbenchMode: true }, modelDefaults: {}, runtimeControls: {} }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/release") return { data: { version: "0.1.0" }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/metrics") return { data: {}, loading: false, error: null, refetch: vi.fn() };
    if (path === "/providers") return { data: { providers: [] }, loading: false, error: null, refetch: vi.fn() };
    if (path?.startsWith("/sessions")) return { data: { sessions: [] }, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
  fetchJsonMock.mockResolvedValue({});
});

describe("StudioNextApp", () => {
  it("renders NarraFork-style sidebar with storyline and narrator sections", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    const sidebar = screen.getByTestId("studio-sidebar");
    expect(sidebar.textContent).toContain("NovelFork Studio");
    expect(sidebar.textContent).toContain("叙事线");
    expect(sidebar.textContent).toContain("叙述者");
    expect(sidebar.textContent).toContain("套路");
    expect(sidebar.textContent).toContain("设置");
  });

  it("shows books in sidebar storyline", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    const sidebar = screen.getByTestId("studio-sidebar");
    expect(sidebar.textContent).toContain("测试书");
  });

  it("renders workspace page in main content area", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    expect(screen.getByText("资源管理器")).toBeTruthy();
  });

  it("renders settings page when navigated", () => {
    render(<StudioNextApp initialRoute="settings" />);

    expect(screen.getByText("个人设置")).toBeTruthy();
  });

  it("renders routines page when navigated", () => {
    render(<StudioNextApp initialRoute="routines" />);

    expect(screen.getByText("正在加载 Routines 配置…")).toBeTruthy();
  });
});
