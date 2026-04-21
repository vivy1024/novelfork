import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChatWindow } from "./ChatWindow";
import { useWindowStore } from "@/stores/windowStore";
import type { ChatMessage, ChatWindow as ChatWindowState } from "@/stores/windowStore";

const fetchJsonMock = vi.fn(async (..._args: [string, ...unknown[]]) => ({ success: true }));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (url: string, ...rest: unknown[]) => fetchJsonMock(url, ...rest),
}));

vi.mock("./WindowControls", () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));

interface MockWindowStore {
  windows: ChatWindowState[];
  activeWindowId: string | null;
  addWindow: (agentIdOrInput: string | { agentId: string; title: string; sessionId?: string; sessionMode?: "chat" | "plan"; sessionConfig?: ChatWindowState["sessionConfig"] }, title?: string) => void;
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
  static instances: MockWebSocket[] = [];
  readyState = 1;
  url: string;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.();
    });
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

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
  fetchJsonMock.mockImplementation(async () => ({ success: true }));
  updateWindowSpy.mockReset();
  MockWebSocket.instances = [];
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
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456", expect.objectContaining({
      method: "PUT",
    }));
  });

  it("shows session breadcrumb and recent execution chain", () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByText(/Agent \/ writer/)).toBeTruthy();
    expect(screen.getByText("最近执行链")).toBeTruthy();
    expect(screen.getByText("Read → Bash")).toBeTruthy();
    expect(screen.getByText(/2 步完成/)).toBeTruthy();
    expect(MockWebSocket.instances[0]?.url).toContain("/api/sessions/session-abc123456/chat");
    expect(MockWebSocket.instances[0]?.url).toContain("mode=chat");
  });

  it("hydrates chat window metadata from the formal session record", async () => {
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return {
          session: {
            id: "session-abc123456",
            title: "Writer 会话（正式）",
            agentId: "writer",
            kind: "standalone",
            sessionMode: "plan",
            status: "active",
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            messageCount: 2,
            sortOrder: 0,
            sessionConfig: {
              providerId: "openai",
              modelId: "gpt-5.4",
              permissionMode: "ask",
              reasoningEffort: "high",
            },
          },
          messages: [],
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return {
          id: "session-abc123456",
          title: "Writer 会话（正式）",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "plan",
          status: "active",
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          messageCount: 2,
          sortOrder: 0,
          sessionConfig: {
            providerId: "openai",
            modelId: "gpt-5.4",
            permissionMode: "ask",
            reasoningEffort: "high",
          },
        };
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456/chat/state");
    expect(updateWindowSpy).toHaveBeenCalledWith(
      "window-1",
      expect.objectContaining({
        title: "Writer 会话（正式）",
        sessionMode: "plan",
        sessionConfig: expect.objectContaining({
          providerId: "openai",
          modelId: "gpt-5.4",
          permissionMode: "ask",
          reasoningEffort: "high",
        }),
      }),
    );
  });

  it("opens context details from the current chat session with layered sources", () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(screen.queryByTestId("context-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "上下文详情" }));

    expect(screen.getByTestId("context-panel")).toBeTruthy();
    expect(screen.getByText("上下文面板")).toBeTruthy();
    expect(screen.getByText(/最近会话消息/)).toBeTruthy();
    expect(screen.getByText("来源分层")).toBeTruthy();
    expect(screen.getAllByText("工具结果").length).toBeGreaterThan(0);
    expect(screen.getByText("Read · 完成")).toBeTruthy();
  });

  it("sends session id and mode with outgoing chat messages", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    fireEvent.change(screen.getByPlaceholderText("输入消息..."), {
      target: { value: "继续规划这一章" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const payload = JSON.parse(MockWebSocket.instances[0]?.sentMessages[0] ?? "{}");
    expect(payload).toMatchObject({
      content: "继续规划这一章",
      sessionId: "session-abc123456",
      sessionMode: "chat",
    });
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ messageCount: 3 }),
    }));
  });

  it("creates a formal narrator session when opening a follow-up session", async () => {
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions" && options?.method === "POST") {
        return {
          id: "session-2",
          title: "Writer 会话 · 新会话",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
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
        };
      }
      return { success: true };
    }) as any);

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
        sessionId: "session-abc123456",
        sessionMode: "chat",
        position: { x: 0, y: 0, w: 6, h: 8 },
        minimized: false,
        messages: [
          { id: "msg-1", role: "user", content: "写下一章", timestamp: Date.now() - 60_000 },
          {
            id: "msg-2",
            role: "assistant",
            content: "好的，我先整理剧情节奏。",
            timestamp: Date.now() - 30_000,
            toolCalls: [
              {
                id: "tool-read",
                toolName: "Read",
                status: "success",
                input: { file_path: "books/demo/outline.md" },
                output: "# 大纲\n- 第一幕：主角入局",
                duration: 38,
              },
              {
                id: "tool-bash",
                toolName: "Bash",
                status: "success",
                command: "git status --short",
                output: " M packages/studio/src/components/ChatWindow.tsx",
                duration: 420,
              },
            ],
          },
        ],
        wsConnected: true,
      },
    ] as ChatWindowState[],
    activeWindowId: "window-1",
    addWindow(agentIdOrInput: string | { agentId: string; title: string; sessionId?: string; sessionMode?: "chat" | "plan"; sessionConfig?: ChatWindowState["sessionConfig"] }, title?: string) {
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
