import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SessionCenter } from "./SessionCenter";
import { useWindowRuntimeStore } from "@/stores/windowRuntimeStore";
import { useWindowStore } from "@/stores/windowStore";
import type { AddWindowInput, ChatWindow } from "@/stores/windowStore";
import type { Session } from "@/hooks/useSession";

const fetchJsonMock = vi.fn();
const updateSessionMock = vi.fn();

let sessionHookState: {
  sessions: Session[];
  currentSessionId: string | null;
  loaded: boolean;
  createSession: (...args: unknown[]) => Promise<unknown>;
  loadSession: (...args: unknown[]) => Promise<unknown>;
  renameSession: (...args: unknown[]) => Promise<unknown>;
  removeSession: (...args: unknown[]) => Promise<unknown>;
  updateSession: (...args: unknown[]) => Promise<unknown>;
  reorderSessions: (...args: unknown[]) => Promise<unknown>;
  exportSession: (...args: unknown[]) => Promise<unknown>;
} = createSessionHookState();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => sessionHookState,
}));

vi.mock("@/components/ChatWindowManager", () => ({
  ChatWindowManager: () => <div data-testid="chat-window-manager" />,
}));

interface MockWindowStore {
  windows: ChatWindow[];
  activeWindowId: string | null;
  addWindow: (input: AddWindowInput) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindow>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  updateLayout: (id: string, position: ChatWindow["position"]) => void;
}

interface MockWindowRuntimeStore {
  wsConnections: Record<string, boolean>;
  setWsConnected: (windowId: string, connected: boolean) => void;
  clearWindowRuntime: (windowId: string) => void;
}

let mockState: MockWindowStore = createMockState();
let mockRuntimeState: MockWindowRuntimeStore = createMockRuntimeState();

vi.mock("@/stores/windowStore", () => {
  const useWindowStoreMock = ((selector: (state: MockWindowStore) => unknown) => selector(mockState)) as typeof useWindowStore & {
    getState: () => MockWindowStore;
    setState: (partial: Partial<MockWindowStore>) => void;
  };

  useWindowStoreMock.getState = () => mockState;
  useWindowStoreMock.setState = (partial) => {
    mockState = { ...mockState, ...partial };
  };

  return { useWindowStore: useWindowStoreMock };
});

vi.mock("@/stores/windowRuntimeStore", () => {
  const useWindowRuntimeStoreMock = ((selector: (state: MockWindowRuntimeStore) => unknown) => selector(mockRuntimeState)) as typeof useWindowRuntimeStore & {
    getState: () => MockWindowRuntimeStore;
    setState: (partial: Partial<MockWindowRuntimeStore>) => void;
  };

  useWindowRuntimeStoreMock.getState = () => mockRuntimeState;
  useWindowRuntimeStoreMock.setState = (partial) => {
    mockRuntimeState = { ...mockRuntimeState, ...partial };
  };

  return { useWindowRuntimeStore: useWindowRuntimeStoreMock };
});

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
  updateSessionMock.mockReset();
  sessionHookState = createSessionHookState();
  mockState = createMockState();
  mockRuntimeState = createMockRuntimeState();
});

describe("SessionCenter", () => {
  it("creates a formal narrator session before opening a workspace window", async () => {
    const createSessionMock = vi.fn(async () => createNarratorSession({
      id: "session-1",
      title: "Planner 会话",
      agentId: "planner",
    }));
    sessionHookState = createSessionHookState({
      createSession: createSessionMock,
    });

    render(<SessionCenter theme="light" />);

    expect(screen.getByText("会话对象入口")).toBeTruthy();
    expect(screen.getByText("会话对象列表")).toBeTruthy();
    expect(screen.getByTestId("chat-window-manager")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /规划 Planner/ }));

    expect(screen.getByRole("heading", { name: "新建会话" })).toBeTruthy();
    expect((screen.getAllByLabelText("Agent ID").at(-1) as HTMLInputElement).value).toBe("planner");
    expect((screen.getAllByLabelText("会话标题").at(-1) as HTMLInputElement).value).toBe("Planner 会话");

    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createSessionMock).toHaveBeenCalledWith({
      title: "Planner 会话",
      agentId: "planner",
      sessionMode: "plan",
    });

    const windows = useWindowStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.agentId).toBe("planner");
    expect(windows[0]?.title).toBe("Planner 会话");
    expect(windows[0]?.sessionId).toBe("session-1");
    expect(windows[0]).not.toHaveProperty("wsConnected");
    expect(useWindowRuntimeStore.getState().wsConnections[windows[0]!.id] ?? false).toBe(false);
  });

  it("renders existing session cards as object entries", () => {
    sessionHookState = createSessionHookState({
      sessions: [
        createNarratorSession({
          id: "session-window-1",
          title: "Writer 会话",
          agentId: "writer",
          messageCount: 1,
        }),
      ],
    });
    mockState = createMockState({
      windows: [
        {
          id: "window-1",
          title: "Writer 会话",
          agentId: "writer",
          sessionId: "session-window-1",
          sessionMode: "chat",
          position: { x: 1, y: 2, w: 6, h: 8 },
          minimized: false,
        },
      ],
      activeWindowId: "window-1",
    });
    mockRuntimeState = createMockRuntimeState({
      wsConnections: { "window-1": true },
    });

    render(<SessionCenter theme="light" />);

    expect(screen.getByText("Writer 会话")).toBeTruthy();
    expect(screen.getByText(/Agent writer/)).toBeTruthy();
    expect(screen.getByText("1 条消息")).toBeTruthy();
    expect(screen.getByText("在线")).toBeTruthy();
    expect(screen.getByRole("button", { name: "聚焦工作台" })).toBeTruthy();
  });

  it("renders persisted narrator sessions and supports archive filtering", async () => {
    sessionHookState = createSessionHookState({
      sessions: [
        createNarratorSession({
          id: "session-active",
          title: "Writer 会话",
          agentId: "writer",
          status: "active",
          lastModified: new Date("2026-04-20T10:00:00Z"),
        }),
        createNarratorSession({
          id: "session-archived",
          title: "Archived Planner",
          agentId: "planner",
          sessionMode: "plan",
          status: "archived",
          lastModified: new Date("2026-04-18T10:00:00Z"),
        }),
      ],
    });

    render(<SessionCenter theme="light" />);

    expect(screen.getByText("Writer 会话")).toBeTruthy();
    expect(screen.getByText("Archived Planner")).toBeTruthy();
    expect(screen.getByText("计划模式")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "仅看已归档" }));

    expect(screen.queryByText("Writer 会话")).toBeNull();
    expect(screen.getByText("Archived Planner")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(updateSessionMock).toHaveBeenCalledWith("session-archived", { status: "active" });
  });

  it("opens an existing session workspace without preloading chat state", async () => {
    sessionHookState = createSessionHookState({
      sessions: [
        createNarratorSession({
          id: "session-active",
          title: "Writer 会话",
          agentId: "writer",
          status: "active",
          messageCount: 2,
          lastModified: new Date("2026-04-20T10:00:00Z"),
        }),
      ],
    });

    render(<SessionCenter theme="light" />);

    fireEvent.click(screen.getByRole("button", { name: "打开工作台" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJsonMock).not.toHaveBeenCalled();
    const windows = useWindowStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      title: "Writer 会话",
      agentId: "writer",
      sessionId: "session-active",
    });
  });
});

function createSessionHookState(overrides?: Partial<typeof sessionHookState>) {
  return {
    sessions: [] as Session[],
    currentSessionId: null,
    loaded: true,
    createSession: vi.fn(async () => undefined),
    loadSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    removeSession: vi.fn(async () => undefined),
    updateSession: updateSessionMock,
    reorderSessions: vi.fn(async () => undefined),
    exportSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createNarratorSession(overrides?: Partial<Session>): Session {
  return {
    id: "session-default",
    title: "Default Session",
    agentId: "writer",
    kind: "standalone",
    status: "active",
    createdAt: new Date("2026-04-20T08:00:00Z"),
    lastModified: new Date("2026-04-20T08:00:00Z"),
    messageCount: 0,
    sortOrder: 0,
    sessionConfig: {
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      permissionMode: "allow",
      reasoningEffort: "medium",
    },
    model: "claude-sonnet-4-6",
    sessionMode: "chat",
    ...overrides,
  };
}

function createMockState(overrides?: Partial<MockWindowStore>): MockWindowStore {
  return Object.assign(baseMockState(), overrides ?? {});
}

function baseMockState(): MockWindowStore {
  const state: MockWindowStore = {
    windows: [] as ChatWindow[],
    activeWindowId: null as string | null,
    addWindow(agentIdOrInput: string | { agentId: string; title: string; sessionId?: string; sessionMode?: "chat" | "plan" }, title?: string) {
      const normalized = typeof agentIdOrInput === "string"
        ? { agentId: agentIdOrInput, title: title ?? "Untitled Session" }
        : agentIdOrInput;
      const id = `window-${state.windows.length + 1}`;
      state.windows = [
        ...state.windows,
        {
          id,
          title: normalized.title,
          agentId: normalized.agentId,
          sessionId: normalized.sessionId,
          sessionMode: normalized.sessionMode,
          position: { x: (state.windows.length * 2) % 10, y: (state.windows.length * 2) % 10, w: 6, h: 8 },
          minimized: false,
        },
      ];
      state.activeWindowId = id;
    },
    removeWindow(id: string) {
      state.windows = state.windows.filter((window) => window.id !== id);
      if (state.activeWindowId === id) {
        state.activeWindowId = null;
      }
    },
    toggleMinimize(id: string) {
      state.windows = state.windows.map((window) =>
        window.id === id ? { ...window, minimized: !window.minimized } : window,
      );
    },
    setActiveWindow(id: string | null) {
      state.activeWindowId = id;
    },
    updateWindow(id: string, updates: Partial<ChatWindow>) {
      state.windows = state.windows.map((window) =>
        window.id === id ? { ...window, ...updates } : window,
      );
    },
    updateLayout(id: string, position: { x: number; y: number; w: number; h: number }) {
      state.windows = state.windows.map((window) =>
        window.id === id ? { ...window, position } : window,
      );
    },
  };

  return state;
}

function createMockRuntimeState(overrides?: Partial<MockWindowRuntimeStore>): MockWindowRuntimeStore {
  return Object.assign(baseMockRuntimeState(), overrides ?? {});
}

function baseMockRuntimeState(): MockWindowRuntimeStore {
  const state: MockWindowRuntimeStore = {
    wsConnections: {},
    setWsConnected(windowId: string, connected: boolean) {
      state.wsConnections = {
        ...state.wsConnections,
        [windowId]: connected,
      };
    },
    clearWindowRuntime(windowId: string) {
      const nextConnections = { ...state.wsConnections };
      delete nextConnections[windowId];
      state.wsConnections = nextConnections;
    },
  };

  return state;
}
