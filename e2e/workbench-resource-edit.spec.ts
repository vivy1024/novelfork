import { expect, test, type APIRequestContext } from "@playwright/test";

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

async function createBookWithChapter(request: APIRequestContext, title: string, initialContent: string): Promise<{ bookId: string; title: string }> {
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

  const chapterResponse = await request.post(`/api/books/${bookId}/chapters`, {
    data: { title: "第一章 灵潮初响" },
  });
  expect(chapterResponse.status()).toBe(201);

  const saveResponse = await request.put(`/api/books/${bookId}/chapters/1`, {
    data: { content: initialContent },
  });
  expect(saveResponse.status()).toBe(200);

  return { bookId, title };
}

test("/next/books resource workbench opens, edits, saves, refreshes and reads back a chapter", async ({ page, request }) => {
  const title = `e2e-workbench-${Date.now()}`;
  const initialContent = "第一章正文：灵潮从城墙外涌来，主角第一次听见命运的回声。";
  const updatedContent = `保存读回正文：${Date.now()}，银色灵潮照亮旧城墙。`;
  const { bookId } = await createBookWithChapter(request, title, initialContent);

  await page.goto(`/next/books/${bookId}`);
  await expect(page.getByTestId("writing-workbench-route")).toBeVisible();

  await page.getByRole("button", { name: /第一章 灵潮初响/ }).click();
  const editor = page.getByLabel("章节正文");
  await expect(editor).toHaveValue(initialContent);

  const canvas = page.locator(".workbench-canvas");
  await editor.fill(updatedContent);
  await expect(canvas.getByText("未保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(canvas.getByText("已保存", { exact: true })).toBeVisible();

  const apiReadback = await request.get(`/api/books/${bookId}/chapters/1`);
  expect(apiReadback.status()).toBe(200);
  await expect.poll(async () => ((await apiReadback.json()) as { content: string }).content).toBe(updatedContent);

  await page.reload();
  await expect(page.getByTestId("writing-workbench-route")).toBeVisible();
  await page.getByRole("button", { name: /第一章 灵潮初响/ }).click();
  await expect(page.getByLabel("章节正文")).toHaveValue(updatedContent);
});
