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

describe("candidate/draft primary entry removal", () => {
  it("treats candidate or draft payloads as invalid writing-resource input", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    for (const body of [
      { type: "candidate", title: "旧候选稿", content: "正文" },
      { type: "draft", title: "旧草稿", content: "正文" },
      { type: "chapter", status: "candidate", title: "旧状态", content: "正文" },
    ]) {
      const response = await app.request("http://localhost/api/books/book-1/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("formal chapter") });
    }
  });

  it("does not expose writing-resource transition routes", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });
    const createResponse = await app.request("http://localhost/api/books/book-1/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "chapter", title: "第一章", content: "正式章节" }),
    });
    expect(createResponse.status).toBe(201);

    const transitionResponse = await app.request("http://localhost/api/books/book-1/resources/chapter:1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", chapterNumber: 1 }),
    });

    expect(transitionResponse.status).toBe(404);
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
      expect(apply.status).toBe(404);
    }
  });
});
