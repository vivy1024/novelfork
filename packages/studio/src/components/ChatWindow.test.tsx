import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChatWindow } from "./ChatWindow";
import { useWindowStore } from "@/stores/windowStore";
import type { ChatMessage, ChatWindow as ChatWindowState } from "@/stores/windowStore";
import type {
  NarratorSessionChatMessage,
  NarratorSessionChatSnapshot,
  NarratorSessionRecord,
} from "../shared/session-types";

type NarratorSessionChatHistoryResponse = {
  session?: NarratorSessionRecord;
  sessionId?: string;
  messages?: NarratorSessionChatMessage[];
};

const fetchJsonMock = vi.fn(async (..._args: [string, ...unknown[]]) => ({ success: true }));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (url: string, ...rest: unknown[]) => fetchJsonMock(url, ...rest),
}));

vi.mock("@/shared/provider-catalog", () => ({
  PROVIDERS: [
    {
      id: "anthropic",
      name: "Anthropic",
      models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
    },
    {
      id: "openai",
      name: "OpenAI",
      models: [{ id: "gpt-5.4", name: "GPT-5.4" }],
    },
  ],
  getDefaultProvider: () => ({ id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }] }),
  getDefaultModel: (providerId: string) => ({
    id: providerId === "openai" ? "gpt-5.4" : "claude-sonnet-4-6",
    name: providerId === "openai" ? "GPT-5.4" : "Claude Sonnet 4.6",
  }),
  getProvider: (providerId: string) =>
    providerId === "openai"
      ? { id: "openai", name: "OpenAI", models: [{ id: "gpt-5.4", name: "GPT-5.4" }] }
      : { id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }] },
  getModel: (providerId: string, modelId: string) => ({
    id: modelId,
    name: providerId === "openai" ? "GPT-5.4" : "Claude Sonnet 4.6",
  }),
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
  vi.useRealTimers();
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
    const formalSession = createFormalSessionRecord({
      title: "Writer 会话（正式）",
      sessionMode: "plan",
      messageCount: 2,
      sessionConfig: {
        providerId: "openai",
        modelId: "gpt-5.4",
        permissionMode: "ask",
        reasoningEffort: "high",
      },
    });

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/history") {
        return {
          sessionId: "session-abc123456",
          session: formalSession,
          messages: [],
        };
      }
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return {
          session: formalSession,
          messages: [],
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return formalSession;
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456/chat/state"));

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

  it("keeps the newest hydrate result when an older connection resolves late", async () => {
    const staleHistory = createDeferred<NarratorSessionChatHistoryResponse>();
    const staleState = createDeferred<Partial<NarratorSessionChatSnapshot>>();
    const staleSession = createFormalSessionRecord({
      title: "Writer 会话（旧响应）",
      messageCount: 3,
    });
    const freshSession = createFormalSessionRecord({
      title: "Writer 会话（新连接）",
      messageCount: 4,
    });

    let historyCalls = 0;
    let stateCalls = 0;

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/history") {
        historyCalls += 1;
        if (historyCalls === 1) {
          return staleHistory.promise;
        }
        return {
          sessionId: "session-abc123456",
          session: freshSession,
          messages: [
            { id: "msg-fresh-history", role: "user", content: "新连接历史消息", timestamp: 10 },
          ],
        };
      }
      if (url === "/api/sessions/session-abc123456/chat/state") {
        stateCalls += 1;
        if (stateCalls === 1) {
          return staleState.promise;
        }
        return {
          session: freshSession,
          messages: [
            { id: "msg-fresh-state", role: "assistant", content: "新连接状态消息", timestamp: 20 },
          ],
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return freshSession;
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    MockWebSocket.instances[0]?.onopen?.();
    await Promise.resolve();
    await Promise.resolve();

    MockWebSocket.instances[0]?.onopen?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useWindowStore.getState().windows[0]?.title).toBe("Writer 会话（新连接）");
    expect(useWindowStore.getState().windows[0]?.messages.some((message) => message.id === "msg-fresh-state")).toBe(true);

    staleHistory.resolve({
      sessionId: "session-abc123456",
      session: staleSession,
      messages: [
        { id: "msg-stale-history", role: "user", content: "旧响应历史消息", timestamp: 1 },
      ],
    });
    staleState.resolve({
      session: staleSession,
      messages: [
        { id: "msg-stale-state", role: "assistant", content: "旧响应状态消息", timestamp: 2 },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();

    const messages = useWindowStore.getState().windows[0]?.messages ?? [];
    expect(useWindowStore.getState().windows[0]?.title).toBe("Writer 会话（新连接）");
    expect(messages.some((message) => message.id === "msg-stale-history")).toBe(false);
    expect(messages.some((message) => message.id === "msg-stale-state")).toBe(false);
    expect(messages.some((message) => message.id === "msg-fresh-history")).toBe(true);
    expect(messages.some((message) => message.id === "msg-fresh-state")).toBe(true);
  });

  it("reloads chat history and state after websocket reconnect", async () => {
    vi.useFakeTimers();
    const formalSession = createFormalSessionRecord();
    const historyUrl = "/api/sessions/session-abc123456/chat/history";
    const stateUrl = "/api/sessions/session-abc123456/chat/state";

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === historyUrl) {
        return {
          sessionId: "session-abc123456",
          session: formalSession,
          messages: [],
        };
      }
      if (url === stateUrl) {
        return {
          session: formalSession,
          messages: [],
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return formalSession;
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    MockWebSocket.instances[0]?.onopen?.();
    await Promise.resolve();
    await Promise.resolve();

    const historyCallsBeforeReconnect = countFetchCalls(historyUrl);
    const stateCallsBeforeReconnect = countFetchCalls(stateUrl);
    expect(historyCallsBeforeReconnect).toBeGreaterThanOrEqual(1);
    expect(stateCallsBeforeReconnect).toBeGreaterThanOrEqual(1);

    MockWebSocket.instances[0]?.onclose?.();
    await vi.advanceTimersByTimeAsync(5000);
    MockWebSocket.instances.at(-1)?.onopen?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(countFetchCalls(historyUrl)).toBeGreaterThan(historyCallsBeforeReconnect);
    expect(countFetchCalls(stateUrl)).toBeGreaterThan(stateCallsBeforeReconnect);
  });

  it("uses the successful side when history or state fails", async () => {
    const formalSession = createFormalSessionRecord({
      title: "Writer 会话（仅状态）",
      sessionConfig: {
        providerId: "openai",
        modelId: "gpt-5.4",
        permissionMode: "ask",
        reasoningEffort: "high",
      },
    });

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/history") {
        throw new Error("history failed");
      }
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return {
          session: formalSession,
          messages: [
            { id: "msg-state-only", role: "assistant", content: "仅状态消息", timestamp: 40 },
          ],
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return formalSession;
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    MockWebSocket.instances[0]?.onopen?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(useWindowStore.getState().windows[0]?.title).toBe("Writer 会话（仅状态）");
    await waitFor(() => {
      expect(useWindowStore.getState().windows[0]?.messages.some((message) => message.id === "msg-state-only")).toBe(true);
    });
  });

  it("merges formal session history and state without losing local richer messages", async () => {
    mockState = createMockState({
      windows: [
        {
          ...createMockState().windows[0],
          messages: [
            {
              id: "msg-local-rich",
              role: "assistant",
              content: "本地富消息",
              timestamp: 20,
              toolCalls: [
                {
                  id: "tool-read-local",
                  toolName: "Read",
                  status: "success",
                  input: { file_path: "books/demo/chapter-1.md" },
                  output: "本地工具输出",
                  duration: 12,
                },
              ],
            },
            { id: "msg-local-only", role: "user", content: "本地待合并消息", timestamp: 30 },
          ],
        },
      ],
    });

    const formalSession = createFormalSessionRecord({ title: "Writer 会话（正式）", messageCount: 4 });
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/history") {
        return {
          sessionId: "session-abc123456",
          session: formalSession,
          messages: [
            { id: "msg-history-1", role: "user", content: "更早的历史消息", timestamp: 10 },
            { id: "msg-local-rich", role: "assistant", content: "服务端普通版消息", timestamp: 20 },
          ],
        };
      }
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return {
          session: formalSession,
          messages: [
            { id: "msg-local-rich", role: "assistant", content: "服务端普通版消息", timestamp: 20 },
            { id: "msg-state-1", role: "assistant", content: "最新状态消息", timestamp: 40 },
          ],
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return formalSession;
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    await waitFor(() => {
      expect(useWindowStore.getState().windows[0]?.messages.map((message) => message.id)).toEqual([
        "msg-history-1",
        "msg-local-rich",
        "msg-local-only",
        "msg-state-1",
      ]);
    });

    const mergedMessages = useWindowStore.getState().windows[0]?.messages ?? [];
    expect(mergedMessages.find((message) => message.id === "msg-local-rich")?.toolCalls).toMatchObject([
      expect.objectContaining({ toolName: "Read" }),
    ]);
    expect(mergedMessages.find((message) => message.id === "msg-local-rich")?.content).toBe("服务端普通版消息");
  });

  it("opens context details from the current chat session with layered sources", () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(screen.queryByTestId("context-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "上下文详情" }));

    expect(screen.getByTestId("context-panel")).toBeTruthy();
    expect(screen.getByText("上下文面板")).toBeTruthy();
    expect(screen.getByText(/最近会话消息/)).toBeTruthy();
    expect(screen.getByText(/已用/)).toBeTruthy();
    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);
    expect(screen.getByText("Read · 完成")).toBeTruthy();
    expect(screen.getAllByText("会话层").length).toBeGreaterThan(0);
    expect(screen.getAllByText("工具层").length).toBeGreaterThan(0);
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

function countFetchCalls(url: string) {
  return fetchJsonMock.mock.calls.filter(([calledUrl]) => calledUrl === url).length;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createFormalSessionRecord(overrides?: Partial<NarratorSessionRecord>): NarratorSessionRecord {
  return {
    id: "session-abc123456",
    title: "Writer 会话（正式）",
    agentId: "writer",
    kind: "standalone",
    sessionMode: "chat",
    status: "active",
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    messageCount: 2,
    sortOrder: 0,
    sessionConfig: {
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      permissionMode: "allow",
      reasoningEffort: "medium",
    },
    ...overrides,
  };
}

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
