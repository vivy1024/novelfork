import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";

import { createChapterCandidatesRouter } from "./chapter-candidates";

describe("createChapterCandidatesRouter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-candidates-"));
    const storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
    runStorageMigrations(storage);
    await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "# 第一章\n\n正式正文", "utf-8");
    await writeFile(
      join(root, "books", "book-1", "chapters", "index.json"),
      JSON.stringify([{ number: 1, title: "第一章", status: "approved", wordCount: 4, auditIssueCount: 0, updatedAt: "2026-04-27T00:00:00.000Z", fileName: "0001-first.md" }], null, 2),
      "utf-8",
    );
  });

  afterEach(async () => {
    closeStorageDatabase();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("stores generated chapter candidates without touching formal chapter files", async () => {
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-04-27T12:00:00.000Z"), createId: () => "cand-1" });

    const response = await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetChapterId: "1", title: "第一章 AI 候选", content: "AI 候选正文", source: "write-next", metadata: { provider: "sub2api", model: "gpt-5.4", runId: "run-cand-1" } }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.candidate).toMatchObject({
      id: "cand-1",
      bookId: "book-1",
      targetChapterId: "1",
      title: "第一章 AI 候选",
      source: "write-next",
      status: "candidate",
      createdAt: "2026-04-27T12:00:00.000Z",
      content: "AI 候选正文",
      metadata: { provider: "sub2api", model: "gpt-5.4", runId: "run-cand-1" },
    });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "utf-8")).resolves.toBe("# 第一章\n\n正式正文");

    const listResponse = await app.request("http://localhost/api/books/book-1/candidates");
    const listPayload = await listResponse.json();
    expect(listPayload.candidates).toHaveLength(1);
    expect(listPayload.candidates[0]).toMatchObject({ id: "cand-1", status: "candidate", content: "AI 候选正文", metadata: { provider: "sub2api", model: "gpt-5.4", runId: "run-cand-1" } });
  });

  it("keeps candidate list readable even when the on-disk content file is gone", async () => {
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-04-27T12:00:00.000Z"), createId: () => "cand-1" });
    await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetChapterId: "1", title: "缺正文候选", content: "临时正文", source: "write-next" }),
    });
    await rm(join(root, "books", "book-1", "generated-candidates", "cand-1.md"), { force: true });

    // GET 触发文件→SQLite 迁移；文件缺失时正文落库为空串，列表仍可读不崩溃
    const listResponse = await app.request("http://localhost/api/books/book-1/candidates");

    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.candidates[0]).toMatchObject({
      id: "cand-1",
      title: "缺正文候选",
      status: "candidate",
      content: "",
    });
  });

  it("creates, reads, updates and reloads drafts without touching formal chapters", async () => {
    let currentNow = new Date("2026-04-27T12:00:00.000Z");
    const app = createChapterCandidatesRouter(root, { now: () => currentNow, createId: () => "manual-1" });

    const createResponse = await app.request("http://localhost/api/books/book-1/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "城门冲突片段", content: "草稿正文", metadata: { provider: "openai", model: "gpt-5.3", requestId: "req-draft-manual" } }),
    });

    // POST/PUT 返回 SQLite 原始资源（数值时间戳）；GET 返回归一化（ISO）
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).draft).toMatchObject({
      id: "draft-manual-1",
      bookId: "book-1",
      type: "draft",
      status: "draft",
      title: "城门冲突片段",
      content: "草稿正文",
      updatedAt: new Date("2026-04-27T12:00:00.000Z").getTime(),
      wordCount: 4,
    });
    // 草稿存于 SQLite，不再写入正式章节文件
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "utf-8")).resolves.toBe("# 第一章\n\n正式正文");

    const readResponse = await app.request("http://localhost/api/books/book-1/drafts/draft-manual-1");
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json()).draft).toMatchObject({ id: "draft-manual-1", content: "草稿正文", metadata: { provider: "openai", model: "gpt-5.3", requestId: "req-draft-manual" } });

    currentNow = new Date("2026-04-27T13:00:00.000Z");
    const updateResponse = await app.request("http://localhost/api/books/book-1/drafts/draft-manual-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "城门冲突修订", content: "更新后的正文" }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).draft).toMatchObject({
      id: "draft-manual-1",
      title: "城门冲突修订",
      content: "更新后的正文",
      updatedAt: new Date("2026-04-27T13:00:00.000Z").getTime(),
      wordCount: 6,
    });

    const listResponse = await app.request("http://localhost/api/books/book-1/drafts");
    expect((await listResponse.json()).drafts).toEqual([expect.objectContaining({ id: "draft-manual-1", content: "更新后的正文" })]);

    const reloadedApp = createChapterCandidatesRouter(root);
    const reloadResponse = await reloadedApp.request("http://localhost/api/books/book-1/drafts/draft-manual-1");
    expect(reloadResponse.status).toBe(200);
    expect((await reloadResponse.json()).draft).toMatchObject({ id: "draft-manual-1", title: "城门冲突修订", content: "更新后的正文" });
  });

  it("accepts a candidate as readable draft without overwriting the formal chapter", async () => {
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-04-27T12:00:00.000Z"), createId: () => "cand-1" });
    await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetChapterId: "1", title: "第一章 AI 候选", content: "AI 候选正文", source: "write-next" }),
    });
    // GET 触发文件→SQLite 迁移，使候选进入资源库（与前端先列表再操作的流程一致）
    await app.request("http://localhost/api/books/book-1/candidates");

    const acceptResponse = await app.request("http://localhost/api/books/book-1/candidates/cand-1/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "draft" }),
    });

    // accept{draft} 为原地状态迁移：同一资源 id 由 candidate→draft
    expect(acceptResponse.status).toBe(200);
    const payload = await acceptResponse.json();
    expect(payload.draft).toMatchObject({ id: "cand-1", type: "draft", status: "draft", title: "第一章 AI 候选", content: "AI 候选正文" });
    // 不写入正式章节文件
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "utf-8")).resolves.toBe("# 第一章\n\n正式正文");

    const draftResponse = await app.request("http://localhost/api/books/book-1/drafts/cand-1");
    expect(draftResponse.status).toBe(200);
    expect((await draftResponse.json()).draft).toMatchObject({ id: "cand-1", content: "AI 候选正文" });
  });

  it("can reject and archive candidates without deleting stored content", async () => {
    let n = 0;
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-04-27T12:00:00.000Z"), createId: () => `cand-${++n}` });
    await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "废稿", content: "保留内容", source: "anti-ai" }),
    });
    await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "归档稿", content: "归档内容", source: "anti-ai" }),
    });
    // GET 触发迁移，使两条候选进入资源库
    await app.request("http://localhost/api/books/book-1/candidates");

    // reject 与 archive 是 candidate 状态机的两条独立合法迁移
    const rejectResponse = await app.request("http://localhost/api/books/book-1/candidates/cand-1/reject", { method: "POST" });
    expect(rejectResponse.status).toBe(200);
    expect((await rejectResponse.json()).candidate).toMatchObject({ status: "rejected", content: "保留内容" });

    const archiveResponse = await app.request("http://localhost/api/books/book-1/candidates/cand-2/archive", { method: "POST" });
    expect(archiveResponse.status).toBe(200);
    expect((await archiveResponse.json()).candidate).toMatchObject({ status: "archived", content: "归档内容" });
  });
});
