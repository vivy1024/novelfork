import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SessionsTab } from "./SessionsTab";
import type { AddWindowInput, ChatWindow as ChatWindowState } from "@/stores/windowStore";
import type { WindowRecoveryState } from "@/stores/windowRuntimeStore";

interface MockWindowStore {
  windows: ChatWindowState[];
  activeWindowId: string | null;
  addWindow: (input: AddWindowInput) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindowState>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  updateLayout: (id: string, position: ChatWindowState["position"]) => void;
}

interface MockRuntimeStore {
  wsConnections: Record<string, boolean>;
  recoveryStates: Record<string, WindowRecoveryState>;
  setWsConnected: (windowId: string, connected: boolean) => void;
  setRecoveryState: (windowId: string, state: WindowRecoveryState) => void;
  clearWindowRuntime: (windowId: string) => void;
}

let windowMock: MockWindowStore = emptyWindowMock();
let runtimeMock: MockRuntimeStore = emptyRuntimeMock();

vi.mock("@/stores/windowStore", () => {
  const useMock = ((selector: (state: MockWindowStore) => unknown) => selector(windowMock)) as any;
  useMock.getState = () => windowMock;
  useMock.setState = (partial: Partial<MockWindowStore>) => {
    windowMock = { ...windowMock, ...partial };
  };
  return { useWindowStore: useMock };
});

vi.mock("@/stores/windowRuntimeStore", async () => {
  const actual = await vi.importActual<typeof import("@/stores/windowRuntimeStore")>(
    "@/stores/windowRuntimeStore",
  );
  const useMock = ((selector: (state: MockRuntimeStore) => unknown) => selector(runtimeMock)) as any;
  useMock.getState = () => runtimeMock;
  useMock.setState = (partial: Partial<MockRuntimeStore>) => {
    runtimeMock = { ...runtimeMock, ...partial };
  };
  return { ...actual, useWindowRuntimeStore: useMock };
});

afterEach(() => {
  cleanup();
  windowMock = emptyWindowMock();
  runtimeMock = emptyRuntimeMock();
});

describe("Admin · SessionsTab", () => {
  it("shows an empty state when no ChatWindow instance is open", () => {
    render(<SessionsTab />);
    expect(screen.getByText(/当前没有打开的会话工作台窗口/)).toBeTruthy();
  });

  it("renders one row per open window with the shared recovery presentation badge", () => {
    windowMock = {
      ...emptyWindowMock(),
      windows: [
        {
          id: "window-1",
          title: "Writer 会话",
          agentId: "writer",
          sessionId: "session-abc",
          sessionMode: "chat",
          position: { x: 0, y: 0, w: 6, h: 8 },
          minimized: false,
        },
        {
          id: "window-2",
          title: "Planner 会话",
          agentId: "planner",
          sessionId: "session-xyz",
          sessionMode: "plan",
          position: { x: 6, y: 0, w: 6, h: 8 },
          minimized: true,
        },
      ],
      activeWindowId: "window-1",
    };
    runtimeMock = {
      ...emptyRuntimeMock(),
      wsConnections: { "window-1": true, "window-2": false },
      recoveryStates: { "window-1": "idle", "window-2": "replaying" },
    };

    render(<SessionsTab />);

    expect(screen.getByText("打开的工作台")).toBeTruthy();

    const row1 = screen.getByTestId("admin-session-row-window-1");
    expect(row1.textContent).toContain("session-abc");
    expect(row1.textContent).toContain("实时同步");
    expect(row1.textContent).toContain("聚焦");

    const row2 = screen.getByTestId("admin-session-row-window-2");
    expect(row2.textContent).toContain("session-xyz");
    expect(row2.textContent).toContain("回放中");
    expect(row2.textContent).toContain("已收起");
  });

  it("reflects unbound sessionId gracefully", () => {
    windowMock = {
      ...emptyWindowMock(),
      windows: [
        {
          id: "window-unbound",
          title: "草稿",
          agentId: "writer",
          sessionMode: "chat",
          position: { x: 0, y: 0, w: 6, h: 8 },
          minimized: false,
        },
      ],
      activeWindowId: "window-unbound",
    };

    render(<SessionsTab />);

    const row = screen.getByTestId("admin-session-row-window-unbound");
    expect(row.textContent).toContain("(未绑定)");
  });
});

function emptyWindowMock(): MockWindowStore {
  return {
    windows: [],
    activeWindowId: null,
    addWindow: () => {},
    removeWindow: () => {},
    updateWindow: () => {},
    toggleMinimize: () => {},
    setActiveWindow: () => {},
    updateLayout: () => {},
  };
}

function emptyRuntimeMock(): MockRuntimeStore {
  return {
    wsConnections: {},
    recoveryStates: {},
    setWsConnected: () => {},
    setRecoveryState: () => {},
    clearWindowRuntime: () => {},
  };
}
