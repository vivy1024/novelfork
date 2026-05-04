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

describe("StudioNextApp", () => {
  it("renders Agent Shell sidebar with storyline and narrator sections", () => {
    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    const sidebar = screen.getByTestId("shell-sidebar");
    expect(sidebar.textContent).toContain("NovelFork Studio");
    expect(sidebar.textContent).toContain("叙事线");
    expect(sidebar.textContent).toContain("叙述者");
    expect(sidebar.textContent).toContain("套路");
    expect(sidebar.textContent).toContain("设置");
  });

  it("shows books in sidebar storyline", () => {
    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    const sidebar = screen.getByTestId("shell-sidebar");
    expect(sidebar.textContent).toContain("测试书");
  });

  it("renders shell home placeholder in main content area", () => {
    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    expect(within(screen.getByTestId("shell-main")).getByRole("heading", { name: "Agent Shell" })).toBeTruthy();
  });

  it("mounts Agent Conversation for narrator routes", () => {
    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    expect(screen.getByTestId("conversation-route").getAttribute("data-session-id")).toBe("session-1");
    expect(screen.getByText("session-1")).toBeTruthy();
  });

  it("mounts Writing Workbench for book routes", () => {
    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    expect(screen.getByTestId("writing-workbench-route").getAttribute("data-book-id")).toBe("b1");
    expect(screen.getByText("选择左侧资源开始写作")).toBeTruthy();
  });

  it("renders settings mount point when navigated", () => {
    render(<StudioNextApp initialRoute={{ kind: "settings" }} />);

    expect(within(screen.getByTestId("shell-main")).getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.getByText("设置入口已接入 Agent Shell，详细面板稍后接线。")).toBeTruthy();
  });

  it("renders routines mount point when navigated", () => {
    render(<StudioNextApp initialRoute={{ kind: "routines" }} />);

    expect(screen.getByText("Routines 入口已接入 Agent Shell，配置面板稍后接线。")).toBeTruthy();
  });
});
