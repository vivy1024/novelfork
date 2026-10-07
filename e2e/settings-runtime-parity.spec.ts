import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// 嵌入的 Runtime 原页在 dev 模式下首次编译页面块要几秒，关键等待一律给 30 秒（同 routines spec 先例）。
const EMBEDDED_PAGE_TIMEOUT = 30_000;

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
  inviteCode?: string,
): Promise<RegisteredSession> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await request.post("/api/auth/register", {
      data: {
        username,
        password: "Settings-password-123!",
        language: "zh-CN",
        ...(inviteCode ? { code: inviteCode } : {}),
      },
    });
    // 0.7 起同一实例的注册有 3 秒最小间隔（首个账户豁免）；窗口期内按服务端提示等待重试。
    if (response.status() !== 429 || attempt >= 3) {
      expect(response.status()).toBe(201);
      return response.json() as Promise<RegisteredSession>;
    }
    const body = await response.json().catch(() => ({})) as { retryAfterMs?: number };
    await new Promise((resolve) => setTimeout(resolve, (body.retryAfterMs ?? 3_000) + 250));
  }
}

async function authenticate(page: Page, token: string): Promise<void> {
  await page.goto("/login");
  // Runtime 登录成功时会同时写下界面语言（applySession → changeAppLanguage 缓存进
  // localStorage.narrafork_lang）；这里塞 token 绕过登录页，语言键一并补上。
  await page.evaluate((value) => {
    localStorage.setItem("narrafork_token", value);
    localStorage.setItem("narrafork_lang", "zh-CN");
  }, token);
}

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function dismissOnboardingIfVisible(page: Page): Promise<void> {
  // FirstRun 与导览在页面数据加载后才弹出，得等它们出现再点；不出现就放行。
  const firstRunSkip = page.getByRole("button", { name: "暂时跳过" });
  await firstRunSkip.waitFor({ state: "visible", timeout: 8_000 })
    .then(() => firstRunSkip.click())
    .catch(() => undefined);
  const tourSkip = page.getByRole("button", { name: "跳过", exact: true });
  await tourSkip.waitFor({ state: "visible", timeout: 3_000 })
    .then(() => tourSkip.click())
    .catch(() => undefined);
}

test("设置中心管理员门禁、移动端和敏感凭据持久化使用真实 Runtime", async ({ page, request }) => {
  const adminName = uniqueUsername("settings_admin");
  const userName = uniqueUsername("settings_user");
  const admin = await register(request, adminName);
  // Runtime 0.7 起首个管理员创建后注册自动关闭：第二位账户用一次性注册码，
  // 避免在打开注册开关的窗口期与注册限流（3 秒最小间隔）赛跑。
  const inviteResponse = await request.post("/api/admin/registration-codes", {
    headers: authorization(admin.token),
    data: { role: "user" },
  });
  expect(inviteResponse.status()).toBe(201);
  const inviteCode = (await inviteResponse.json() as { code: string }).code;
  const user = await register(request, userName, inviteCode);
  expect(admin.user.role).toBe("admin");
  expect(user.user.role).toBe("user");

  // 新实例的设置页先显示初始向导（实例级 setupWizardCompleted=false），完成后才出现设置内容。
  const completeWizard = await request.patch("/api/user-preferences", {
    headers: authorization(admin.token),
    data: { setupWizardCompleted: true },
  });
  expect(completeWizard.status()).toBe(200);

  const providerId = `e2e-provider-${Date.now()}`;
  const plaintextApiKey = "e2e-api-key-9876543210";
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
  // Runtime 0.7.10 原页：标题在总览，点供应商卡片进详情编辑。
  await expect(page.getByRole("heading", { name: "AI 供应商" })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  await page.getByRole("button", { name: /Settings E2E Provider/ }).first().click();
  await expect(page.getByRole("heading", { name: "Settings E2E Provider" })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });

  // API Key 以 Runtime 掩码显示（8 星 + 明文末 4 位），不回显完整明文。
  const apiKeyInput = page.getByLabel("API Key");
  const apiKeyValue = await apiKeyInput.inputValue();
  expect(apiKeyValue.startsWith("*".repeat(8))).toBe(true);
  expect(apiKeyValue.endsWith(plaintextApiKey.slice(-4))).toBe(true);
  expect(apiKeyValue).not.toBe(plaintextApiKey);
  // 上游 0.7 起自定义供应商的指纹请求头以行式编辑器直接编辑，GET 明文回显；
  // 服务端只对搜索供应商的 headers 打掩。本用例用占位值验证来回持久化。
  await expect(page.getByText("额外请求头", { exact: true })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  const headerNameInputs = page.getByPlaceholder("请求头名称");
  const headerValueInputs = page.getByPlaceholder("请求头值");
  await expect(headerNameInputs.first()).toHaveValue("Authorization");
  await expect(headerValueInputs.first()).toHaveValue(plaintextAuthorization);
  await expect(headerNameInputs.nth(1)).toHaveValue("X-Settings-E2E");
  await expect(headerValueInputs.nth(1)).toHaveValue(/visible-value/);

  await page.getByLabel("Base URL").fill(persistedBaseUrl);
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/settings"
      && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "保存更改" }).click();
  expect((await saved).status()).toBe(200);

  await page.reload();
  await dismissOnboardingIfVisible(page);
  await page.getByRole("button", { name: /Settings E2E Provider/ }).first().click();
  await expect(page.getByLabel("Base URL")).toHaveValue(persistedBaseUrl);
  await expect(page.getByPlaceholder("请求头值").first()).toHaveValue(plaintextAuthorization);

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
  // API Key 持久化后仍以掩码返回（8 星 + 末 4），不回显完整明文；掩码不会被当成新值覆盖。
  const persistedApiKey = persistedProvider?.apiKey ?? "";
  expect(persistedApiKey.startsWith("*".repeat(8))).toBe(true);
  expect(persistedApiKey.endsWith(plaintextApiKey.slice(-4))).toBe(true);
  expect(persistedApiKey).not.toBe(plaintextApiKey);
  expect(JSON.stringify(persistedSettings)).not.toContain(plaintextApiKey);
  // 指纹请求头按 0.7 行为 plaintext 持久化并明文回显，供前端行式编辑。
  expect(persistedProvider?.extraHeaders?.Authorization).toBe(plaintextAuthorization);

  // Runtime 原页标题（0.7.10 文案）。
  await page.goto("/next/settings/users");
  await expect(page.getByRole("heading", { name: "用户管理与注册设置" })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  await page.goto("/next/settings/devices");
  await expect(page.getByRole("heading", { name: "远端设备" })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  await page.goto("/next/settings/runtime");
  await expect(page.getByRole("heading", { name: "运行资源" })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/next/settings/users");
  await expect(page.getByRole("heading", { name: "用户管理与注册设置" })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  await expect(page.getByText(userName).first()).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });

  // 非管理员被 Runtime 原页重定向回个人资料，实例管理项不出现在导航里。
  await authenticate(page, user.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/next/settings/providers");
  await dismissOnboardingIfVisible(page);
  await expect(page).toHaveURL(/\/next\/settings\/profile$/, { timeout: EMBEDDED_PAGE_TIMEOUT });
  await expect(page.getByRole("heading", { name: "个人资料", level: 3 })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  await expect(page.getByText("提供商", { exact: true })).toHaveCount(0);
  await expect(page.getByText("仅管理员可配置")).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/next/settings/users");
  await expect(page).toHaveURL(/\/next\/settings\/profile$/, { timeout: EMBEDDED_PAGE_TIMEOUT });
  await expect(page.getByRole("heading", { name: "个人资料", level: 3 })).toBeVisible({ timeout: EMBEDDED_PAGE_TIMEOUT });
  await expect(page.getByText("用户管理", { exact: true })).toHaveCount(0);
});
