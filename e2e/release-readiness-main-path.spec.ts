import { expect, test, type APIRequestContext } from "@playwright/test";

function buildBookId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "book";
}

async function jsonText(responsePromise: Promise<ReturnType<APIRequestContext["get"]>> | ReturnType<APIRequestContext["get"]>): Promise<string> {
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return JSON.stringify(await response.json());
}

async function assertNoFixtureNoise(request: APIRequestContext): Promise<void> {
  const combined = [
    await jsonText(request.get("/api/providers")),
    await jsonText(request.get("/api/books")),
    await jsonText(request.get("/api/sessions")),
  ].join("\n");
  expect(combined).not.toContain("E2E Provider");
  expect(combined).not.toContain("E2E Model");
  expect(combined).not.toContain("Planner");
}

async function createSmokeProvider(request: APIRequestContext, suffix: string): Promise<{ providerId: string; modelId: string }> {
  const providerId = `smoke-provider-${suffix}`.slice(0, 48);
  const modelId = "smoke-model-a";
  const response = await request.post("/api/providers", {
    data: {
      id: providerId,
      name: `Smoke Provider ${suffix}`,
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      baseUrl: "https://example.invalid/v1",
      compatibility: "openai-compatible",
      apiMode: "responses",
      config: { apiKey: "sk-smoke-redacted" },
      models: [{
        id: modelId,
        name: "Smoke Model A",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        enabled: true,
        source: "manual",
        lastTestStatus: "success",
        supportsFunctionCalling: true,
        supportsStreaming: true,
      }],
    },
  });
  expect(response.status()).toBe(201);
  return { providerId, modelId };
}

async function configureSmokeSettings(request: APIRequestContext, runtime: { providerId: string; modelId: string }): Promise<void> {
  const model = `${runtime.providerId}:${runtime.modelId}`;
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
        defaultSessionModel: model,
        summaryModel: "",
        exploreSubagentModel: "",
        planSubagentModel: "",
        generalSubagentModel: "",
        subagentModelPool: [model],
        codexReasoningEffort: "high",
      },
    },
  });
  expect(response.status()).toBe(200);
}

async function createSmokeBook(request: APIRequestContext, title: string): Promise<{ bookId: string; title: string }> {
  const bookId = buildBookId(title);
  const createResponse = await request.post("/api/books/create", {
    data: { title, genre: "玄幻", language: "zh", chapterWordCount: 2000, targetChapters: 100 },
  });
  expect(createResponse.status()).toBe(200);
  await expect.poll(async () => (await request.get(`/api/books/${bookId}`)).status(), { timeout: 30_000 }).toBe(200);
  const chapterResponse = await request.post(`/api/books/${bookId}/chapters`, { data: { title: "第一章 干净根目录" } });
  expect(chapterResponse.status()).toBe(201);
  const saveResponse = await request.put(`/api/books/${bookId}/chapters/1`, { data: { content: "干净 root smoke 正文。" } });
  expect(saveResponse.status()).toBe(200);
  return { bookId, title };
}

test("release-readiness main path works on an isolated clean root", async ({ page, request }) => {
  const suffix = `${Date.now()}`;
  await assertNoFixtureNoise(request);
  const modeResponse = await request.get("/api/mode");
  expect(modeResponse.status()).toBe(200);

  const runtime = await createSmokeProvider(request, suffix);
  await configureSmokeSettings(request, runtime);
  const book = await createSmokeBook(request, `release-smoke-${suffix}`);

  const rootResponse = await page.goto("/");
  expect(rootResponse?.status()).toBe(200);
  await page.goto("/next");
  await expect(page.getByRole("heading", { name: "作者首页" })).toBeVisible();
  const main = page.getByTestId("shell-main");
  const bookOpenButton = main.getByRole("button", { name: `${book.title} 打开`, exact: true }).first();
  await expect(bookOpenButton).toBeVisible();
  await expect(page.getByText(/E2E Provider|E2E Model|Planner/)).toHaveCount(0);

  await bookOpenButton.click();
  await expect(page.getByTestId("writing-workbench-route")).toBeVisible();
  await expect(page.getByRole("heading", { name: book.title })).toBeVisible();
  await page.getByRole("button", { name: /第一章 干净根目录/ }).click();
  await expect(page.getByTestId("workbench-resource-header")).toContainText("保存状态：已保存");

  await page.getByRole("button", { name: "生成下一章" }).click();
  await expect(page).toHaveURL(/\/next\/narrators\//);
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() ?? "");
  expect(sessionId).toBeTruthy();
  await expect(page.getByTestId("conversation-surface")).toBeVisible();
  await expect(page.getByTestId("conversation-session-header")).toContainText("写作会话");
  await expect(page.getByTestId("conversation-status-bar")).toContainText(`绑定：书籍 ${book.bookId}`);

  await page.goto("/next/sessions");
  await expect(page.getByRole("heading", { name: "会话中心", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /写作会话/ })).toBeVisible();

  await page.goto("/next/settings");
  await expect(page.getByRole("button", { name: "模型" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("默认模型", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 供应商", exact: true }).click();
  await expect(page.getByRole("button", { name: /Smoke Provider/ })).toContainText("可配置");
  await page.getByRole("button", { name: "关于" }).click();
  await expect(page.getByRole("heading", { name: "关于" })).toBeVisible();

  await page.goto("/next/routines");
  await expect(page.getByRole("heading", { name: "套路" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "套路分区" }).getByRole("tab", { name: /MCP 工具/ })).toBeVisible();
});
