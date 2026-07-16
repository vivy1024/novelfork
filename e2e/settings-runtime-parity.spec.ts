import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

interface RegisteredSession {
  readonly token: string;
  readonly user: { readonly id: string; readonly username: string; readonly role: "admin" | "user" };
}

function uniqueUsername(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function register(
  request: APIRequestContext,
  username: string,
): Promise<RegisteredSession> {
  const response = await request.post("/api/auth/register", {
    data: { username, password: "Settings-password-123!", language: "zh-CN" },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<RegisteredSession>;
}

async function authenticate(page: Page, token: string): Promise<void> {
  await page.goto("/login");
  await page.evaluate((value) => localStorage.setItem("narrafork_token", value), token);
}

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function dismissOnboardingIfVisible(page: Page): Promise<void> {
  const firstRunSkip = page.getByRole("button", { name: "暂时跳过" });
  if (await firstRunSkip.isVisible().catch(() => false)) await firstRunSkip.click();
  const tourSkip = page.getByRole("button", { name: "跳过", exact: true });
  if (await tourSkip.isVisible().catch(() => false)) await tourSkip.click();
}

test("设置中心管理员门禁、移动端和敏感凭据持久化使用真实 Runtime", async ({ page, request }) => {
  const adminName = uniqueUsername("settings_admin");
  const userName = uniqueUsername("settings_user");
  const admin = await register(request, adminName);
  const user = await register(request, userName);
  expect(admin.user.role).toBe("admin");
  expect(user.user.role).toBe("user");

  const providerId = `e2e-provider-${Date.now()}`;
  const plaintextApiKey = "sk-e2e-sensitive-key-9876";
  const plaintextAuthorization = "Bearer e2e-sensitive-header-4321";
  const initialBaseUrl = "https://settings-e2e.example/v1";
  const persistedBaseUrl = "https://settings-persisted.example/v1";

  const seedResponse = await request.patch("/api/settings", {
    headers: authorization(admin.token),
    data: {
      customApiProviders: [{
        id: providerId,
        name: "Settings E2E Provider",
        prefix: "settings-e2e",
        apiKey: plaintextApiKey,
        baseUrl: initialBaseUrl,
        defaultModel: "writer-e2e",
        protocol: "responses-compatible",
        extraHeaders: {
          Authorization: plaintextAuthorization,
          "X-Settings-E2E": "visible-value",
        },
      }],
    },
  });
  expect(seedResponse.status()).toBe(200);

  const forbiddenPatch = await request.patch("/api/settings", {
    headers: authorization(user.token),
    data: { customApiProviders: [] },
  });
  expect(forbiddenPatch.status()).toBe(403);

  await authenticate(page, admin.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/next/settings/providers");
  await dismissOnboardingIfVisible(page);
  await expect(page.getByRole("heading", { name: "AI 供应商" })).toBeVisible();
  const editProvider = page.getByRole("button", { name: "编辑与测试 Settings E2E Provider" });
  await expect(editProvider).toBeVisible();
  await editProvider.click();
  await expect(page.getByText(/Runtime 返回掩码：\*+/)).toBeVisible();
  const headerEditor = page.getByLabel("额外请求头 JSON");
  await expect(headerEditor).toHaveValue(/visible-value/);
  await expect(headerEditor).not.toHaveValue(new RegExp(plaintextAuthorization));
  await expect(headerEditor).toHaveValue(/\*{4,}/);

  await page.getByLabel("Base URL").fill(persistedBaseUrl);
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/settings"
      && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "保存变更" }).click();
  expect((await saved).status()).toBe(200);

  await page.reload();
  const reloadedEditProvider = page.getByRole("button", { name: "编辑与测试 Settings E2E Provider" });
  await expect(reloadedEditProvider).toBeVisible();
  await reloadedEditProvider.click();
  await expect(page.getByLabel("Base URL")).toHaveValue(persistedBaseUrl);
  await expect(page.getByLabel("额外请求头 JSON")).not.toHaveValue(new RegExp(plaintextAuthorization));

  const persistedResponse = await request.get("/api/settings", {
    headers: authorization(admin.token),
  });
  expect(persistedResponse.status()).toBe(200);
  const persistedSettings = await persistedResponse.json() as {
    customApiProviders: Array<{
      id: string;
      apiKey: string;
      baseUrl: string;
      extraHeaders?: Record<string, string>;
    }>;
  };
  const persistedProvider = persistedSettings.customApiProviders.find((provider) => provider.id === providerId);
  expect(persistedProvider).toMatchObject({ baseUrl: persistedBaseUrl });
  expect(persistedProvider?.apiKey).not.toContain(plaintextApiKey);
  expect(persistedProvider?.apiKey).toContain("*");
  expect(persistedProvider?.extraHeaders?.Authorization).not.toContain(plaintextAuthorization);
  expect(persistedProvider?.extraHeaders?.Authorization).toContain("*");
  expect(JSON.stringify(persistedSettings)).not.toContain(plaintextApiKey);
  expect(JSON.stringify(persistedSettings)).not.toContain(plaintextAuthorization);

  await page.goto("/next/settings/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await page.goto("/next/settings/devices");
  await expect(page.getByRole("heading", { name: "设备管理" })).toBeVisible();
  await page.goto("/next/settings/runtime");
  await expect(page.getByRole("heading", { name: "运行时环境" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/next/settings/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await expect(page.getByText(userName)).toBeVisible();

  await authenticate(page, user.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/next/settings/providers");
  await dismissOnboardingIfVisible(page);
  await expect(page).toHaveURL(/\/next\/settings\/profile$/);
  await expect(page.getByRole("heading", { name: "个人资料", level: 2 })).toBeVisible();
  await expect(page.getByText("AI 供应商", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/next/settings/users");
  await expect(page).toHaveURL(/\/next\/settings\/profile$/);
  await expect(page.getByRole("heading", { name: "个人资料", level: 2 })).toBeVisible();
  await expect(page.getByText("用户管理", { exact: true })).toHaveCount(0);
});
