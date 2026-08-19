import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWritingModesRouter } from "./writing-modes.js";
import { createWritingResourceRouter } from "./writing-resource.js";
import type { RouterContext } from "./context.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "novelfork-removed-candidates-"));
  const storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/**
 * 候选稿与草稿机制已下线：正文以章节 Markdown 为唯一权威源。
 * 这些断言防止 candidate/draft 通过任何一条路径重新出现。
 */
describe("candidate and draft removal", () => {
  it("always creates formal chapters, even when the request asks for candidate or draft", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    for (const body of [
      { type: "candidate", title: "旧候选稿", content: "候选正文" },
      { type: "draft", title: "旧草稿", content: "草稿正文" },
      { title: "无类型请求", content: "默认正文" },
    ]) {
      const response = await app.request("http://localhost/api/books/book-1/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        resource: { type: "chapter", status: "accepted" },
      });
    }

    const listResponse = await app.request("http://localhost/api/books/book-1/resources");
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json() as { resources: Array<{ type: string; status: string }> };
    expect(payload.resources.length).toBeGreaterThan(0);
    expect(payload.resources.every((resource) => resource.type === "chapter")).toBe(true);
    expect(payload.resources.some((resource) => resource.status === "candidate" || resource.status === "draft")).toBe(false);
  });

  it("no longer exposes a resource transition state machine", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });
    const createResponse = await app.request("http://localhost/api/books/book-1/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "第一章", content: "正式章节" }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { resource: { id: string } };

    for (const action of ["accept", "reject", "archive", "to-draft", "to-candidate", "restore"]) {
      const response = await app.request(`http://localhost/api/books/book-1/resources/${created.resource.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, chapterNumber: 1, mode: "new" }),
      });
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: "WRITING_RESOURCE_TRANSITION_REMOVED" });
    }
  });

  it("does not expose writing-modes candidate and draft entry points", async () => {
    const ctx: RouterContext = {
      root,
      state: { bookDir: (bookId: string) => join(root, "books", bookId) } as RouterContext["state"],
      buildPipelineConfig: async () => { throw new Error("not needed"); },
    };
    const app = createWritingModesRouter(ctx);

    const createCandidate = await app.request("http://localhost/api/books/book-1/candidates/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterIntent: "旧候选", content: "正文" }),
    });
    expect(createCandidate.status).toBe(404);

    for (const target of ["candidate", "draft", "chapter-insert", "chapter-replace"]) {
      const apply = await app.request("http://localhost/api/books/book-1/writing-modes/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, content: "正文", sourceMode: "rewrite" }),
      });
      expect(apply.status).toBe(410);
      expect(await apply.json()).toMatchObject({ code: "WRITING_MODE_APPLY_REPOSITION_REQUIRED" });
    }
  });
});
