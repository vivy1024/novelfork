import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChatWindow } from "./ChatWindow";
import { useWindowStore } from "@/stores/windowStore";
import type { ChatMessage, ChatWindow as ChatWindowState } from "@/stores/windowStore";

const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("./WindowControls", () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));

interface MockWindowStore {
  windows: ChatWindowState[];
  activeWindowId: string | null;
  addWindow: (agentIdOrInput: string | { agentId: string; title: string; sessionId?: string; sessionConfig?: ChatWindowState["sessionConfig"] }, title?: string) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindowState>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  addMessage: (windowId: string, message: ChatMessage) => void;
  updateLayout: (id: string, position: ChatWindowState["position"]) => void;
  setWsConnected: (windowId: string, connected: boolean) => void;
}

const updateWindowSpy = vi.fn();

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

class MockWebSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    queueMicrotask(() => {
      this.onopen?.();
    });
  }

  send() {}
  close() {}
}

vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
vi.stubGlobal("confirm", vi.fn(() => true));
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
  updateWindowSpy.mockReset();
  mockState = createMockState();
});

describe("ChatWindow", () => {
  it("renders NarraFork-like session controls and updates current session config", () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(screen.getByText("当前会话控制")).toBeTruthy();
    expect(screen.getByLabelText("模型选择器")).toBeTruthy();
    expect(screen.getByLabelText("权限模式选择器")).toBeTruthy();
    expect(screen.getByLabelText("推理强度选择器")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("权限模式选择器"), { target: { value: "ask" } });
    fireEvent.change(screen.getByLabelText("推理强度选择器"), { target: { value: "high" } });

    expect(updateWindowSpy).toHaveBeenCalledWith(
      "window-1",
      expect.objectContaining({
        sessionConfig: expect.objectContaining({ permissionMode: "ask" }),
      }),
    );
    expect(updateWindowSpy).toHaveBeenCalledWith(
      "window-1",
      expect.objectContaining({
        sessionConfig: expect.objectContaining({ reasoningEffort: "high" }),
      }),
    );
  });

  it("opens context details from the current chat session", () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(screen.queryByTestId("context-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "上下文详情" }));

    expect(screen.getByTestId("context-panel")).toBeTruthy();
    expect(screen.getByText("上下文面板")).toBeTruthy();
    expect(screen.getByText(/最近会话消息/)).toBeTruthy();
  });

  it("creates a formal narrator session when opening a follow-up session", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      id: "session-2",
      title: "Writer 会话 · 新会话",
      agentId: "writer",
      kind: "standalone",
      status: "active",
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messageCount: 0,
      sortOrder: 1,
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        permissionMode: "allow",
        reasoningEffort: "medium",
      },
    });

    render(<ChatWindow windowId="window-1" theme="light" />);

    fireEvent.click(screen.getByRole("button", { name: /新开会话/ }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({
      method: "POST",
    }));
    expect(useWindowStore.getState().windows[1]).toMatchObject({
      title: "Writer 会话 · 新会话",
      agentId: "writer",
      sessionId: "session-2",
    });
  });
});

function createMockState(overrides?: Partial<MockWindowStore>): MockWindowStore {
  return Object.assign(baseMockState(), overrides ?? {});
}

function baseMockState(): MockWindowStore {
  const state: MockWindowStore = {
    windows: [
      {
        id: "window-1",
        title: "Writer 会话",
        agentId: "writer",
        position: { x: 0, y: 0, w: 6, h: 8 },
        minimized: false,
        messages: [
          { id: "msg-1", role: "user", content: "写下一章", timestamp: Date.now() - 60_000 },
          { id: "msg-2", role: "assistant", content: "好的，我先整理剧情节奏。", timestamp: Date.now() - 30_000 },
        ],
        wsConnected: true,
      },
    ] as ChatWindowState[],
    activeWindowId: "window-1",
    addWindow(agentIdOrInput: string | { agentId: string; title: string; sessionId?: string; sessionConfig?: ChatWindowState["sessionConfig"] }, title?: string) {
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
          sessionConfig: normalized.sessionConfig,
          position: { x: 0, y: 0, w: 6, h: 8 },
          minimized: false,
          messages: [],
          wsConnected: false,
        },
      ];
      state.activeWindowId = id;
    },
    removeWindow(id: string) {
      state.windows = state.windows.filter((window) => window.id !== id);
      if (state.activeWindowId === id) state.activeWindowId = null;
    },
    updateWindow(id: string, updates: Partial<ChatWindowState>) {
      updateWindowSpy(id, updates);
      state.windows = state.windows.map((window) =>
        window.id === id ? { ...window, ...updates } : window,
      );
    },
    toggleMinimize(id: string) {
      state.windows = state.windows.map((window) =>
        window.id === id ? { ...window, minimized: !window.minimized } : window,
      );
    },
    setActiveWindow(id: string | null) {
      state.activeWindowId = id;
    },
    addMessage(windowId: string, message: ChatMessage) {
      state.windows = state.windows.map((window) =>
        window.id === windowId ? { ...window, messages: [...window.messages, message] } : window,
      );
    },
    updateLayout(id: string, position: ChatWindowState["position"]) {
      state.windows = state.windows.map((window) =>
        window.id === id ? { ...window, position } : window,
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
