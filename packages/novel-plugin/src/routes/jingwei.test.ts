import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createJingweiRouter } from "./jingwei.js";

let storage: StorageDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-jingwei-route-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-08-01T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1",
    name: "路由测试",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

function app() {
  return createJingweiRouter({ storage });
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app().request(`http://localhost/api/books/book-1/jingwei${path}`, init);
}

async function postEntry() {
  const response = await request("/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "韩立",
      contentMd: "旧正文",
      category: "characters",
      fields: { phase: "canonical" },
      customFields: { phase: "legacy" },
      priorityTier: "relevant",
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { entry: { id: string; fields: Record<string, unknown>; category: string } }).entry;
}

describe("Jingwei canonical entry routes", () => {
  it("accepts category-only creation and gives fields precedence over legacy customFields", async () => {
    const entry = await postEntry();

    expect(entry.category).toBe("characters");
    expect(entry.fields).toEqual({ phase: "canonical" });
    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string; category: string }>(`
      SELECT fields_json, custom_fields_json, category FROM story_jingwei_entry WHERE id = ?
    `).get(entry.id)!;
    expect(JSON.parse(row.fields_json)).toEqual({ phase: "canonical" });
    expect(JSON.parse(row.custom_fields_json)).toEqual({ phase: "canonical" });
    expect(row.category).toBe("characters");
  });

  it("returns final persisted data and exposes only jingwei_revision history", async () => {
    const created = await postEntry();
    const response = await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentMd: "新正文",
        category: "relationships",
        fields: { phase: "changed" },
        customFields: { phase: "ignored" },
        priorityTier: "core",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { entry: { contentMd: string; category: string; fields: Record<string, unknown>; priorityTier: string; version: number } };
    expect(payload.entry).toMatchObject({
      contentMd: "新正文",
      category: "relationships",
      fields: { phase: "changed" },
      priorityTier: "core",
      version: 2,
    });

    const historyResponse = await request(`/entries/${created.id}/revisions`);
    const history = await historyResponse.json() as { revisions: Array<{ id: string; content_md: string; snapshot?: { fields?: Record<string, unknown> } }> };
    expect(history.revisions).toHaveLength(1);
    expect(history.revisions[0]).toMatchObject({ content_md: "旧正文", snapshot: { fields: { phase: "canonical" } } });

    storage.sqlite.prepare(`UPDATE story_jingwei_entry SET revision_history = ? WHERE id = ?`).run(
      JSON.stringify([{ timestamp: "legacy", source: "user", changedFields: ["title"] }]),
      created.id,
    );
    const stillCanonical = await (await request(`/entries/${created.id}/revisions`)).json() as { revisions: unknown[] };
    expect(stillCanonical.revisions).toHaveLength(1);
  });

  it("records revisions for move and bulk mutations instead of bypassing the repository", async () => {
    const created = await postEntry();
    const moveResponse = await request(`/entries/${created.id}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: "parent-1" }),
    });
    expect(moveResponse.status).toBe(200);
    expect((await moveResponse.json() as { entry: { parentId: string } }).entry.parentId).toBe("parent-1");

    const bulkResponse = await request("/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-status", entryIds: [created.id], target: "needs-review" }),
    });
    expect(await bulkResponse.json()).toMatchObject({ ok: true, affected: 1 });

    const history = await (await request(`/entries/${created.id}/revisions`)).json() as { revisions: unknown[] };
    expect(history.revisions).toHaveLength(2);
  });

  it("reverts the complete snapshot and returns the restored entry", async () => {
    const created = await postEntry();
    await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: "新正文", category: "relationships", fields: { phase: "changed" }, priorityTier: "core" }),
    });
    const history = await (await request(`/entries/${created.id}/revisions`)).json() as { revisions: Array<{ id: string }> };

    const response = await request(`/entries/${created.id}/revert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId: history.revisions[0]!.id }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { entry: Record<string, unknown> };
    expect(payload.entry).toMatchObject({
      contentMd: "旧正文",
      category: "characters",
      fields: { phase: "canonical" },
      priorityTier: "relevant",
      version: 3,
    });
  });
});
