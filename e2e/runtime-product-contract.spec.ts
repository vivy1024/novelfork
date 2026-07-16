import { expect, test } from "@playwright/test";

function uniqueUsername(): string {
  return `phase0_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test("Runtime 产品入口暴露版本化契约并隔离旧 Studio API", async ({ page }) => {
  const runtimeRequests: string[] = [];
  const consoleErrors: string[] = [];
  let bootstrapPayload: Record<string, unknown> | null = null;

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
      runtimeRequests.push(url.pathname);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/api/novelfork/bootstrap") return;
    try {
      bootstrapPayload = await response.json() as Record<string, unknown>;
    } catch {
      // The request assertion below reports a missing/invalid response.
    }
  });

  await page.goto("/login");
  await expect(page.getByTestId("runtime-login-page")).toBeVisible();
  await page.getByRole("button", { name: "没有账户？创建账户" }).click();
  await page.getByLabel("用户名").fill(uniqueUsername());
  await page.getByLabel("密码").fill("Phase0-password-123!");
  await page.getByRole("button", { name: "创建并登录" }).click();

  await expect(page.getByTestId("agent-shell-route")).toBeVisible({ timeout: 30_000 });
  expect(runtimeRequests).toContain("/api/novelfork/bootstrap");
  expect(bootstrapPayload).toMatchObject({ contractVersion: "phase-0" });
  expect(Object.values((bootstrapPayload?.features ?? {}) as Record<string, unknown>).every((value) => value === false)).toBe(true);
  expect(runtimeRequests).not.toContain("/api/sessions");
  expect(runtimeRequests).not.toContain("/api/providers");
  expect(runtimeRequests).not.toContain("/api/onboarding");
  expect(runtimeRequests.some((path) => /^\/api\/narrators\//.test(path))).toBe(false);
  expect(consoleErrors).toEqual([]);
});
