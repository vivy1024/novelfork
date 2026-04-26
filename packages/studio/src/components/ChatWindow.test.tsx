import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChatWindow } from "./ChatWindow";
import { useWindowRuntimeStore } from "@/stores/windowRuntimeStore";
import { useWindowStore } from "@/stores/windowStore";
import type { StudioRun } from "@/shared/contracts";
import type { NarratorSessionChatSnapshot } from "@/shared/session-types";
import type { AddWindowInput, ChatWindow as ChatWindowState } from "@/stores/windowStore";

const fetchJsonMock = vi.fn(async (..._args: [string, ...unknown[]]) => ({ success: true }));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (url: string, ...rest: unknown[]) => fetchJsonMock(url, ...rest),
}));

const useRunDetailsMock = vi.fn<(runId?: string | null) => StudioRun | null>();

vi.mock("@/hooks/use-run-events", () => ({
  useRunDetails: (runId?: string | null) => useRunDetailsMock(runId),
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

function resetWindowRuntimeStore(initial?: {
  wsConnections?: Record<string, boolean>;
  recoveryStates?: Record<string, "idle" | "recovering" | "reconnecting" | "replaying" | "resetting" | "failed">;
  chatSnapshots?: Record<string, NarratorSessionChatSnapshot | null>;
}) {
  useWindowRuntimeStore.setState({
    wsConnections: initial?.wsConnections ?? { "window-1": true },
    recoveryStates: initial?.recoveryStates ?? {},
    chatSnapshots: initial?.chatSnapshots ?? {},
  });
}

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
  useRunDetailsMock.mockReset();
  useRunDetailsMock.mockReturnValue(null);

  updateWindowSpy.mockReset();
  MockWebSocket.instances = [];
  mockState = createMockState();
  resetWindowRuntimeStore();
});

function defaultFetchJsonImplementation(url: string, ...rest: unknown[]) {
  const [options] = rest as [{ method?: string; body?: string } | undefined];
  if (url === "/api/sessions/session-abc123456/chat/state" && options?.method === "PUT") {
    const requestBody = JSON.parse(options.body ?? "{}");
    const messages = Array.isArray(requestBody.messages) ? requestBody.messages.map((message: Record<string, unknown>, index: number) => ({
      ...message,
      seq: index + 1,
    })) : [];
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
        messageCount: messages.length,
        sortOrder: 0,
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
          permissionMode: "allow",
          reasoningEffort: "medium",
        },
      },
      messages,
      cursor: { lastSeq: messages.at(-1)?.seq ?? 0 },
    });
  }

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
              result: {
                execution: {
                  runId: "run-chat-1",
                  attempts: 1,
                  traceEnabled: true,
                  dumpEnabled: false,
                },
              },
            },
          ],
        },
      ],
      cursor: { lastSeq: 2 },
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

  it("shows run-level facts in the recent execution chain shell when the latest tool call belongs to a live run", async () => {
    useRunDetailsMock.mockReturnValue({
      id: "run-chat-1",
      bookId: "demo-book",
      chapter: 7,
      chapterNumber: 7,
      action: "tool",
      status: "running",
      stage: "Drafting",
      createdAt: "2026-04-20T10:00:00.000Z",
      updatedAt: "2026-04-20T10:01:00.000Z",
      startedAt: "2026-04-20T10:00:05.000Z",
      finishedAt: null,
      logs: [
        {
          timestamp: "2026-04-20T10:01:00.000Z",
          level: "info",
          message: "正在写第七章",
        },
      ],
    });

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByText(/Agent \/ writer/)).toBeTruthy();
    expect(screen.getByText("最近执行链")).toBeTruthy();
    expect(screen.getAllByText("run-chat-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Drafting/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demo-book/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/第 7 章/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/正在写第七章/).length).toBeGreaterThan(0);
    expect(useRunDetailsMock).toHaveBeenCalledWith("run-chat-1");
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
        url === "/api/sessions/session-abc123456/chat/state" &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        (options as { method?: string }).method === "PUT",
    );
    expect(sessionPersistCalls.length).toBeGreaterThan(0);
    const latestPersistBody = JSON.parse((sessionPersistCalls.at(-1)?.[1] as { body?: string } | undefined)?.body ?? "{}");
    expect(latestPersistBody.messages.at(-1)).toMatchObject({
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
    resetWindowRuntimeStore({ wsConnections: { "window-1": false } });

    render(<ChatWindow windowId="window-1" theme="light" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useWindowStore.getState().windows[0]).not.toHaveProperty("wsConnected");
    expect(useWindowRuntimeStore.getState().wsConnections["window-1"]).toBe(true);
  });

  it("clears runtime websocket state when the window closes", async () => {
    resetWindowRuntimeStore({ wsConnections: { "window-1": true } });

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
    const pendingSnapshot = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url] = args;
      if (url === "/api/sessions/session-abc123456/chat/state") {
        return pendingSnapshot;
      }
      return defaultFetchJsonImplementation(url);
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
    // After snapshot hydration with seq>0, the ws effect re-runs and transitions to
    // replay mode, so the authoritative store no longer sits in "recovering".
    expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).not.toBe("recovering");
  });

  it("shows retry, archive, and new-session paths when formal session recovery fails", async () => {
    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/state") {
        throw new Error("SQLite cursor unavailable");
      }
      if (url === "/api/sessions/session-abc123456" && options?.method === "PUT") {
        return {
          id: "session-abc123456",
          title: "Writer 会话（已归档）",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "archived",
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          messageCount: 0,
          sortOrder: 0,
          sessionConfig: {
            providerId: "anthropic",
            modelId: "claude-sonnet-4-6",
            permissionMode: "allow",
            reasoningEffort: "medium",
          },
        };
      }
      if (url === "/api/sessions" && options?.method === "POST") {
        return {
          id: "session-recovery-2",
          title: "Writer 会话 · 恢复新会话",
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
      return defaultFetchJsonImplementation(url, options);
    }) as any);

    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(await screen.findByText("会话恢复失败")).toBeTruthy();
    expect(screen.getByText(/SQLite cursor unavailable/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "重试恢复" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "归档会话" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "新开会话" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "归档会话" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/sessions/session-abc123456",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("accepts authoritative recovery state overrides from the runtime store", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(await screen.findByText("好的，我先整理剧情节奏。")).toBeTruthy();

    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("window-1", "resetting");
    });

    expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).toBe("resetting");
  });

  it("renders authoritative session snapshots from the runtime store", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(await screen.findByText("好的，我先整理剧情节奏。")).toBeTruthy();

    act(() => {
      useWindowRuntimeStore.getState().setChatSnapshot("window-1", {
        session: {
          id: "session-abc123456",
          title: "Writer 会话（来自 store 快照）",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          messageCount: 3,
          sortOrder: 0,
          sessionConfig: {
            providerId: "anthropic",
            modelId: "claude-sonnet-4-6",
            permissionMode: "allow",
            reasoningEffort: "medium",
          },
        },
        messages: [
          { id: "msg-store-1", role: "user", content: "旧消息", timestamp: Date.now() - 10_000, seq: 1 },
          { id: "msg-store-2", role: "assistant", content: "来自运行时快照", timestamp: Date.now(), seq: 2 },
          { id: "msg-store-3", role: "assistant", content: "第三条快照消息", timestamp: Date.now() + 1, seq: 3 },
        ],
        cursor: { lastSeq: 3 },
      });
    });

    expect(screen.getByText("Writer 会话（来自 store 快照）")).toBeTruthy();
    expect(screen.getByText("来自运行时快照")).toBeTruthy();
    expect(screen.getAllByText("3 条消息").length).toBeGreaterThan(0);
  });

  it("syncs compressed session messages through the server-first chat state endpoint", async () => {

    fetchJsonMock.mockImplementation((async (...args: [string, ...unknown[]]) => {
      const [url, options] = args as [string, { method?: string; body?: string } | undefined];
      if (url === "/api/sessions/session-abc123456/chat/state" && options?.method === "PUT") {
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
          messages: JSON.parse(options.body ?? "{}").messages,
          cursor: { lastSeq: 6 },
        };
      }
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

    const legacyPersistCall = fetchJsonMock.mock.calls.find(
      ([url, options]) =>
        url === "/api/sessions/session-abc123456" &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        (options as { method?: string }).method === "PUT",
    );
    expect(legacyPersistCall).toBeUndefined();

    const persistCall = fetchJsonMock.mock.calls.find(
      ([url, options]) =>
        url === "/api/sessions/session-abc123456/chat/state" &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        (options as { method?: string }).method === "PUT",
    );

    expect(persistCall).toBeTruthy();
    const [, options] = persistCall as [string, { body?: string }];
    expect(JSON.parse(options.body ?? "{}")).toMatchObject({
      messages: [
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
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456/chat/history?sinceSeq=2");
      expect(screen.getByText("服务端追加消息")).toBeTruthy();
      expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).toBe("idle");
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("accepts server-driven recovery state from session state envelopes", async () => {
    render(<ChatWindow windowId="window-1" theme="light" />);

    expect(await screen.findByText("好的，我先整理剧情节奏。")).toBeTruthy();

    await act(async () => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "session:state",
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
          cursor: { lastSeq: 2, ackedSeq: 2 },
          recovery: { state: "resetting", reason: "server-reset" },
        }),
      });
      await Promise.resolve();
    });

    expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).toBe("resetting");
    expect(screen.getByText("历史已重置，正在重新同步会话…")).toBeTruthy();
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

      expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions/session-abc123456/chat/history?sinceSeq=1");
      expect(fetchJsonMock.mock.calls.filter(([url]) => url === "/api/sessions/session-abc123456/chat/state").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("需要整包重放")).toBeTruthy();
      expect(useWindowRuntimeStore.getState().recoveryStates["window-1"]).toBe("idle");
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

