import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useShellDataMock = vi.hoisted(() => vi.fn());
const useShellDataStoreMock = vi.hoisted(() => vi.fn());
const useAgentConversationRuntimeMock = vi.hoisted(() => vi.fn());
const loadWorkbenchResourcesFromContractMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const abortMock = vi.hoisted(() => vi.fn());
const ackMock = vi.hoisted(() => vi.fn());
const SearchPageMock = vi.hoisted(() => vi.fn());
const RoutinesNextPageMock = vi.hoisted(() => vi.fn());
const SettingsSectionContentMock = vi.hoisted(() => vi.fn());
const ProviderSettingsPageMock = vi.hoisted(() => vi.fn());

vi.mock("./shell", async () => {
  const actual = await vi.importActual<typeof import("./shell")>("./shell");
  return {
    ...actual,
    useShellData: useShellDataMock,
    useShellDataStore: useShellDataStoreMock,
  };
});

vi.mock("./agent-conversation", async () => {
  const actual = await vi.importActual<typeof import("./agent-conversation")>("./agent-conversation");
  return {
    ...actual,
    useAgentConversationRuntime: useAgentConversationRuntimeMock,
  };
});

vi.mock("./writing-workbench", async () => {
  const actual = await vi.importActual<typeof import("./writing-workbench")>("./writing-workbench");
  return {
    ...actual,
    loadWorkbenchResourcesFromContract: loadWorkbenchResourcesFromContractMock,
  };
});

vi.mock("../hooks/use-ai-model-gate", () => ({
  useAiModelGate: () => ({ blockedResult: null, closeGate: vi.fn(), ensureModelFor: vi.fn(() => true) }),
}));

vi.mock("../components/InkEditor", () => ({
  getMarkdown: () => "",
  InkEditor: vi.fn(() => null),
}));

vi.mock("../hooks/use-api", () => ({
  fetchJson: fetchMock,
}));

vi.mock("./search/SearchPage", () => ({
  SearchPage: SearchPageMock,
}));

vi.mock("./routines/RoutinesNextPage", () => ({
  RoutinesNextPage: RoutinesNextPageMock,
}));

vi.mock("./settings/SettingsSectionContent", () => ({
  SettingsSectionContent: SettingsSectionContentMock,
}));

vi.mock("./settings/ProviderSettingsPage", () => ({
  ProviderSettingsPage: ProviderSettingsPageMock,
}));

import { StudioNextApp } from "./StudioNextApp";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (url === "/api/providers/models") return { models: [] };
    if (url.startsWith("/api/sessions/") && options?.method === "PUT") {
      return {
        id: "session-1",
        title: "第三章续写",
        agentId: "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: "2026-05-05T00:00:00.000Z",
        lastModified: "2026-05-05T00:00:00.000Z",
        messageCount: 1,
        sortOrder: 0,
        sessionConfig: JSON.parse(options.body ?? "{}")?.sessionConfig ?? {},
      };
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });
  useShellDataMock.mockReturnValue({
    books: [{ id: "b1", title: "测试书" }],
    sessions: [],
    providerSummary: null,
    providerStatus: null,
    loading: false,
    error: null,
  });
  useShellDataStoreMock.mockReturnValue({
    upsertSession: vi.fn(),
    invalidate: vi.fn(),
  });
  useAgentConversationRuntimeMock.mockReturnValue({
    state: {
      session: null,
      messages: [],
      cursor: null,
      lastSeq: 0,
      streamingMessageId: null,
      error: null,
      recovery: { state: "idle" },
      resetRequired: false,
    },
    sendMessage: sendMessageMock,
    abort: abortMock,
    ack: ackMock,
    getResumeFromSeq: () => 0,
  });
  loadWorkbenchResourcesFromContractMock.mockResolvedValue({ tree: [], resourceMap: new Map(), openableNodes: [], errors: [] });
  SearchPageMock.mockImplementation(() => <section data-testid="search-page">全局搜索 live page</section>);
  RoutinesNextPageMock.mockImplementation(() => <section data-testid="routines-page">套路 live page</section>);
  SettingsSectionContentMock.mockImplementation(({ sectionId, onSectionChange }: { sectionId: string; onSectionChange?: (sectionId: string) => void }) => (
    <section data-testid="settings-section-content">
      设置分区：{sectionId}
      <button type="button" onClick={() => onSectionChange?.("providers")}>打开 AI 供应商</button>
    </section>
  ));
  ProviderSettingsPageMock.mockImplementation(() => <section data-testid="provider-settings-page">AI 供应商 live page</section>);
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

  it("keeps the main /next route free of legacy WorkspacePage, three-column StudioApp and ChatWindow visual layer", () => {
    const mainSource = readFileSync(join(process.cwd(), "src", "main.tsx"), "utf-8");
    const studioNextSource = readFileSync(join(process.cwd(), "src", "app-next", "StudioNextApp.tsx"), "utf-8");
    const retiredVisualPaths = [
      join(process.cwd(), "src", "components", "ChatWindow.tsx"),
      join(process.cwd(), "src", "components", "ChatWindow.test.tsx"),
      join(process.cwd(), "src", "components", "ChatWindowManager.tsx"),
    ];

    expect(mainSource).toContain('import { StudioNextApp } from "./app-next"');
    expect(mainSource).not.toContain("StudioApp");
    expect(studioNextSource).not.toContain("WorkspacePage");
    expect(studioNextSource).not.toContain("SplitView");
    expect(studioNextSource).not.toContain("ChatWindow");
    expect(retiredVisualPaths.filter((path) => existsSync(path))).toEqual([]);
  });

  it("guards book routes against empty-node and noop workbench wiring", () => {
    const studioNextSource = readFileSync(join(process.cwd(), "src", "app-next", "StudioNextApp.tsx"), "utf-8");

    expect(studioNextSource).not.toContain("nodes={[]}");
    expect(studioNextSource).not.toContain("selectedNode={null}");
    expect(studioNextSource).not.toContain("onOpen={() => undefined}");
    expect(studioNextSource).not.toContain("onSave={() => undefined}");
  });

  it("mounts Agent Conversation for narrator routes", () => {
    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    expect(screen.getByTestId("conversation-route").getAttribute("data-session-id")).toBe("session-1");
    expect(screen.getByText("session-1")).toBeTruthy();
  });

  it("hydrates narrator routes through the live conversation runtime", () => {
    useAgentConversationRuntimeMock.mockReturnValue({
      state: {
        session: {
          id: "session-1",
          title: "第三章续写",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: "2026-05-05T00:00:00.000Z",
          lastModified: "2026-05-05T00:00:00.000Z",
          messageCount: 1,
          sortOrder: 0,
          sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
          cumulativeUsage: { totalInputTokens: 12, totalOutputTokens: 8, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, turnCount: 1 },
        },
        messages: [{ id: "m1", role: "assistant", content: "真实历史消息", timestamp: 1, seq: 1 }],
        cursor: { lastSeq: 1, ackedSeq: 1 },
        lastSeq: 1,
        streamingMessageId: null,
        error: null,
        recovery: { state: "idle" },
        resetRequired: false,
      },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 1,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    expect(useAgentConversationRuntimeMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
    expect(screen.getByText("第三章续写")).toBeTruthy();
    expect(screen.getByText("真实历史消息")).toBeTruthy();
    expect(screen.getByText("sub2api / gpt-5.4")).toBeTruthy();
    expect(screen.getByText("Tokens：累计 20 / 成本 未知")).toBeTruthy();
  });

  it("routes send actions through the live conversation runtime and acknowledges hydrated cursor", async () => {
    useAgentConversationRuntimeMock.mockReturnValue({
      state: {
        session: {
          id: "session-1",
          title: "第三章续写",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: "2026-05-05T00:00:00.000Z",
          lastModified: "2026-05-05T00:00:00.000Z",
          messageCount: 1,
          sortOrder: 0,
          sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
        },
        messages: [{ id: "m1", role: "assistant", content: "正在生成", timestamp: 1, seq: 1 }],
        cursor: { lastSeq: 1, ackedSeq: 1 },
        lastSeq: 1,
        streamingMessageId: null,
        error: null,
        recovery: { state: "idle" },
        resetRequired: false,
      },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 1,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    fireEvent.change(screen.getByLabelText("对话输入框"), { target: { value: "  继续写第三章  " } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(sendMessageMock).toHaveBeenCalledWith("继续写第三章");
    await waitFor(() => expect(ackMock).toHaveBeenCalledWith(1));
    expect(abortMock).not.toHaveBeenCalled();
  });

  it("routes abort actions through the live conversation runtime", () => {
    useAgentConversationRuntimeMock.mockReturnValue({
      state: {
        session: {
          id: "session-1",
          title: "第三章续写",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: "2026-05-05T00:00:00.000Z",
          lastModified: "2026-05-05T00:00:00.000Z",
          messageCount: 1,
          sortOrder: 0,
          sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
        },
        messages: [{ id: "m1", role: "assistant", content: "正在生成", timestamp: 1, seq: 1 }],
        cursor: { lastSeq: 1, ackedSeq: 1 },
        lastSeq: 1,
        streamingMessageId: "stream:session-1:1",
        error: null,
        recovery: { state: "idle" },
        resetRequired: false,
      },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 1,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    fireEvent.click(screen.getByRole("button", { name: "中断" }));

    expect(abortMock).toHaveBeenCalledOnce();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("shows runtime recovery and missing session state without fabricating messages", () => {
    useAgentConversationRuntimeMock.mockReturnValue({
      state: {
        session: null,
        messages: [],
        cursor: null,
        lastSeq: 0,
        streamingMessageId: null,
        error: { message: "会话不存在", code: "not-found" },
        recovery: { state: "failed", reason: "snapshot-load" },
        resetRequired: false,
      },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 0,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "missing-session" }} />);

    expect(screen.getByText("会话不存在")).toBeTruthy();
    expect(screen.getByTestId("conversation-recovery-notice").textContent).toContain("snapshot-load");
    expect(screen.getByText("会话缺失或快照不可用，请返回会话列表或新建会话。")) .toBeTruthy();
    expect(screen.getByRole("link", { name: "返回会话列表" }).getAttribute("href")).toBe("/next");
    expect(screen.getByRole("link", { name: "新建会话" }).getAttribute("href")).toBe("/next");
  });

  it("loads model pool into the status bar and updates session config through the session contract", async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url === "/api/providers/models") {
        return {
          models: [
            {
              modelId: "sub2api:gpt-5.4",
              modelName: "GPT-5.4",
              providerId: "sub2api",
              providerName: "Sub2API",
              enabled: true,
              contextWindow: 128000,
              maxOutputTokens: 8192,
              source: "detected",
              lastTestStatus: "success",
              capabilities: { functionCalling: true, vision: false, streaming: true },
            },
            {
              modelId: "sub2api:gpt-5.5",
              modelName: "GPT-5.5",
              providerId: "sub2api",
              providerName: "Sub2API",
              enabled: true,
              contextWindow: 200000,
              maxOutputTokens: 16384,
              source: "detected",
              lastTestStatus: "success",
              capabilities: { functionCalling: true, vision: false, streaming: true },
            },
          ],
        };
      }
      if (url === "/api/sessions/session-1" && options?.method === "PUT") {
        return { ok: true };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    useAgentConversationRuntimeMock.mockReturnValue({
      state: {
        session: {
          id: "session-1",
          title: "第三章续写",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: "2026-05-05T00:00:00.000Z",
          lastModified: "2026-05-05T00:00:00.000Z",
          messageCount: 1,
          sortOrder: 0,
          sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
        },
        messages: [],
        cursor: null,
        lastSeq: 0,
        streamingMessageId: null,
        error: null,
        recovery: { state: "idle" },
        resetRequired: false,
      },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 0,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    await screen.findByLabelText("模型");
    expect(screen.getAllByText("Sub2API / GPT-5.4").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "sub2api::gpt-5.5" } });
    fireEvent.change(screen.getByLabelText("权限"), { target: { value: "ask" } });
    fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "high" } });

    expect(fetchMock).toHaveBeenCalledWith("/api/providers/models");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ sessionConfig: { providerId: "sub2api", modelId: "gpt-5.5" } }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ sessionConfig: { permissionMode: "ask" } }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ sessionConfig: { reasoningEffort: "high" } }) }),
    );
  });

  it("blocks sending when model pool is empty and shows unsupported-tools for chat-only models", async () => {
    fetchMock.mockResolvedValueOnce({
      models: [
        {
          modelId: "sub2api:chat-only",
          modelName: "Chat Only",
          providerId: "sub2api",
          providerName: "Sub2API",
          enabled: true,
          contextWindow: 32000,
          maxOutputTokens: 4096,
          source: "detected",
          lastTestStatus: "success",
          capabilities: { functionCalling: false, vision: false, streaming: true },
        },
      ],
    });
    useAgentConversationRuntimeMock.mockReturnValue({
      state: {
        session: {
          id: "session-1",
          title: "第三章续写",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: "2026-05-05T00:00:00.000Z",
          lastModified: "2026-05-05T00:00:00.000Z",
          messageCount: 1,
          sortOrder: 0,
          sessionConfig: { providerId: "sub2api", modelId: "chat-only", permissionMode: "edit", reasoningEffort: "medium" },
        },
        messages: [],
        cursor: null,
        lastSeq: 0,
        streamingMessageId: null,
        error: null,
        recovery: { state: "idle" },
        resetRequired: false,
      },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 0,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    expect(await screen.findByTestId("unsupported-tools-notice")).toBeTruthy();
    expect(screen.getByTestId("unsupported-tools-notice").textContent).toContain("当前模型不支持工具调用");
  });

  it("maps pending session tool confirmations and confirms approve/reject through the session contract", async () => {
    const applyEnvelopeMock = vi.fn();
    const session = { id: "session-1", title: "第三章续写", agentId: "writer", kind: "standalone", sessionMode: "chat", status: "active", createdAt: "2026-05-05T00:00:00.000Z", lastModified: "2026-05-05T00:00:00.000Z", messageCount: 1, sortOrder: 0, sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" } };
    const messages = [{
      id: "m1",
      role: "assistant",
      content: "候选稿需要确认",
      timestamp: 1,
      seq: 1,
      toolCalls: [{
        id: "tool-1",
        toolName: "candidate.create_chapter",
        status: "pending",
        summary: "创建候选稿",
        confirmation: { id: "tc-1", toolName: "candidate.create_chapter", target: "第三章候选稿", risk: "confirmed-write", summary: "创建候选稿", options: ["approve", "reject"] },
      }],
    }];
    fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/sessions/session-1/tools") {
        return { sessionId: "session-1", tools: [], pendingConfirmations: [messages[0].toolCalls[0].confirmation] };
      }
      if (url === "/api/sessions/session-1/tools/candidate.create_chapter/confirm" && options?.method === "POST") {
        return { ok: true, snapshot: { session, messages: [{ ...messages[0], toolCalls: [{ ...messages[0].toolCalls[0], status: "success" }], content: "确认已处理" }], cursor: { lastSeq: 2, ackedSeq: 2 } } };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    useAgentConversationRuntimeMock.mockReturnValue({
      state: { session, messages, cursor: { lastSeq: 1, ackedSeq: 1 }, lastSeq: 1, streamingMessageId: null, error: null, recovery: { state: "idle" }, resetRequired: false },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      applyEnvelope: applyEnvelopeMock,
      getResumeFromSeq: () => 1,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    const gate = await screen.findByTestId("confirmation-gate");
    expect(within(gate).getByText("candidate.create_chapter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批准" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/tools/candidate.create_chapter/confirm",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "approve", confirmationId: "tc-1", reason: null }) }),
    ));
    expect(applyEnvelopeMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "session:snapshot",
      snapshot: expect.objectContaining({ cursor: { lastSeq: 2, ackedSeq: 2 } }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/tools/candidate.create_chapter/confirm",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "reject", confirmationId: "tc-1", reason: null }) }),
    ));
  });

  it("surfaces confirmation failures and prevents duplicate confirmation submits", async () => {
    let confirmAttempts = 0;
    const applyEnvelopeMock = vi.fn();
    const session = { id: "session-1", title: "第三章续写", agentId: "writer", kind: "standalone", sessionMode: "chat", status: "active", createdAt: "2026-05-05T00:00:00.000Z", lastModified: "2026-05-05T00:00:00.000Z", messageCount: 1, sortOrder: 0, sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" } };
    const messages = [{
      id: "m1",
      role: "assistant",
      content: "候选稿需要确认",
      timestamp: 1,
      seq: 1,
      toolCalls: [{
        id: "tool-1",
        toolName: "candidate.create_chapter",
        status: "pending",
        confirmation: { id: "tc-1", toolName: "candidate.create_chapter", target: "第三章候选稿", risk: "confirmed-write", summary: "创建候选稿", options: ["approve", "reject"] },
      }],
    }];
    fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/sessions/session-1/tools") return { sessionId: "session-1", tools: [], pendingConfirmations: [messages[0].toolCalls[0].confirmation] };
      if (url === "/api/sessions/session-1/tools/candidate.create_chapter/confirm" && options?.method === "POST") {
        confirmAttempts += 1;
        throw Object.assign(new Error("Pending confirmation not found"), { status: 404, code: "pending-confirmation-not-found" });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    useAgentConversationRuntimeMock.mockReturnValue({
      state: { session, messages, cursor: { lastSeq: 1, ackedSeq: 1 }, lastSeq: 1, streamingMessageId: null, error: null, recovery: { state: "idle" }, resetRequired: false },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      applyEnvelope: applyEnvelopeMock,
      getResumeFromSeq: () => 1,
    });

    render(<StudioNextApp initialRoute={{ kind: "narrator", sessionId: "session-1" }} />);

    await screen.findByTestId("confirmation-gate");
    const approveButton = screen.getByRole("button", { name: "批准" });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    expect(await screen.findByText(/Pending confirmation not found/)).toBeTruthy();
    expect(confirmAttempts).toBe(1);
    expect(applyEnvelopeMock).not.toHaveBeenCalled();
  });

  it("mounts Writing Workbench for book routes", () => {
    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    expect(screen.getByTestId("writing-workbench-route").getAttribute("data-book-id")).toBe("b1");
    expect(screen.getByText("选择左侧资源开始写作")).toBeTruthy();
  });

  it("loads book route resources from the backend contract instead of empty shell props", async () => {
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [
        {
          id: "book:b1",
          kind: "book",
          title: "测试书",
          content: "",
          capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
          children: [
            {
              id: "chapter:b1:1",
              kind: "chapter",
              title: "第一章",
              content: "第一章正文",
              capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
            },
          ],
        },
      ],
      resourceMap: new Map(),
      openableNodes: [],
      errors: [],
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    expect(loadWorkbenchResourcesFromContractMock).toHaveBeenCalledWith(expect.anything(), "b1");
    expect(await screen.findByRole("button", { name: /第一章/ })).toBeTruthy();
    expect(screen.queryByText("选择左侧资源开始写作")).toBeTruthy();
  });

  it("opens chapter, candidate, draft, story/truth, jingwei, narrative and unsupported resources on the book canvas", async () => {
    const nodes = [
      { id: "chapter:b1:1", kind: "chapter", title: "第一章", content: "第一章正文", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "candidate:c1", kind: "candidate", title: "第二章候选稿", content: "候选正文", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: true, apply: true } },
      { id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false } },
      { id: "story-file:hooks.md", kind: "story", title: "hooks.md", path: "story/hooks.md", content: "伏笔内容", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } },
      { id: "truth-file:truth.md", kind: "truth", title: "truth.md", path: "story/truth.md", content: "真相内容", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "jingwei-entry:char-1", kind: "jingwei-entry", title: "沈舟", content: "主角，灵潮亲和。", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false } },
      { id: "narrative-line:b1", kind: "narrative-line", title: "叙事线快照", content: "主线：灵潮复苏。", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } },
      { id: "unsupported:candidates.list", kind: "unsupported", title: "候选稿加载失败", content: "", capabilities: { open: true, readonly: true, unsupported: true, edit: false, delete: false, apply: false } },
    ];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [nodes.at(-1)],
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /第一章/ }));
    expect(screen.getByLabelText("章节正文")).toHaveProperty("value", "第一章正文");

    fireEvent.click(screen.getByRole("button", { name: /第二章候选稿/ }));
    expect(screen.getByLabelText("候选稿正文")).toHaveProperty("value", "候选正文");

    fireEvent.click(screen.getByRole("button", { name: /片段草稿/ }));
    expect(screen.getByLabelText("草稿正文")).toHaveProperty("value", "草稿正文");

    fireEvent.click(screen.getByRole("button", { name: /hooks.md/ }));
    expect(screen.getByText("story/hooks.md")).toBeTruthy();
    expect(screen.getByLabelText("文本文件正文")).toHaveProperty("value", "伏笔内容");

    fireEvent.click(screen.getByRole("button", { name: /truth.md/ }));
    expect(screen.getByText("story/truth.md")).toBeTruthy();
    expect(screen.getByLabelText("文本文件正文")).toHaveProperty("value", "真相内容");

    fireEvent.click(screen.getByRole("button", { name: /沈舟/ }));
    expect(screen.getByTestId("writing-workbench-route").textContent).toContain("经纬资料");
    expect(screen.getByLabelText("只读内容")).toHaveProperty("value", "主角，灵潮亲和。");

    fireEvent.click(screen.getByRole("button", { name: /叙事线快照/ }));
    expect(screen.getByTestId("writing-workbench-route").textContent).toContain("叙事线");
    expect(screen.getByLabelText("只读内容")).toHaveProperty("value", "主线：灵潮复苏。");

    fireEvent.click(screen.getByRole("button", { name: /候选稿加载失败/ }));
    expect(screen.getByText("通用资源")).toBeTruthy();
    expect(screen.getByTestId("raw-resource-node").textContent).toContain('"kind": "unsupported"');
  });

  it("keeps the current canvas while a newly opened chapter detail is hydrating", async () => {
    let resolveChapter!: (value: { chapterNumber: number; filename: string; content: string }) => void;
    const chapterDetail = new Promise<{ chapterNumber: number; filename: string; content: string }>((resolve) => {
      resolveChapter = resolve;
    });
    const nodes = [
      { id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", metadata: { draftId: "d1", detailSource: "detail" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "chapter:b1:1", kind: "chapter", title: "第一章", content: "", metadata: { bookId: "b1", chapterNumber: 1, source: "list-preview" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
    ];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/books/b1/chapters/1") return chapterDetail;
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /片段草稿/ }));
    expect(screen.getByLabelText("草稿正文")).toHaveProperty("value", "草稿正文");
    fireEvent.click(screen.getByRole("button", { name: /第一章/ }));

    expect(screen.getByLabelText("草稿正文")).toHaveProperty("value", "草稿正文");
    expect(screen.getByRole("status").textContent).toContain("正在加载 第一章 详情");

    resolveChapter({ chapterNumber: 1, filename: "0001.md", content: "第一章详情正文" });

    expect(await screen.findByLabelText("章节正文")).toHaveProperty("value", "第一章详情正文");
  });

  it("saves editable book resources through the matching resource contract entry", async () => {
    const nodes = [
      { id: "chapter:b1:1", kind: "chapter", title: "第一章", content: "第一章正文", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", metadata: { draftId: "d1" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "truth-file:truth.md", kind: "truth", title: "truth.md", content: "真相内容", metadata: { fileName: "truth.md" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
    ];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [],
    });
    fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/books/b1/chapters/1" && options?.method === "PUT") return { ok: true };
      if (url === "/api/books/b1/chapters/1") return { chapterNumber: 1, filename: "0001.md", content: "更新章节" };
      if (url === "/api/books/b1/drafts/d1" && options?.method === "PUT") return { ok: true };
      if (url === "/api/books/b1/drafts/d1") return { id: "d1", content: "更新草稿", updatedAt: "2026-05-06T00:00:00.000Z" };
      if (url === "/api/books/b1/truth/truth.md" && options?.method === "PUT") return { ok: true };
      if (url === "/api/books/b1/truth-files/truth.md") return { file: "truth.md", content: "更新真相" };
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /第一章/ }));
    fireEvent.change(screen.getByLabelText("章节正文"), { target: { value: "更新章节" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/books/b1/chapters/1", expect.objectContaining({ method: "PUT", body: JSON.stringify({ content: "更新章节" }) })));

    fireEvent.click(screen.getByRole("button", { name: /片段草稿/ }));
    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "更新草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/books/b1/drafts/d1", expect.objectContaining({ method: "PUT", body: JSON.stringify({ id: "d1", title: "片段草稿", content: "更新草稿" }) })));

    fireEvent.click(screen.getByRole("button", { name: /truth.md/ }));
    fireEvent.change(screen.getByLabelText("文本文件正文"), { target: { value: "更新真相" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/books/b1/truth/truth.md", expect.objectContaining({ method: "PUT", body: JSON.stringify({ content: "更新真相" }) })));
  });

  it("keeps dirty state when a book resource save fails", async () => {
    const nodes = [{ id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", metadata: { draftId: "d1" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } }];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [],
    });
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/books/b1/drafts/d1" && options?.method === "PUT") throw Object.assign(new Error("保存接口失败"), { status: 500 });
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /片段草稿/ }));
    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "失败草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain("保存失败：保存接口失败");
    expect(screen.getByText("未保存")).toBeTruthy();
  });

  it("RED: dirty 资源切换和写作动作启动必须先拦截，不能丢弃未保存内容", async () => {
    const nodes = [
      { id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", metadata: { draftId: "d1", detailSource: "detail" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "chapter:b1:1", kind: "chapter", title: "第一章", content: "第一章正文", metadata: { bookId: "b1", chapterNumber: 1, detailSource: "detail" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
    ];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/providers/models") return { models: [] };
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /片段草稿/ }));
    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "未保存草稿" } });
    fireEvent.click(screen.getByRole("button", { name: /第一章/ }));

    expect(screen.getByLabelText("草稿正文")).toHaveProperty("value", "未保存草稿");
    expect(screen.getByRole("alert").textContent).toContain("未保存内容");
    expect(screen.getByRole("button", { name: "生成下一章" })).toHaveProperty("disabled", true);
    expect(screen.getAllByText(/保存或放弃后再启动写作动作/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "放弃并切换" }));
    expect(screen.getByLabelText("章节正文")).toHaveProperty("value", "第一章正文");
  });

  it("injects dirty workbench canvasContext into narrator send after opening a book resource", async () => {
    const session = { id: "session-1", title: "第三章续写", agentId: "writer", kind: "standalone", sessionMode: "chat", status: "active", createdAt: "2026-05-05T00:00:00.000Z", lastModified: "2026-05-05T00:00:00.000Z", messageCount: 1, sortOrder: 0, sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" } };
    const nodes = [{ id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", metadata: { draftId: "d1" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } }];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [],
    });
    useAgentConversationRuntimeMock.mockReturnValue({
      state: { session, messages: [], cursor: { lastSeq: 1, ackedSeq: 1 }, lastSeq: 1, streamingMessageId: null, error: null, recovery: { state: "idle" }, resetRequired: false },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 1,
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /片段草稿/ }));
    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "带上下文正文" } });

    useShellDataMock.mockReturnValue({
      books: [{ id: "b1", title: "测试书" }],
      sessions: [{ id: "session-1", title: "第三章续写", status: "active", projectId: "b1", agentId: "writer" }],
      routines: [],
      loading: false,
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.click(await screen.findByRole("button", { name: /第三章续写/ }));
    fireEvent.change(screen.getByLabelText("对话输入框"), { target: { value: "继续写" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(useAgentConversationRuntimeMock).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: "session-1",
      canvasContext: expect.objectContaining({
        activeTabId: "draft:d1",
        activeResource: expect.objectContaining({ id: "draft:d1", kind: "draft", title: "片段草稿" }),
        dirty: true,
        openTabs: [expect.objectContaining({ id: "draft:d1", dirty: true })],
      }),
    }));
    expect(sendMessageMock).toHaveBeenCalledWith("继续写");
  });

  it("starts workbench writing actions by reusing an active book writer session and navigating to conversation", async () => {
    useShellDataMock.mockReturnValue({
      books: [{ id: "b1", title: "测试书" }],
      sessions: [{ id: "session-existing", title: "已有写作会话", status: "active", projectId: "b1", agentId: "writer" }],
      routines: [],
      loading: false,
      error: null,
    });
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({ tree: [], resourceMap: new Map(), openableNodes: [], errors: [] });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/sessions?sort=recent&status=active&binding=book%3Ab1") return [{ id: "session-existing", title: "已有写作会话", status: "active", projectId: "b1", agentId: "writer" }];
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/sessions/session-existing/tools") return { sessionId: "session-existing", tools: [], pendingConfirmations: [] };
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: "生成下一章" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions?sort=recent&status=active&binding=book%3Ab1"));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions", expect.objectContaining({ method: "POST" }));
    await screen.findByLabelText("对话输入框");
    expect(screen.getByText("已有写作会话")).toBeTruthy();
    expect(useAgentConversationRuntimeMock).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "session-existing" }));
  });

  it("creates a bound writer session for workbench actions when no reusable session exists", async () => {
    const shellStore = { upsertSession: vi.fn(), invalidate: vi.fn() };
    useShellDataStoreMock.mockReturnValue(shellStore);
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({ tree: [], resourceMap: new Map(), openableNodes: [], errors: [] });
    fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url === "/api/sessions?sort=recent&status=active&binding=book%3Ab1") return [];
      if (url === "/api/sessions" && options?.method === "POST") return { id: "session-new", title: "《b1》生成下一章", status: "active", projectId: "b1", agentId: "writer", kind: "standalone", sessionMode: "chat" };
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/sessions/session-new/tools") return { sessionId: "session-new", tools: [], pendingConfirmations: [] };
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    fireEvent.click(await screen.findByRole("button", { name: "生成下一章" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "《b1》生成下一章", agentId: "writer", kind: "standalone", sessionMode: "chat", projectId: "b1" }) }),
    ));
    await screen.findByLabelText("对话输入框");
    expect(shellStore.upsertSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-new", title: "《b1》生成下一章", projectId: "b1", status: "active" }));
    expect(shellStore.invalidate).toHaveBeenCalledWith("sessions");
    expect(useAgentConversationRuntimeMock).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "session-new" }));
  });

  it("keeps unsupported workbench writing actions disabled without fake navigation", async () => {
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({ tree: [], resourceMap: new Map(), openableNodes: [], errors: [] });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    const previewButton = await screen.findByRole("button", { name: "扩写/改写" });
    expect(previewButton).toHaveProperty("disabled", true);
    expect(screen.getByText("当前能力仅提供 Prompt 预览，需要用户显式复制或应用。")) .toBeTruthy();
    fireEvent.click(previewButton);

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/sessions?"));
    expect(screen.queryByLabelText("对话输入框")).toBeNull();
  });

  it("blocks workbench action navigation while canvas is dirty", async () => {
    const session = { id: "session-new", title: "《b1》生成下一章", agentId: "writer", kind: "standalone", sessionMode: "chat", status: "active", createdAt: "2026-05-05T00:00:00.000Z", lastModified: "2026-05-05T00:00:00.000Z", messageCount: 0, sortOrder: 0, sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4" } };
    const nodes = [{ id: "draft:d1", kind: "draft", title: "片段草稿", content: "草稿正文", metadata: { draftId: "d1" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } }];
    loadWorkbenchResourcesFromContractMock.mockResolvedValue({
      tree: [{ id: "book:b1", kind: "book", title: "测试书", capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, children: nodes }],
      resourceMap: new Map(nodes.map((node) => [node.id, node])),
      openableNodes: nodes,
      errors: [],
    });
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/sessions?sort=recent&status=active&binding=book%3Ab1") return [];
      if (url === "/api/sessions" && options?.method === "POST") return session;
      if (url === "/api/providers/models") return { models: [] };
      if (url === "/api/sessions/session-new/tools") return { sessionId: "session-new", tools: [], pendingConfirmations: [] };
      throw new Error(`Unhandled fetch: ${url}`);
    });
    useAgentConversationRuntimeMock.mockReturnValue({
      state: { session, messages: [], cursor: { lastSeq: 0, ackedSeq: 0 }, lastSeq: 0, streamingMessageId: null, error: null, recovery: { state: "idle" }, resetRequired: false },
      sendMessage: sendMessageMock,
      abort: abortMock,
      ack: ackMock,
      getResumeFromSeq: () => 0,
    });

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /片段草稿/ }));
    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "带上下文正文" } });
    const writeNextButton = screen.getByRole("button", { name: "生成下一章" });
    expect(writeNextButton).toHaveProperty("disabled", true);
    fireEvent.click(writeNextButton);

    expect(screen.queryByLabelText("对话输入框")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions", expect.objectContaining({ method: "POST" }));
    expect(screen.getAllByText(/保存或放弃后再启动写作动作/).length).toBeGreaterThan(0);
  });

  it("shows loading and real errors while loading book resources", async () => {
    loadWorkbenchResourcesFromContractMock.mockRejectedValue(new Error("资源树加载失败"));

    render(<StudioNextApp initialRoute={{ kind: "book", bookId: "b1" }} />);

    expect(screen.getByRole("status").textContent).toContain("资源加载中");
    expect((await screen.findByRole("alert")).textContent).toContain("资源加载失败：资源树加载失败");
  });

  it("mounts live search, routines and settings pages instead of later-wiring placeholders", () => {
    render(<StudioNextApp initialRoute={{ kind: "search" }} />);
    expect(screen.getByTestId("search-page")).toBeTruthy();
    expect(screen.queryByText(/稍后接线/)).toBeNull();
    expect(SearchPageMock).toHaveBeenCalledOnce();

    cleanup();
    render(<StudioNextApp initialRoute={{ kind: "routines" }} />);
    expect(screen.getByTestId("routines-page")).toBeTruthy();
    expect(screen.queryByText(/稍后接线/)).toBeNull();
    expect(RoutinesNextPageMock).toHaveBeenCalledOnce();

    cleanup();
    render(<StudioNextApp initialRoute={{ kind: "settings" }} />);
    expect(screen.getByTestId("settings-section-content").textContent).toContain("models");
    expect(screen.getByText("个人设置")).toBeTruthy();
    expect(screen.getByText("实例管理")).toBeTruthy();
    expect(screen.getByText("运行资源与审计")).toBeTruthy();
    expect(screen.getByText("关于与项目")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开 AI 供应商" }));
    expect(screen.getByTestId("provider-settings-page")).toBeTruthy();
    expect(screen.queryByText(/稍后接线/)).toBeNull();
    expect(SettingsSectionContentMock).toHaveBeenCalled();
    expect(ProviderSettingsPageMock).toHaveBeenCalledOnce();
  });
});
