import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChatWindow } from "./ChatWindow";
import { useWindowRuntimeStore } from "@/stores/windowRuntimeStore";
import { useWindowStore } from "@/stores/windowStore";
import type { AddWindowInput, ChatWindow as ChatWindowState } from "@/stores/windowStore";

const fetchJsonMock = vi.fn(async (..._args: [string, ...unknown[]]) => ({ success: true }));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (url: string, ...rest: unknown[]) => fetchJsonMock(url, ...rest),
}));

vi.mock("./WindowControls", () => ({
  WindowControls: ({ onClose }: { onClose?: () => void }) => (
    <button type="button" data-testid="window-controls" onClick={onClose}>
      关闭窗口
    </button>
  ),
}));

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

interface MockWindowRuntimeStore {
  wsConnections: Record<string, boolean>;
  recoveryStates: Record<string, "idle" | "recovering" | "reconnecting" | "replaying" | "resetting">;
  setWsConnected: (windowId: string, connected: boolean) => void;
  setRecoveryState: (windowId: string, recoveryState: "idle" | "recovering" | "reconnecting" | "replaying" | "resetting") => void;
  clearWindowRuntime: (windowId: string) => void;
}

const updateWindowSpy = vi.fn();

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
  fetchJsonMock.mockImplementation(defaultFetchJsonImplementation as any);

  updateWindowSpy.mockReset();
  MockWebSocket.instances = [];
  mockState = createMockState();
  mockRuntimeState = createMockRuntimeState();
});

function defaultFetchJsonImplementation(url: string, ...rest: unknown[]) {
  const [options] = rest as [{ method?: string } | undefined];
  if (url === "/api/sessions/session-abc123456/chat/state") {
    return Promise.resolve({
      session: {
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
      },
      messages: [
        { id: "msg-1", role: "user", content: "写下一章", timestamp: Date.now() - 60_000, seq: 1 },
        {
          id: "msg-2",
          role: "assistant",
          content: "好的，我先整理剧情节奏。",
          timestamp: Date.now() - 30_000,
          seq: 2,
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
      cursor: { lastSeq: 2 },
    });
  }

  if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
    return Promise.resolve({
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
    });
  }

  if (url.startsWith("/api/sessions/session-abc123456/chat/history")) {
    return Promise.resolve({
      sessionId: "session-abc123456",
      sinceSeq: 0,
      availableFromSeq: 1,
      resetRequired: false,
      messages: [],
      cursor: { lastSeq: 2 },
    });
  }

  return Promise.resolve({ success: true });
}

fetchJsonMock.mockImplementation(defaultFetchJsonImplementation as any);

describe("ChatWindow", () => {
  it("renders NarraFork-like session controls and updates current session config", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText("当前会话控制")).toBeTruthy();
    expect(screen.getByLabelText("模型选择器")).toBeTruthy();
    expect(screen.getByLabelText("权限模式选择器")).toBeTruthy();
    expect(screen.getByLabelText("推理强度选择器")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("权限模式选择器"), { target: { value: "ask" } });
    fireEvent.change(screen.getByLabelText("推理强度选择器"), { target: { value: "high" } });

    const sessionConfigCalls = fetchJsonMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/sessions/session-abc123456" &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        (options as { method?: string }).method === "PUT",
    );

    expect(sessionConfigCalls.length).toBeGreaterThan(0);
    const latestCall = sessionConfigCalls.at(-1) as [string, { body?: string }];
    expect(JSON.parse(latestCall[1].body ?? "{}")).toMatchObject({
      sessionConfig: {
        permissionMode: "ask",
        reasoningEffort: "high",
      },
    });
  });

  it("shows session breadcrumb and recent execution chain shell", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByText(/Agent \/ writer/)).toBeTruthy();
    expect(screen.getByText("最近执行链")).toBeTruthy();
    expect(MockWebSocket.instances[0]?.url).toContain("/api/sessions/session-abc123456/chat");
    expect(MockWebSocket.instances[0]?.url).toContain("mode=chat");
  });

  it("expands the recent execution chain into concrete tool-call blocks", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId("execution-chain-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "展开最近执行链" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开最近执行链" }));

    expect(screen.getByText("链路详情")).toBeTruthy();
    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bash").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("group", { name: "工具调用动作区" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "收起最近执行链" })).toBeTruthy();
  });

  it("replays a tool call and appends the replay result into the current message flow", async () => {
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string; body?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return defaultFetchJsonImplementation(url, options);
      }
      if (url === "/api/tools/execute") {
        return {
          success: true,
          result: {
            success: true,
            data: " M packages/studio/src/components/ChatWindow.tsx\n M packages/studio/src/components/ToolCall/ToolCallBlock.tsx",
          },
          execution: {
            runId: "run-replay-1",
            attempts: 1,
            traceEnabled: true,
            dumpEnabled: false,
          },
        };
      }
      return defaultFetchJsonImplementation(url, options);
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "展开最近执行链" }));
    fireEvent.click(screen.getAllByRole("button", { name: "重跑" }).at(-1)!);

    expect(await screen.findByText("已重跑 Bash")).toBeTruthy();
    expect(screen.getAllByText("Bash").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/重跑完成：Bash/).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/run-replay-1/).length).toBeGreaterThan(1);
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/tools/execute",
      expect.objectContaining({ method: "POST" }),
    );
    const sessionPersistCalls = fetchJsonMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/sessions/session-abc123456" &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        (options as { method?: string }).method === "PUT",
    );
    expect(sessionPersistCalls.length).toBeGreaterThan(0);
    const latestPersistBody = JSON.parse((sessionPersistCalls.at(-1)?.[1] as { body?: string } | undefined)?.body ?? "{}");
    expect(latestPersistBody.recentMessages.at(-1)).toMatchObject({
      content: "已重跑 Bash",
      toolCalls: [
        expect.objectContaining({
          toolName: "Bash",
          summary: "重跑完成：Bash",
        }),
      ],
    });
  });

  it("preserves governance metadata when a replayed tool call requires confirmation", async () => {
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string; body?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return defaultFetchJsonImplementation(url, options);
      }
      if (url === "/api/tools/execute") {
        return {
          success: false,
          allowed: false,
          confirmationRequired: true,
          source: "runtimeControls.defaultPermissionMode",
          reasonKey: "default-prompt",
          reason: "Tool falls back to defaultPermissionMode=ask",
          error: "Tool falls back to defaultPermissionMode=ask",
        };
      }
      return defaultFetchJsonImplementation(url, options);
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "展开最近执行链" }));
    fireEvent.click(screen.getAllByRole("button", { name: "重跑" }).at(-1)!);

    expect((await screen.findAllByText(/默认权限要求确认/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/来源：runtimeControls.defaultPermissionMode/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/执行：需确认/).length).toBeGreaterThan(0);
  });

  it("tracks websocket connectivity outside the persisted window shell", async () => {
    mockRuntimeState = createMockRuntimeState({ wsConnections: { "window-1": false } });

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useWindowStore.getState().windows[0]).not.toHaveProperty("wsConnected");
    expect(useWindowRuntimeStore.getState().wsConnections["window-1"]).toBe(true);
  });

  it("clears runtime websocket state when the window closes", async () => {
    mockRuntimeState = createMockRuntimeState({ wsConnections: { "window-1": true } });

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.click(screen.getByRole("button", { name: "关闭窗口" }));

    expect(useWindowRuntimeStore.getState().wsConnections).not.toHaveProperty("window-1");
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
      }),
    );
  });

  it("shows a recovery banner while hydrating the formal session snapshot", async () => {
    let resolveSnapshot!: (value: unknown) => void;
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url] = args as [string];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return new Promise((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(screen.getByText("正在恢复正式会话快照…")).toBeTruthy();
    expect(screen.getByText(/当前窗口正在从服务端加载正式快照/)).toBeTruthy();
    expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).toBe("recovering");

    resolveSnapshot({
      session: {
        id: "session-abc123456",
        title: "Writer 会话（正式）",
        agentId: "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        messageCount: 1,
        sortOrder: 0,
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
          permissionMode: "allow",
          reasoningEffort: "medium",
        },
      },
      messages: [
        {
          id: "server-msg-1",
          role: "assistant",
          content: "服务端正式消息",
          timestamp: Date.now(),
          seq: 1,
        },
      ],
      cursor: { lastSeq: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText("服务端正式消息")).toBeTruthy();
    expect(screen.queryByText("正在恢复正式会话快照…")).toBeNull();
    expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).toBe("idle");
  });

  it("persists compressed session messages back to the formal session state", async () => {
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return {
          session: {
            id: "session-abc123456",
            title: "Writer 会话（正式）",
            agentId: "writer",
            kind: "standalone",
            sessionMode: "chat",
            status: "active",
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            messageCount: 5,
            sortOrder: 0,
            sessionConfig: {
              providerId: "anthropic",
              modelId: "claude-sonnet-4-6",
              permissionMode: "allow",
              reasoningEffort: "medium",
            },
          },
          messages: [
            { id: "msg-1", role: "user", content: "第一条消息", timestamp: Date.now() - 300_000, seq: 1 },
            { id: "msg-2", role: "assistant", content: "第二条消息", timestamp: Date.now() - 240_000, seq: 2 },
            { id: "msg-3", role: "user", content: "第三条消息", timestamp: Date.now() - 180_000, seq: 3 },
            { id: "msg-4", role: "assistant", content: "第四条消息", timestamp: Date.now() - 120_000, seq: 4 },
            { id: "msg-5", role: "user", content: "第五条消息", timestamp: Date.now() - 60_000, seq: 5 },
          ],
          cursor: { lastSeq: 5 },
        };
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return defaultFetchJsonImplementation(url, options);
      }
      return { success: true };
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    fetchJsonMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "压缩" }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistCall = fetchJsonMock.mock.calls.find(
      ([url, options]) =>
        url === "/api/sessions/session-abc123456" &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        (options as { method?: string }).method === "PUT",
    );

    expect(persistCall).toBeTruthy();
    const [, options] = persistCall as [string, { body?: string }];
    expect(JSON.parse(options.body ?? "{}")).toMatchObject({
      messageCount: 5,
      recentMessages: [
        expect.objectContaining({
          role: "system",
          content: "已压缩较早消息，共保留最近 4 条对话。",
        }),
        expect.objectContaining({ id: "msg-2", content: "第二条消息" }),
        expect.objectContaining({ id: "msg-3", content: "第三条消息" }),
        expect.objectContaining({ id: "msg-4", content: "第四条消息" }),
        expect.objectContaining({ id: "msg-5", content: "第五条消息" }),
      ],
    });
  });

  it("opens context details from the current chat session", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByTestId("context-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "上下文详情" }));

    expect(screen.getByTestId("context-panel")).toBeTruthy();
    expect(screen.getByText("上下文面板")).toBeTruthy();
    expect(screen.getByText(/最近会话消息/)).toBeTruthy();
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
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456/chat/state");
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

  it("renders governance metadata from raw assistant tool_calls pushed over websocket", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    await act(async () => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          message: "本次读取被权限链拦下。",
          tool_calls: [
            {
              id: "tool-read-blocked",
              tool_name: "Read",
              status: "error",
              arguments: { file_path: "books/demo/outline.md" },
              source: "runtimeControls.defaultPermissionMode",
              reasonKey: "default-prompt",
              reason: "Tool falls back to defaultPermissionMode=ask",
              confirmationRequired: true,
              allowed: false,
              error: "Tool falls back to defaultPermissionMode=ask",
            },
          ],
        }),
      });
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "展开最近执行链" }));

    expect(screen.getByText("本次读取被权限链拦下。")).toBeTruthy();
    expect(screen.getAllByText(/默认权限要求确认/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/来源：runtimeControls.defaultPermissionMode/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/执行：需确认/).length).toBeGreaterThan(0);
  });

  it("reconnects websocket with resumeFromSeq after receiving sequenced session messages", async () => {
    let scheduledReconnect: (() => void) | undefined;
    const setTimeoutSpy = vi.spyOn(globalThis.window, "setTimeout").mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === "function") {
        scheduledReconnect = () => {
          handler();
        };
      } else {
        scheduledReconnect = undefined;
      }
      return 1 as unknown as number;
    }) as typeof globalThis.window.setTimeout);

    try {
      render(<ChatWindow windowId="window-1" theme="light" />);
      await Promise.resolve();
      await Promise.resolve();

      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "session:message",
          sessionId: "session-abc123456",
          message: {
            id: "server-msg-2",
            role: "assistant",
            content: "服务端追加消息",
            timestamp: Date.now(),
            seq: 2,
          },
          cursor: { lastSeq: 2 },
        }),
      });
      await Promise.resolve();
      await Promise.resolve();

      await act(async () => {
        MockWebSocket.instances[0]?.onclose?.();
        await Promise.resolve();
      });
      await act(async () => {
        scheduledReconnect?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1]?.url).toContain("resumeFromSeq=2");
      expect(screen.getByText("正在回放会话历史…")).toBeTruthy();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("falls back to full session state when reconnect history requests a reset", async () => {
    let scheduledReconnect: (() => void) | undefined;
    const setTimeoutSpy = vi.spyOn(globalThis.window, "setTimeout").mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === "function") {
        scheduledReconnect = () => {
          handler();
        };
      } else {
        scheduledReconnect = undefined;
      }
      return 1 as unknown as number;
    }) as typeof globalThis.window.setTimeout);
    let stateCalls = 0;

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url] = args as [string];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        stateCalls += 1;
        return {
          session: {
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
          },
          messages: stateCalls >= 2
            ? [
                { id: "server-msg-1", role: "assistant", content: "初始消息", timestamp: Date.now() - 1_000, seq: 1 },
                { id: "server-msg-2", role: "assistant", content: "需要整包重放", timestamp: Date.now(), seq: 2 },
              ]
            : [
                { id: "server-msg-1", role: "assistant", content: "初始消息", timestamp: Date.now() - 1_000, seq: 1 },
              ],
          cursor: { lastSeq: stateCalls >= 2 ? 2 : 1 },
        };
      }

      if (url === "/api/sessions/session-abc123456/chat/history?sinceSeq=2") {
        return {
          sessionId: "session-abc123456",
          sinceSeq: 2,
          availableFromSeq: 5,
          resetRequired: true,
          messages: [],
          cursor: { lastSeq: 2 },
        };
      }

      return defaultFetchJsonImplementation(url);
    }) as any);

    try {
      render(<ChatWindow windowId="window-1" theme="light" />);
      await Promise.resolve();
      await Promise.resolve();

      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "session:message",
          sessionId: "session-abc123456",
          message: {
            id: "server-msg-2",
            role: "assistant",
            content: "需要整包重放",
            timestamp: Date.now(),
            seq: 2,
          },
          cursor: { lastSeq: 2 },
        }),
      });
      await Promise.resolve();
      await Promise.resolve();

      await act(async () => {
        MockWebSocket.instances[0]?.onclose?.();
        await Promise.resolve();
      });
      await act(async () => {
        scheduledReconnect?.();
        await Promise.resolve();
        await Promise.resolve();
      });
      await Promise.resolve();

      expect(screen.getByText("历史已重置，正在重新同步会话…")).toBeTruthy();
      expect(screen.getByText(/服务端要求当前窗口放弃本地补拉结果/)).toBeTruthy();
      expect(screen.getByText(/重新同步正式快照/)).toBeTruthy();
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456/chat/history?sinceSeq=2");

      expect(fetchJsonMock.mock.calls.filter(([url]) => url === "/api/sessions/session-abc123456/chat/state").length).toBeGreaterThanOrEqual(2);
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      setTimeoutSpy.mockRestore();
    }
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
      },
    ] as ChatWindowState[],
    activeWindowId: "window-1",
    addWindow(input: AddWindowInput) {
      const id = `window-${state.windows.length + 1}`;
      state.windows.push({
        id,
        title: input.title,
        agentId: input.agentId,
        sessionId: input.sessionId,
        sessionMode: input.sessionMode,
        position: { x: 0, y: 0, w: 6, h: 8 },
        minimized: false,
      });
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
    updateLayout(id: string, position: ChatWindowState["position"]) {
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
    wsConnections: {
      "window-1": true,
    },
    recoveryStates: {},
    setWsConnected(windowId: string, connected: boolean) {
      state.wsConnections = {
        ...state.wsConnections,
        [windowId]: connected,
      };
    },
    setRecoveryState(windowId: string, recoveryState: "idle" | "recovering" | "reconnecting" | "replaying" | "resetting") {
      state.recoveryStates = {
        ...state.recoveryStates,
        [windowId]: recoveryState,
      };
    },
    clearWindowRuntime(windowId: string) {
      const nextConnections = { ...state.wsConnections };
      const nextRecoveryStates = { ...state.recoveryStates };
      delete nextConnections[windowId];
      delete nextRecoveryStates[windowId];
      state.wsConnections = nextConnections;
      state.recoveryStates = nextRecoveryStates;
    },
  };

  return state;
}
