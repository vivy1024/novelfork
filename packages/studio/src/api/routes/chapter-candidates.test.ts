import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createChapterCandidatesRouter } from "./chapter-candidates";

describe("createChapterCandidatesRouter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-candidates-"));
    await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "# 第一章\n\n正式正文", "utf-8");
    await writeFile(
      join(root, "books", "book-1", "chapters", "index.json"),
      JSON.stringify([{ number: 1, title: "第一章", status: "approved", wordCount: 4, auditIssueCount: 0, updatedAt: "2026-04-27T00:00:00.000Z", fileName: "0001-first.md" }], null, 2),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
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

  it("keeps candidate list readable and marks candidates when stored content is missing", async () => {
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-04-27T12:00:00.000Z"), createId: () => "cand-1" });
    await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetChapterId: "1", title: "缺正文候选", content: "临时正文", source: "write-next" }),
    });
    await rm(join(root, "books", "book-1", "generated-candidates", "cand-1.md"), { force: true });

    const listResponse = await app.request("http://localhost/api/books/book-1/candidates");

    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.candidates[0]).toMatchObject({
      id: "cand-1",
      title: "缺正文候选",
      content: null,
      contentError: "候选稿正文缺失：cand-1.md",
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

    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).draft).toMatchObject({
      id: "draft-manual-1",
      bookId: "book-1",
      title: "城门冲突片段",
      content: "草稿正文",
      updatedAt: "2026-04-27T12:00:00.000Z",
      wordCount: 4,
    });
    await expect(readFile(join(root, "books", "book-1", "drafts", "draft-manual-1.md"), "utf-8")).resolves.toBe("草稿正文");
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
      updatedAt: "2026-04-27T13:00:00.000Z",
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

    const acceptResponse = await app.request("http://localhost/api/books/book-1/candidates/cand-1/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "draft" }),
    });

    expect(acceptResponse.status).toBe(200);
    const payload = await acceptResponse.json();
    expect(payload.candidate).toMatchObject({ id: "cand-1", status: "accepted" });
    expect(payload.draft).toMatchObject({ id: "draft-cand-1", title: "第一章 AI 候选", sourceCandidateId: "cand-1", content: "AI 候选正文" });
    await expect(readFile(join(root, "books", "book-1", "drafts", "draft-cand-1.md"), "utf-8")).resolves.toBe("AI 候选正文");
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "utf-8")).resolves.toBe("# 第一章\n\n正式正文");

    const draftResponse = await app.request("http://localhost/api/books/book-1/drafts/draft-cand-1");
    expect(draftResponse.status).toBe(200);
    expect((await draftResponse.json()).draft).toMatchObject({ id: "draft-cand-1", content: "AI 候选正文" });
  });

  it("can reject and archive candidates without deleting stored content", async () => {
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-04-27T12:00:00.000Z"), createId: () => "cand-1" });
    await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "废稿", content: "保留内容", source: "anti-ai" }),
    });

    const rejectResponse = await app.request("http://localhost/api/books/book-1/candidates/cand-1/reject", { method: "POST" });
    expect(rejectResponse.status).toBe(200);
    expect((await rejectResponse.json()).candidate).toMatchObject({ status: "rejected" });

    const archiveResponse = await app.request("http://localhost/api/books/book-1/candidates/cand-1/archive", { method: "POST" });
    expect(archiveResponse.status).toBe(200);
    expect((await archiveResponse.json()).candidate).toMatchObject({ status: "archived", content: "保留内容" });
  });
});
