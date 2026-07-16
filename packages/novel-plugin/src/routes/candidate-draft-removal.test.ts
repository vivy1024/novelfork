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

describe("writing-resource compatibility", () => {
  it("creates and lists candidate and draft resources through the unified domain route", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    for (const body of [
      { type: "candidate", title: "候选稿", content: "候选正文" },
      { type: "draft", title: "草稿", content: "草稿正文" },
    ]) {
      const response = await app.request("http://localhost/api/books/book-1/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
    }

    const listResponse = await app.request("http://localhost/api/books/book-1/resources");
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json() as { resources: Array<{ type: string; title: string }> };
    expect(payload.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "candidate", title: "候选稿" }),
      expect.objectContaining({ type: "draft", title: "草稿" }),
    ]));
  });

  it("accepts a candidate through the restored transition route", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });
    const createResponse = await app.request("http://localhost/api/books/book-1/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "candidate", title: "第一章候选", content: "正式章节" }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { resource: { id: string } };

    const transitionResponse = await app.request(`http://localhost/api/books/book-1/resources/${created.resource.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", chapterNumber: 1, mode: "new" }),
    });

    expect(transitionResponse.status).toBe(200);
    expect(await transitionResponse.json()).toMatchObject({
      resource: { type: "chapter", status: "accepted", chapterNumber: 1 },
    });
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
