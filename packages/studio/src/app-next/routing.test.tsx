import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

import { resolveStudioNextRoute } from "./entry";
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
    return Promise.resolve({});
  });
});

describe("Studio Next routing", () => {
  it("resolves sub-routes within the entry", () => {
    expect(resolveStudioNextRoute("/next")).toBe("workspace");
    expect(resolveStudioNextRoute("/next/dashboard")).toBe("dashboard");
    expect(resolveStudioNextRoute("/next/settings")).toBe("settings");
    expect(resolveStudioNextRoute("/next/routines")).toBe("routines");
    expect(resolveStudioNextRoute("/next/workflow")).toBe("workflow");
    expect(resolveStudioNextRoute("/next/search")).toBe("search");
    expect(resolveStudioNextRoute("/next/unknown")).toBe("workspace");
  });

  it("navigates between all three first-phase pages without page reload", () => {
    render(<StudioNextApp initialRoute="workspace" />);
    expect(screen.getByText("资源管理器")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("个人设置")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "套路" }));
    expect(screen.getByText("正在加载 Routines 配置…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "创作工作台" }));
    expect(screen.getByText("资源管理器")).toBeTruthy();
  });

  it("settings page supports section switching — only right side updates", () => {
    render(<StudioNextApp initialRoute="settings" />);
    const settingsNav = screen.getByRole("navigation", { name: "设置分区" });
    expect(within(settingsNav).getByRole("button", { name: /个人资料/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /AI 供应商/ })).toBeTruthy();
  });

  it("workspace resource tree click updates the central editor", () => {
    render(<StudioNextApp initialRoute="workspace" />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    expect(within(explorer).getByText("资源管理器")).toBeTruthy();
  });

  it("workspace top bar has publish readiness without exposing preset management", () => {
    render(<StudioNextApp initialRoute="workspace" />);
    expect(screen.getByText("发布就绪")).toBeTruthy();
    expect(screen.queryByText("预设管理")).toBeNull();
  });

  it("workspace writing tools panel is accessible from the assistant panel", () => {
    render(<StudioNextApp initialRoute="workspace" />);
    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByRole("button", { name: "写作" }));
    expect(within(assistant).getByText("写作工具")).toBeTruthy();
  });
});
