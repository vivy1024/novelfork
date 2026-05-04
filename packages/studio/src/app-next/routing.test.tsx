import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock, fetchJsonMock, settingsUserState } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  fetchJsonMock: vi.fn(),
  settingsUserState: { preferences: { workbenchMode: true } },
}));

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
  settingsUserState.preferences.workbenchMode = true;
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/books") return { data: { books: [{ id: "b1", title: "测试书" }] }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/books/b1") return { data: { book: { id: "b1", title: "测试书" }, chapters: [], nextChapter: 1 }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/books/b1/candidates") return { data: { candidates: [] }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/user") return { data: { preferences: settingsUserState.preferences, modelDefaults: {}, runtimeControls: {} }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/release") return { data: { version: "0.1.0" }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/metrics") return { data: {}, loading: false, error: null, refetch: vi.fn() };
    if (path === "/providers") return { data: { providers: [] }, loading: false, error: null, refetch: vi.fn() };
    if (path?.startsWith("/sessions")) return { data: { sessions: [] }, loading: false, error: null, refetch: vi.fn() };
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
    expect(resolveStudioNextRoute("/next/sessions")).toBe("sessions");
    expect(resolveStudioNextRoute("/next/unknown")).toBe("workspace");
  });

  it("renders sidebar with storyline and narrator sections", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    const sidebar = screen.getByTestId("studio-sidebar");
    expect(sidebar.textContent).toContain("叙事线");
    expect(sidebar.textContent).toContain("叙述者");
    expect(sidebar.textContent).toContain("套路");
    expect(sidebar.textContent).toContain("设置");
  });

  it("navigates to settings page", () => {
    render(<StudioNextApp initialRoute="settings" />);

    expect(screen.getByText("个人设置")).toBeTruthy();
  });

  it("navigates to routines page", () => {
    render(<StudioNextApp initialRoute="routines" />);

    expect(screen.getByText("正在加载 Routines 配置…")).toBeTruthy();
  });

  it("renders workspace by default with resource tree", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    expect(screen.getByText("资源管理器")).toBeTruthy();
  });

  it("shows books in storyline", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    const sidebar = screen.getByTestId("studio-sidebar");
    expect(sidebar.textContent).toContain("测试书");
  });
});
