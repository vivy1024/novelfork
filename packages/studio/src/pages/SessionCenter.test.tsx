import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SessionCenter } from "./SessionCenter";
import { useWindowStore } from "@/stores/windowStore";
import type { ChatMessage, ChatWindow } from "@/stores/windowStore";

vi.mock("@/components/ChatWindowManager", () => ({
  ChatWindowManager: () => <div data-testid="chat-window-manager" />,
}));

interface MockWindowStore {
  windows: ChatWindow[];
  activeWindowId: string | null;
  addWindow: (agentId: string, title: string) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindow>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  addMessage: (windowId: string, message: ChatMessage) => void;
  updateLayout: (id: string, position: ChatWindow["position"]) => void;
  setWsConnected: (windowId: string, connected: boolean) => void;
}

let mockState: MockWindowStore = createMockState();

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

afterEach(() => {
  cleanup();
  mockState = createMockState();
});

describe("SessionCenter", () => {
  it("opens a preset session dialog and creates a structured session", () => {
    render(<SessionCenter theme="light" />);

    expect(screen.getByText("会话对象入口")).toBeTruthy();
    expect(screen.getByText("会话对象列表")).toBeTruthy();
    expect(screen.getByTestId("chat-window-manager")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /规划 Planner/ }));

    expect(screen.getByRole("heading", { name: "新建会话" })).toBeTruthy();
    expect((screen.getByLabelText("Agent ID") as HTMLInputElement).value).toBe("planner");
    expect((screen.getByLabelText("会话标题") as HTMLInputElement).value).toBe("Planner 会话");

    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    const windows = useWindowStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.agentId).toBe("planner");
    expect(windows[0]?.title).toBe("Planner 会话");
  });

  it("renders existing session cards as object entries", () => {
    mockState = createMockState({
      windows: [
        {
          id: "window-1",
          title: "Writer 会话",
          agentId: "writer",
          position: { x: 1, y: 2, w: 6, h: 8 },
          minimized: false,
          messages: [
            { id: "msg-1", role: "user", content: "写下一章", timestamp: Date.now() },
          ],
          wsConnected: true,
        },
      ],
      activeWindowId: "window-1",
    });

    render(<SessionCenter theme="light" />);

    expect(screen.getByText("Writer 会话")).toBeTruthy();
    expect(screen.getByText(/Agent writer/)).toBeTruthy();
    expect(screen.getByText("1 条消息")).toBeTruthy();
    expect(screen.getByRole("button", { name: "聚焦" })).toBeTruthy();
  });
});

function createMockState(overrides?: Partial<MockWindowStore>): MockWindowStore {
  return Object.assign(baseMockState(), overrides ?? {});
}

function baseMockState(): MockWindowStore {
  const state: MockWindowStore = {
    windows: [] as ChatWindow[],
    activeWindowId: null as string | null,
    addWindow(agentId: string, title: string) {
      const id = `window-${state.windows.length + 1}`;
      state.windows = [
        ...state.windows,
        {
          id,
          title,
          agentId,
          position: { x: (state.windows.length * 2) % 10, y: (state.windows.length * 2) % 10, w: 6, h: 8 },
          minimized: false,
          messages: [],
          wsConnected: false,
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
    addMessage(windowId: string, message: { id: string; role: "user" | "assistant" | "system"; content: string; timestamp: number }) {
      state.windows = state.windows.map((window) =>
        window.id === windowId ? { ...window, messages: [...window.messages, message] } : window,
      );
    },
    setWsConnected(windowId: string, connected: boolean) {
      state.windows = state.windows.map((window) =>
        window.id === windowId ? { ...window, wsConnected: connected } : window,
      );
    },
  };

  return state;
}
