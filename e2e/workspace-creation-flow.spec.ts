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

async function createBrowserCandidate(page: Page, input: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
}): Promise<string> {
  return await page.evaluate(async ({ bookId, chapterNumber, title, content }) => {
    const response = await fetch(`/api/books/${bookId}/writing-modes/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "candidate",
        title,
        content,
        sourceMode: "browser-e2e",
        chapterNumber,
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const json = await response.json() as { resourceId: string };
    return json.resourceId;
  }, input);
}

test("app-next workspace completes the minimum creation, candidate, health, export and CSS audit flow", async ({ page, request }) => {
  const bookTitle = `e2e-flow-${Date.now()}`;
  const bookId = buildBookId(bookTitle);

  await page.goto("/next/dashboard");

  const visualAudit = await page.evaluate(async () => {
    const audit = await import("/audits/app-next-visual-audit.js") as {
      runNovelForkAppNextVisualAudit: () => Promise<{ pass: boolean; missingUtilities: string[] }>;
    };
    return await audit.runNovelForkAppNextVisualAudit();
  });
  expect(visualAudit.pass).toBe(true);
  expect(visualAudit.missingUtilities).toEqual([]);

  const cancelImport = page.getByRole("button", { name: "取消导入" });
  if (await cancelImport.isVisible()) {
    await cancelImport.click();
  }

  await page.getByRole("button", { name: "+ 创建新书" }).click();
  await page.getByLabel("书名").fill(bookTitle);
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/books/create") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect((await createResponse).status()).toBe(200);
  await waitForBookReady(request, bookId);

  await page.goto("/next/dashboard");
  await page.getByRole("button", { name: bookTitle }).click();
  await expect(page.getByRole("heading", { name: "创作工作台" })).toBeVisible();

  await page.getByRole("button", { name: "新建章节" }).click();
  await expect(page.getByRole("heading", { name: /第 1 章/ })).toBeVisible();

  const chapterBody = "第一章正文：灵潮从城墙外涌来，主角第一次听见命运的回声。";
  const editor = page.locator("[contenteditable='true']").first();
  await expect(editor).toBeVisible();
  await editor.fill(chapterBody);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/保存状态：已保存/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /第 1 章/ }).click();
  await expect(page.locator("[contenteditable='true']").first()).toContainText(chapterBody);

  await createBrowserCandidate(page, {
    bookId,
    chapterNumber: 1,
    title: "浏览器候选稿",
    content: "候选稿正文：他推门而入，风雪随之涌进。",
  });
  await page.reload();
  await page.getByRole("button", { name: /浏览器候选稿/ }).click();
  await expect(page.getByLabel("候选稿正文")).toContainText("候选稿正文");
  await page.getByRole("button", { name: "另存为草稿" }).click();
  await expect(page.getByText("候选稿已另存为草稿")).toBeVisible();
  await page.getByRole("button", { name: /浏览器候选稿/ }).click();
  await expect(page.getByLabel("草稿正文")).toHaveValue(/候选稿正文/);

  await createBrowserCandidate(page, {
    bookId,
    chapterNumber: 1,
    title: "浏览器替换候选稿",
    content: "替换候选正文：命运回声变成了可见的银色裂缝。",
  });
  await page.reload();
  await page.getByRole("button", { name: /浏览器替换候选稿/ }).click();
  await page.getByRole("button", { name: "替换正式章节" }).click();
  await page.getByRole("button", { name: "确认替换" }).click();
  await expect(page.getByText("候选稿已替换正式章节")).toBeVisible();
  await page.getByRole("button", { name: /第 1 章/ }).click();
  await expect(page.locator("[contenteditable='true']").first()).toContainText("银色裂缝");

  await page.getByRole("button", { name: "写作工具" }).click();
  await page.getByRole("button", { name: "全书健康" }).click();
  await expect(page.getByText("全书健康仪表盘")).toBeVisible();
  await expect(page.getByText("质量评分未接入真实统计，已显示为未接入状态。" )).toBeVisible();

  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "开始导出" }).click();
  await expect(page.getByText(`${bookId}.md`)).toBeVisible();
  await expect(page.getByText(/已导出 1 章/)).toBeVisible();
});
