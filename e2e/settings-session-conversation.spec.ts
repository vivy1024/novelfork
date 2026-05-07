import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function buildBookId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "book";
}

async function waitForBookReady(request: APIRequestContext, bookId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`/api/books/${bookId}`);
    return response.status();
  }, { timeout: 30_000 }).toBe(200);
}

async function createBook(request: APIRequestContext, title: string): Promise<{ bookId: string; title: string }> {
  const bookId = buildBookId(title);
  const createResponse = await request.post("/api/books/create", {
    data: {
      title,
      genre: "玄幻",
      language: "zh",
      chapterWordCount: 2000,
      targetChapters: 100,
    },
  });
  expect(createResponse.status()).toBe(200);
  await waitForBookReady(request, bookId);
  return { bookId, title };
}

async function prepareRuntimeModel(request: APIRequestContext, suffix: string): Promise<{ providerId: string; modelA: string; modelB: string }> {
  const providerId = `e2e-provider-${suffix}`.slice(0, 48);
  const modelA = "e2e-model-a";
  const modelB = "e2e-model-b";
  const response = await request.post("/api/providers", {
    data: {
      id: providerId,
      name: `E2E Provider ${suffix}`,
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      baseUrl: "https://example.invalid/v1",
      compatibility: "openai-compatible",
      apiMode: "responses",
      config: { apiKey: "sk-e2e-redacted" },
      models: [
        {
          id: modelA,
          name: "E2E Model A",
          contextWindow: 128000,
          maxOutputTokens: 8192,
          enabled: true,
          source: "manual",
          lastTestStatus: "success",
          supportsFunctionCalling: true,
          supportsStreaming: true,
        },
        {
          id: modelB,
          name: "E2E Model B",
          contextWindow: 192000,
          maxOutputTokens: 12000,
          enabled: true,
          source: "manual",
          lastTestStatus: "success",
          supportsFunctionCalling: true,
          supportsStreaming: true,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  return { providerId, modelA, modelB };
}

async function configureUserDefaults(request: APIRequestContext, runtime: { providerId: string; modelA: string; modelB: string }, options: { defaultModel: boolean }): Promise<void> {
  const response = await request.put("/api/settings/user", {
    data: {
      runtimeControls: {
        defaultPermissionMode: "edit",
        defaultReasoningEffort: "medium",
        maxTurnSteps: 8,
        contextCompressionThresholdPercent: 80,
        contextTruncateTargetPercent: 70,
        largeWindowCompressionThresholdPercent: 60,
        largeWindowTruncateTargetPercent: 50,
        recovery: { maxRetryAttempts: 2, initialRetryDelayMs: 10, maxRetryDelayMs: 50, backoffMultiplier: 2 },
        toolAccess: { allowlist: [], blocklist: [], mcpStrategy: "inherit" },
        runtimeDebug: { tokenDebugEnabled: false, rateDebugEnabled: false, dumpEnabled: false },
        sendMode: "enter",
      },
      modelDefaults: {
        defaultSessionModel: options.defaultModel ? `${runtime.providerId}:${runtime.modelA}` : "",
        summaryModel: "",
        exploreSubagentModel: "",
        planSubagentModel: "",
        generalSubagentModel: "",
        subagentModelPool: [`${runtime.providerId}:${runtime.modelA}`, `${runtime.providerId}:${runtime.modelB}`],
        codexReasoningEffort: "high",
      },
    },
  });
  expect(response.status()).toBe(200);
}

async function configureModelessUserDefaults(request: APIRequestContext): Promise<void> {
  const response = await request.put("/api/settings/user", {
    data: {
      runtimeControls: {
        defaultPermissionMode: "edit",
        defaultReasoningEffort: "medium",
        maxTurnSteps: 8,
        contextCompressionThresholdPercent: 80,
        contextTruncateTargetPercent: 70,
        largeWindowCompressionThresholdPercent: 60,
        largeWindowTruncateTargetPercent: 50,
        recovery: { maxRetryAttempts: 2, initialRetryDelayMs: 10, maxRetryDelayMs: 50, backoffMultiplier: 2 },
        toolAccess: { allowlist: [], blocklist: [], mcpStrategy: "inherit" },
        runtimeDebug: { tokenDebugEnabled: false, rateDebugEnabled: false, dumpEnabled: false },
        sendMode: "enter",
      },
      modelDefaults: {
        defaultSessionModel: "",
        summaryModel: "",
        exploreSubagentModel: "",
        planSubagentModel: "",
        generalSubagentModel: "",
        subagentModelPool: [],
        codexReasoningEffort: "high",
      },
    },
  });
  expect(response.status()).toBe(200);
}

async function deleteProviders(request: APIRequestContext, predicate: (provider: { id: string; name?: string }) => boolean): Promise<void> {
  const response = await request.get("/api/providers");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { providers?: Array<{ id: string; name?: string }> };
  for (const provider of payload.providers ?? []) {
    if (predicate(provider)) {
      const deleteResponse = await request.delete(`/api/providers/${provider.id}`);
      expect(deleteResponse.status()).toBe(200);
    }
  }
}

async function deleteE2EProviders(request: APIRequestContext): Promise<void> {
  await deleteProviders(request, (provider) => provider.id.startsWith("e2e-provider-") || Boolean(provider.name?.startsWith("E2E Provider")));
}

async function deleteAllProviders(request: APIRequestContext): Promise<void> {
  await deleteProviders(request, () => true);
}

async function createStandaloneSession(request: APIRequestContext, title: string): Promise<{ id: string; title: string }> {
  const response = await request.post("/api/sessions", {
    data: { title, agentId: "writer", sessionMode: "chat" },
  });
  expect(response.status()).toBe(201);
  const session = await response.json() as { id: string; title: string };
  expect(session.id).toBeTruthy();
  return session;
}

async function createBookAndOpenWorkbench(page: Page, request: APIRequestContext, title: string): Promise<{ bookId: string; title: string }> {
  const created = await createBook(request, title);
  await page.goto(`/next/books/${created.bookId}`);
  await expect(page.getByTestId("writing-workbench-route")).toBeVisible();
  return created;
}

test("conversation route empty state exposes release layout and model-unavailable recovery", async ({ page, request }) => {
  const suffix = `${Date.now()}`;
  await deleteAllProviders(request);
  await configureModelessUserDefaults(request);
  const session = await createStandaloneSession(request, `e2e-empty-conversation-${suffix}`);

  await page.goto(`/next/narrators/${session.id}`);
  await expect(page.getByTestId("conversation-surface")).toBeVisible();
  await expect(page.getByTestId("conversation-session-header")).toContainText(session.title);
  await expect(page.getByTestId("conversation-session-facts")).toContainText("就绪");
  await expect(page.getByTestId("conversation-session-facts")).toContainText("绑定：standalone");
  await expect(page.getByTestId("conversation-runtime-summary-cards")).toContainText("Tokens：");

  const emptyState = page.getByTestId("conversation-empty-state");
  await expect(emptyState).toContainText("还没有消息");
  await expect(emptyState).toContainText("当前绑定：standalone");
  await expect(emptyState).toContainText("模型池为空，请先到设置页启用模型");
  await expect(emptyState.getByRole("link", { name: "打开设置" })).toHaveAttribute("href", "/next/settings");

  const composer = page.getByTestId("conversation-composer-dock");
  await expect(composer).toContainText("模型池为空，请先到设置页启用模型");
  await expect(composer.getByRole("button", { name: "发送" })).toBeDisabled();
  await composer.getByLabel("对话输入框").fill("/");
  await expect(composer.getByRole("listbox", { name: "斜杠命令建议" })).toBeVisible();
});

test("settings page shows truthful provider/model/runtime facts without current Codex sandbox claims", async ({ page, request }) => {
  const suffix = `${Date.now()}`;
  const runtime = await prepareRuntimeModel(request, suffix);
  await configureUserDefaults(request, runtime, { defaultModel: false });

  await page.goto("/next/settings");
  await expect(page.getByRole("button", { name: "模型" })).toHaveAttribute("aria-current", "page");
  const defaultModelFact = page.locator("[data-setting-fact-id='model.defaultSessionModel']");
  await expect(defaultModelFact).toContainText("默认模型");
  await expect(defaultModelFact).toContainText("未配置");
  await expect(defaultModelFact).not.toContainText("E2E Model A");
  await expect(page.getByText("Codex 推理强度")).toBeVisible();

  await page.getByRole("button", { name: "AI 供应商", exact: true }).click();
  const codexCard = page.getByRole("button", { name: /Codex/ });
  await expect(codexCard).toContainText("可导入 / 未配置账号 / 不可调用");
  await expect(page.getByLabel("搜索供应商或模型")).toBeVisible();
  const e2eProviderCard = page.getByRole("button", { name: /E2E Provider/ });
  await expect(e2eProviderCard).toContainText("测试夹具");
  await page.getByLabel("隐藏测试夹具").check();
  await expect(e2eProviderCard).toHaveCount(0);

  await page.getByRole("button", { name: "AI 代理" }).click();
  await expect(page.getByText("运行策略来源")).toBeVisible();
  await expect(page.getByText("首 token 超时")).toBeVisible();
  await expect(page.getByText(/计划中.*settings schema 尚无 first-token timeout 字段/)).toBeVisible();
  await expect(page.getByText("Codex sandbox 已接入")).toHaveCount(0);
  await expect(page.locator("text=已接入")).toHaveCount(0);
});

test("workbench action creates a synced narrator session and conversation route reflects persisted config/tool facts", async ({ page, request }) => {
  const suffix = `${Date.now()}`;
  const runtime = await prepareRuntimeModel(request, suffix);
  await configureUserDefaults(request, runtime, { defaultModel: true });
  const bookTitle = `e2e-session-${suffix}`;
  const { bookId } = await createBookAndOpenWorkbench(page, request, bookTitle);

  await page.getByRole("button", { name: "生成下一章" }).click();
  await expect(page).toHaveURL(/\/next\/narrators\//);
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() ?? "");
  expect(sessionId).toBeTruthy();

  const sidebar = page.getByTestId("shell-sidebar");
  await expect(sidebar.getByRole("button", { name: new RegExp(`新书《${bookTitle}`) })).toBeVisible();
  await expect(page.getByTestId("conversation-surface")).toBeVisible();
  await expect(page.getByTestId("conversation-status-bar")).toContainText(`绑定：书籍 ${bookId}`);
  await expect(page.getByTestId("conversation-status-bar")).toContainText("权限：编辑");
  await expect(page.getByTestId("conversation-status-bar")).toContainText("推理：medium");
  const recoveryNotice = page.getByTestId("conversation-recovery-notice");
  if (await recoveryNotice.isVisible()) {
    await expect(recoveryNotice).toContainText(/会话恢复状态|失败|重连|reconnect/);
  }

  const toolMessage = {
    id: "assistant-tool-e2e",
    role: "assistant",
    content: "已读取工作台快照。",
    timestamp: Date.now(),
    seq: 1,
    toolCalls: [
      {
        id: "tool-e2e-snapshot",
        toolName: "cockpit.get_snapshot",
        status: "success",
        summary: "已读取工作台快照。",
        input: { bookId, apiKey: "sk-should-redact" },
        result: { ok: true, summary: "快照可用", resources: [{ path: `${bookId}/chapter-1.md` }] },
        duration: 42,
      },
    ],
  };
  const stateResponse = await request.put(`/api/sessions/${sessionId}/chat/state`, { data: { messages: [toolMessage] } });
  expect(stateResponse.status()).toBe(200);

  await page.reload();
  const toolCard = page.getByTestId("tool-call-card-tool-e2e-snapshot");
  await expect(toolCard).toBeVisible();
  await expect(toolCard).toContainText("cockpit.get_snapshot");
  await expect(toolCard).toContainText("完成");
  await toolCard.getByRole("button", { name: "展开工具原始数据" }).click();
  await expect(toolCard).toContainText("[REDACTED]");
  await expect(toolCard).not.toContainText("sk-should-redact");
  await toolCard.getByRole("button", { name: "全屏查看" }).click();
  const toolDialog = page.getByRole("dialog", { name: "工具调用全屏详情" });
  await expect(toolDialog).toContainText("cockpit.get_snapshot");
  await expect(toolDialog).toContainText("[REDACTED]");
  await toolDialog.getByRole("button", { name: "关闭" }).click();

  const pendingConfirmationMessage = {
    id: "assistant-confirm-e2e",
    role: "assistant",
    content: "需要确认后才能退出引导并写入候选稿。",
    timestamp: Date.now(),
    seq: 2,
    toolCalls: [
      {
        id: "tool-e2e-confirm",
        toolName: "guided.exit",
        status: "pending",
        summary: "退出引导模式并执行计划",
        input: { bookId, guidedStateId: "guided-state-e2e", plan: { title: "写入候选稿" } },
        result: { ok: true, status: "pending-confirmation" },
        confirmation: {
          id: "confirm-e2e-write",
          toolName: "guided.exit",
          target: bookId,
          risk: "confirmed-write",
          summary: "退出引导模式并执行计划",
          options: ["approve", "reject", "open-in-canvas"],
          sessionId,
          createdAt: new Date().toISOString(),
        },
      },
    ],
  };
  const pendingResponse = await request.put(`/api/sessions/${sessionId}/chat/state`, { data: { messages: [toolMessage, pendingConfirmationMessage] } });
  expect(pendingResponse.status()).toBe(200);
  await page.reload();
  const confirmationLane = page.getByTestId("conversation-recovery-confirmation-lane");
  await expect(confirmationLane).toContainText("guided.exit");
  await expect(confirmationLane).toContainText("退出引导模式并执行计划");
  await expect(confirmationLane).toContainText("风险：confirmed-write");
  await confirmationLane.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByTestId("confirmation-gate")).toHaveCount(0);
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${sessionId}/tools`);
    const payload = await response.json() as { pendingConfirmations?: unknown[] };
    return payload.pendingConfirmations?.length ?? -1;
  }).toBe(0);

  await page.getByLabel("权限").selectOption("read");
  await expect(page.getByTestId("conversation-status-bar")).toContainText("权限：只读");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${sessionId}`);
    const payload = await response.json() as { sessionConfig?: { permissionMode?: string } };
    return payload.sessionConfig?.permissionMode;
  }).toBe("read");

  await page.getByLabel("推理强度").selectOption("high");
  await expect(page.getByTestId("conversation-status-bar")).toContainText("推理：high");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${sessionId}`);
    const payload = await response.json() as { sessionConfig?: { reasoningEffort?: string } };
    return payload.sessionConfig?.reasoningEffort;
  }).toBe("high");

  await page.getByLabel("模型").selectOption(`${runtime.providerId}::${runtime.modelB}`);
  await expect(page.getByTestId("conversation-status-bar")).toContainText("E2E Model B");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${sessionId}`);
    const payload = await response.json() as { sessionConfig?: { providerId?: string; modelId?: string } };
    return `${payload.sessionConfig?.providerId}:${payload.sessionConfig?.modelId}`;
  }).toBe(`${runtime.providerId}:${runtime.modelB}`);

  const runtimeControls = page.getByTestId("conversation-runtime-controls");
  await expect(runtimeControls.getByRole("button", { name: "中断运行" })).toBeDisabled();
  await expect(runtimeControls).toContainText("无运行中的会话");

  const runningStateResponse = await request.put(`/api/sessions/${sessionId}/chat/state`, {
    data: {
      messages: [
        {
          ...toolMessage,
          toolCalls: [{ ...toolMessage.toolCalls[0], status: "running", summary: "正在读取工作台快照。" }],
        },
      ],
    },
  });
  expect(runningStateResponse.status()).toBe(200);
  await page.reload();
  const runningControls = page.getByTestId("conversation-runtime-controls");
  await expect(runningControls.getByRole("button", { name: "中断运行" })).toBeEnabled();
  await expect(runningControls).not.toContainText("无运行中的会话");
});
