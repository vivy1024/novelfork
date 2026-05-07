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

test("app-next workspace completes the minimum creation, edit and candidate preview flow", async ({ page, request }) => {
  const bookTitle = `e2e-flow-${Date.now()}`;
  const bookId = buildBookId(bookTitle);

  const createResponse = await request.post("/api/books/create", {
    data: {
      title: bookTitle,
      genre: "玄幻",
      language: "zh",
      chapterWordCount: 2000,
      targetChapters: 100,
    },
  });
  expect(createResponse.status()).toBe(200);
  await waitForBookReady(request, bookId);
  const chapterResponse = await request.post(`/api/books/${bookId}/chapters`, { data: { title: "第一章 灵潮初响" } });
  expect(chapterResponse.status()).toBe(201);

  await page.goto(`/next/books/${bookId}`);
  await expect(page.getByTestId("writing-workbench-route")).toBeVisible();
  await page.getByRole("button", { name: /第一章 灵潮初响/ }).click();
  await expect(page.getByTestId("workbench-resource-header").getByRole("heading", { name: /第一章 灵潮初响/ })).toBeVisible();

  const chapterBody = "第一章正文：灵潮从城墙外涌来，主角第一次听见命运的回声。";
  const editor = page.getByLabel("章节正文");
  await expect(editor).toBeVisible();
  await editor.fill(chapterBody);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/保存状态：已保存/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /第一章 灵潮初响/ }).click();
  await expect(page.getByLabel("章节正文")).toHaveValue(chapterBody);

  await createBrowserCandidate(page, {
    bookId,
    chapterNumber: 1,
    title: "浏览器候选稿",
    content: "候选稿正文：他推门而入，风雪随之涌进。",
  });
  await page.reload();
  await page.getByRole("button", { name: /浏览器候选稿/ }).click();
  await expect(page.getByLabel("候选稿正文")).toContainText("候选稿正文");
  await expect(page.getByText("资源类型：候选稿")).toBeVisible();
});
