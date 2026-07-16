import { expect, test } from "@playwright/test";

function uniqueUsername(): string {
  return `session_center_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createBoundBookNarrator(page: import("@playwright/test").Page, title: string): Promise<{ bookId: string; narratorId: string }> {
  const result = await page.evaluate(async (input) => {
    const response = await fetch("/api/novelfork/books", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `session-center-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({ title: input }),
    });
    const operation = await response.json() as { bookId?: string; narratorId?: string; state?: string };
    return { status: response.status, operation };
  }, title);
  expect([201, 202]).toContain(result.status);
  expect(result.operation.state).toBe("ready");
  expect(result.operation.bookId).toBeTruthy();
  expect(result.operation.narratorId).toBeTruthy();
  return { bookId: result.operation.bookId as string, narratorId: result.operation.narratorId as string };
}

async function createStandaloneNarrator(page: import("@playwright/test").Page, title: string): Promise<string> {
  const result = await page.evaluate(async (input) => {
    const response = await fetch("/api/narrators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterId: null, type: "primary", title: input }),
    });
    const payload = await response.json() as { id?: string };
    if (response.ok && payload.id) {
      await fetch(`/api/narrators/${encodeURIComponent(payload.id)}/title`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: input }),
      });
    }
    return { status: response.status, payload };
  }, title);
  expect(result.status).toBe(201);
  expect(result.payload.id).toBeTruthy();
  return result.payload.id as string;
}

test("隔离 Runtime 真实会话中心支持筛选、批量归档和恢复刷新", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("runtime-login-page")).toBeVisible();
  const createAccountButton = page.getByRole("button", { name: "没有账户？创建账户" });
  if (await createAccountButton.count()) await createAccountButton.click();
  await page.getByLabel("用户名").fill(uniqueUsername());
  await page.getByLabel("密码").fill("Session-center-password-123!");
  await page.getByRole("button", { name: "创建并登录" }).click();
  await expect(page.getByTestId("agent-shell-route")).toBeVisible({ timeout: 30_000 });

  const firstTitle = `隔离会话甲-${Date.now()}`;
  const secondTitle = `隔离会话乙-${Date.now()}`;
  const thirdTitle = `隔离会话丙-${Date.now()}`;
  const bookTitle = `隔离书籍-${Date.now()}`;
  await createStandaloneNarrator(page, firstTitle);
  await createStandaloneNarrator(page, secondTitle);
  await createStandaloneNarrator(page, thirdTitle);
  const boundBook = await createBoundBookNarrator(page, bookTitle);
  await page.goto("/next/sessions");

  const firstRow = page.getByTestId(/session-center-row-/).filter({ hasText: firstTitle });
  const secondRow = page.getByTestId(/session-center-row-/).filter({ hasText: secondTitle });
  const thirdRow = page.getByTestId(/session-center-row-/).filter({ hasText: thirdTitle });
  const bookRow = page.getByTestId(/session-center-row-/).filter({ hasText: bookTitle });
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await expect(secondRow).toBeVisible({ timeout: 30_000 });
  await expect(thirdRow).toBeVisible({ timeout: 30_000 });
  await expect(bookRow).toBeVisible({ timeout: 30_000 });
  await expect(bookRow.getByText("书籍叙述者·受保护")).toBeVisible();
  await expect(bookRow.getByRole("checkbox")).toHaveCount(0);
  await expect(bookRow.getByRole("button", { name: /归档|恢复|Fork|删除|重命名/ })).toHaveCount(0);
  const protectedMutation = await page.evaluate(async (narratorId) => {
    const response = await fetch(`/api/narrators/${encodeURIComponent(narratorId)}/archive`, {
      method: "PATCH",
    });
    return { status: response.status, payload: await response.json() as { code?: string } };
  }, boundBook.narratorId);
  expect(protectedMutation).toMatchObject({ status: 403, payload: { code: "BOOK_NARRATOR_PROTECTED" } });

  await page.getByLabel("叙述者来源").click();
  await page.getByRole("option", { name: "独立叙述者" }).click();
  await expect(bookRow).toBeHidden();
  await expect(firstRow).toBeVisible();
  await page.getByLabel("叙述者来源").click();
  await page.getByRole("option", { name: "全部来源" }).click();
  await page.getByLabel("叙述者排序").click();
  await page.getByRole("option", { name: "标题" }).click();
  const sortedTitles = await page.getByTestId(/session-center-row-/).evaluateAll((rows) => rows.map((row) => row.textContent ?? ""));
  expect(sortedTitles.findIndex((text) => text.includes(firstTitle))).toBeLessThan(sortedTitles.findIndex((text) => text.includes(secondTitle)));
  await page.getByLabel("叙述者排序").click();
  await page.getByRole("option", { name: "最近活动" }).click();

  await page.getByLabel("搜索叙述者").fill(firstTitle);
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeHidden();
  await page.getByLabel("搜索叙述者").fill("");

  await thirdRow.getByRole("button", { name: "归档" }).click();
  await expect(page.getByRole("dialog")).toContainText("归档叙述者？");
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByText("1 个叙述者已归档")).toBeVisible({ timeout: 30_000 });
  await expect(thirdRow).toBeHidden({ timeout: 30_000 });

  await firstRow.getByRole("checkbox", { name: `选择 ${firstTitle}` }).check();
  await secondRow.getByRole("checkbox", { name: `选择 ${secondTitle}` }).check();
  await page.getByRole("button", { name: "归档选中项" }).click();
  await expect(page.getByRole("dialog")).toContainText("批量归档叙述者？");
  await page.getByRole("button", { name: "批量归档" }).click();
  await expect(page.getByText("2 个叙述者已归档")).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("叙述者状态").click();
  await page.getByRole("option", { name: "已归档" }).click();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await expect(secondRow).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: ".test-data/session-center-browser/archived-batch.png", fullPage: true });

  await firstRow.getByRole("button", { name: "恢复" }).click();
  await page.getByRole("button", { name: "确认恢复" }).click();
  await expect(page.getByText("1 个叙述者已恢复")).toBeVisible({ timeout: 30_000 });
  await expect(firstRow).toBeHidden({ timeout: 30_000 });

  await thirdRow.getByRole("button", { name: "永久删除" }).click();
  await expect(page.getByRole("dialog")).toContainText("永久删除叙述者？");
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page.getByText("1 个叙述者已删除")).toBeVisible({ timeout: 30_000 });
  await expect(thirdRow).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "刷新叙述者列表" }).click();
  await expect(thirdRow).toBeHidden();
  await expect(secondRow).toBeVisible();
});
