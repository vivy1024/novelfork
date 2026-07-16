import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

interface RegisteredSession {
  readonly token: string;
  readonly user: { readonly id: string; readonly username: string; readonly role: "admin" | "user" };
}

function uniqueUsername(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function register(request: APIRequestContext, username: string): Promise<RegisteredSession> {
  const response = await request.post("/api/auth/register", {
    data: { username, password: "Auth-parity-password-123!", language: "zh-CN" },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<RegisteredSession>;
}

async function clearAuthentication(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem("narrafork_token");
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith("novelfork:runtime:")) storage.removeItem(key);
      }
    }
  });
}

test("登录、注册、Passkey 提示、SSO 回调错误和登出使用真实 Runtime", async ({ page, request }) => {
  const adminName = uniqueUsername("auth_admin");
  const password = "Auth-parity-password-123!";

  await page.goto("/login");
  await expect(page.getByTestId("runtime-login-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "创建账户" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("第一个账户将自动成为管理员");

  await page.getByLabel("用户名").fill(adminName);
  await page.getByLabel("密码").fill(password);
  const registerResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/register" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建并登录" }).click();
  expect((await registerResponse).status()).toBe(201);
  await expect(page.getByTestId("runtime-login-page")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("narrafork_token")))).toBe(true);

  const firstRunSkip = page.getByRole("button", { name: "暂时跳过" });
  if (await firstRunSkip.isVisible().catch(() => false)) await firstRunSkip.click();
  const tourSkip = page.getByRole("button", { name: "跳过", exact: true });
  if (await tourSkip.isVisible().catch(() => false)) await tourSkip.click();
  const logout = page.getByRole("button", { name: "退出登录" });
  await expect(logout).toBeVisible({ timeout: 15_000 });
  await logout.click();
  await expect(page.getByTestId("runtime-login-page")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("narrafork_token"))).toBeNull();

  await page.getByLabel("用户名").fill(adminName);
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("用户名或密码不正确");

  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("runtime-login-page")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("narrafork_token")))).toBe(true);

  await clearAuthentication(page);
  await page.goto("/login?sso_error=state_expired");
  await expect(page.getByTestId("runtime-login-page")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("SSO 登录状态已过期");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole("button", { name: "隐私说明" }).click();
  await expect(page.getByRole("note")).toContainText("不记录密码");
  await page.getByRole("button", { name: "安全说明" }).click();
  await expect(page.getByRole("note")).toContainText("JWT");

  const browserSupportsPasskey = await page.evaluate(() =>
    typeof window.PublicKeyCredential !== "undefined" && Boolean(navigator.credentials),
  );
  if (browserSupportsPasskey) {
    await expect(page.getByRole("button", { name: "使用 Passkey 登录" })).toBeVisible();
  }

  const admin = await request.post("/api/auth/login", {
    data: { username: adminName, password },
  });
  expect(admin.status()).toBe(200);
  const adminSession = await admin.json() as RegisteredSession;
  const config = await request.patch("/api/admin/auth-config", {
    headers: authorization(adminSession.token),
    data: {
      oidcProviders: [{
        id: "e2e-sso",
        name: "E2E SSO",
        issuer: "https://idp.example.com",
        clientId: "e2e-client",
        clientSecret: "e2e-secret",
        scopes: ["openid", "profile", "email"],
        allowedEmailDomains: [],
        allowSignup: false,
        enabled: true,
      }],
      webauthn: {},
    },
  });
  expect(config.status()).toBe(200);

  await page.reload();
  const ssoLink = page.getByTestId("runtime-sso-provider-e2e-sso");
  await expect(ssoLink).toBeVisible();
  await expect(ssoLink).toHaveAttribute("href", "/api/auth/sso/e2e-sso/start");
});
