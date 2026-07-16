import { expect, test, type Page } from "@playwright/test";

function uniqueUsername(): string {
  return `routines_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function chooseSelect(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click({ timeout: 10_000 });
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function runtimeJson<T>(page: Page, path: string, init?: RequestInit): Promise<{ status: number; payload: T }> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    return { status: response.status, payload: await response.json() as T };
  }, { requestPath: path, requestInit: init });
}

test("隔离 Runtime 真实闭环命令 CRUD 与全局/作品 MCP 权限继承", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  const createAccountButton = page.getByRole("button", { name: "没有账户？创建账户" });
  if (await createAccountButton.count()) {
    await createAccountButton.click();
  }
  await page.getByLabel("用户名").fill(uniqueUsername());
  await page.getByLabel("密码").fill("Routines-runtime-password-123!");
  const createButton = page.getByRole("button", { name: "创建并登录" });
  if (await createButton.count()) {
    await createButton.click();
  } else {
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.getByTestId("agent-shell-route")).toBeVisible({ timeout: 30_000 });
  const welcomeDialog = page.getByRole("dialog", { name: "欢迎使用 NovelFork" });
  if (await welcomeDialog.isVisible()) {
    await welcomeDialog.getByRole("button", { name: "暂时跳过" }).click();
  }
  const guidedTour = page.locator('[aria-label="引导教程"]');
  if (await guidedTour.isVisible()) {
    await guidedTour.getByRole("button", { name: "跳过" }).click();
  }

  const bookTitle = `隔离资源切片-${Date.now()}`;
  await page.getByRole("main").getByRole("button", { name: "新建作品", exact: true }).click({ timeout: 10_000 });
  const createBookDialog = page.getByRole("dialog");
  await createBookDialog.getByPlaceholder("留空则由 AI 引导生成").fill(bookTitle);
  await createBookDialog.getByRole("button", { name: "开始创作" }).click();
  await expect(page).toHaveURL(/\/next\/books\//, { timeout: 30_000 });
  const bookId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
  expect(bookId).toBeTruthy();
  const bootstrap = await runtimeJson<{
    narrators: Array<{ id: string; bookId: string }>;
  }>(page, "/api/novelfork/bootstrap");
  const narratorId = bootstrap.payload.narrators.find((narrator) => narrator.bookId === bookId)?.id ?? "";
  expect(narratorId).toBeTruthy();

  const createdMcp = await runtimeJson<{ id: string }>(page, "/api/mcp/servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "E2E Memory",
      transport: "stdio",
      command: "bun",
      args: ["run", "e2e/fixtures/real-mcp-server.ts"],
      enabled: true,
      defaultBehavior: "readOnly",
    }),
  });
  expect(createdMcp.status).toBe(201);
  const serverId = createdMcp.payload.id;
  const connected = await runtimeJson<{ status?: string; error?: string }>(
    page,
    `/api/mcp/servers/${encodeURIComponent(serverId)}/connect`,
    { method: "POST" },
  );
  expect(connected.status).toBe(200);
  expect(connected.payload.status).toBe("connected");

  await page.getByRole("button", { name: "套路", exact: true }).click();
  await expect(page.getByRole("heading", { name: "套路", exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "自定义命令" }).click();
  await page.getByRole("button", { name: "添加命令" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称").fill("e2e-review");
  await dialog.getByLabel("提示模板").fill("Review the isolated chapter");
  await dialog.getByRole("button", { name: "创建命令" }).click();
  await expect(page.getByText("/e2e-review")).toBeVisible();

  let slashMenu = await runtimeJson<{ commands: Array<{ name: string; prompt: string }> }>(
    page,
    `/api/narrators/${encodeURIComponent(narratorId)}/commands`,
  );
  expect(slashMenu.payload.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "e2e-review", prompt: "Review the isolated chapter" }),
  ]));

  const commandCard = page.locator('[data-slot="card"]').filter({ hasText: "/e2e-review" });
  await commandCard.getByRole("button", { name: "编辑" }).click({ timeout: 10_000 });
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("提示模板").fill("Review continuity in the isolated chapter");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  slashMenu = await runtimeJson(page, `/api/narrators/${encodeURIComponent(narratorId)}/commands`);
  expect(slashMenu.payload.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "e2e-review", prompt: "Review continuity in the isolated chapter" }),
  ]));

  await commandCard.getByRole("button", { name: "删除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(commandCard).toHaveCount(0);
  slashMenu = await runtimeJson(page, `/api/narrators/${encodeURIComponent(narratorId)}/commands`);
  expect(slashMenu.payload.commands.some((command) => command.name === "e2e-review")).toBe(false);

  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await expect(page.getByText("E2E Memory", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`作品权限覆盖 · ${bookTitle}`)).toBeVisible();

  await chooseSelect(page, "工具权限：E2E Memory/recall", "拒绝");
  let globalServers = await runtimeJson<{
    servers: Array<{ id: string; toolPermissions?: Array<{ toolName: string; behavior: string }> }>;
  }>(page, "/api/mcp/servers");
  expect(globalServers.payload.servers.find((server) => server.id === serverId)?.toolPermissions).toEqual([
    expect.objectContaining({ toolName: "recall", behavior: "deny" }),
  ]);
  await chooseSelect(page, "工具权限：E2E Memory/recall", "继承服务器设置");
  globalServers = await runtimeJson(page, "/api/mcp/servers");
  expect(globalServers.payload.servers.find((server) => server.id === serverId)?.toolPermissions ?? []).toEqual([]);

  await chooseSelect(page, "作品服务器权限：E2E Memory", "询问");
  await chooseSelect(page, "作品工具权限：E2E Memory/recall", "拒绝");
  let bookOverrides = await runtimeJson<{
    serverOverrides: Array<{
      serverId: string;
      defaultBehavior?: string;
      toolPermissions?: Array<{ toolName: string; behavior: string }>;
    }>;
  }>(page, `/api/books/${encodeURIComponent(bookId)}/mcp`);
  expect(bookOverrides.payload.serverOverrides).toEqual([
    {
      serverId,
      defaultBehavior: "ask",
      toolPermissions: [{ toolName: "recall", behavior: "deny" }],
    },
  ]);

  await chooseSelect(page, "作品服务器权限：E2E Memory", "继承全局设置");
  await chooseSelect(page, "作品工具权限：E2E Memory/recall", "继承上层设置");
  bookOverrides = await runtimeJson(page, `/api/books/${encodeURIComponent(bookId)}/mcp`);
  expect(bookOverrides.payload.serverOverrides).toEqual([]);

  await page.screenshot({ path: ".test-data/routines-runtime-resources/browser-proof.png", fullPage: true });
});

test("移动端可切换套路资源分区并保持未选作品安全提示", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  const createAccountButton = page.getByRole("button", { name: "没有账户？创建账户" });
  if (await createAccountButton.count()) {
    await createAccountButton.click();
  }
  await page.getByLabel("用户名").fill(uniqueUsername());
  await page.getByLabel("密码").fill("Routines-mobile-password-123!");
  const createButton = page.getByRole("button", { name: "创建并登录" });
  if (await createButton.count()) {
    await createButton.click();
  } else {
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.getByTestId("agent-shell-route")).toBeVisible({ timeout: 30_000 });
  const welcomeDialog = page.getByRole("dialog", { name: "欢迎使用 NovelFork" });
  if (await welcomeDialog.isVisible()) {
    await welcomeDialog.getByRole("button", { name: "暂时跳过" }).click();
  }
  const guidedTour = page.locator('[aria-label="引导教程"]');
  if (await guidedTour.isVisible()) {
    await guidedTour.getByRole("button", { name: "跳过" }).click();
  }
  const mobileNavigation = page.getByRole("button", { name: "打开主导航" });
  if (await mobileNavigation.count()) {
    await mobileNavigation.click();
  }
  await page.getByRole("button", { name: "套路", exact: true }).click();
  await expect(page.getByRole("heading", { name: "套路", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "内置套路" })).toBeVisible();
  await page.getByRole("tab", { name: "规则与提示词" }).click();
  await expect(page.getByRole("heading", { name: "规则与提示词", exact: true })).toBeVisible();
  await expect(page.getByLabel("默认系统提示词 Markdown")).toBeVisible();
});
