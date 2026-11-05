/**
 * 删除正式章资源（写作资源 DELETE 路由 / resource.manage delete）必须走删章级联：
 * 正文归档进 chapters/_discarded 留底，该章叙事记忆与结算台账同步清理。
 * 旧实现直接 softDelete：正文被删掉、不留底，记忆和台账全部变成孤儿。
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema, insertNarrativeEvent } from "../engine/narrative-memory/storage.js";
import { chapterContentFingerprint, recordChapterSettlement } from "../engine/narrative-memory/settlement-idempotency.js";
import { NOVEL_RUNTIME_CONTRIBUTION } from "../runtime-contribution.js";
import { createWritingResourceRouter } from "./writing-resource.js";

const BOOK = "book-1";
let root: string;
let bookRoot: string;
let storage: StorageDatabase;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "novelfork-resource-delete-cascade-"));
  bookRoot = join(root, "books", BOOK);
  storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  ensureNarrativeMemorySchema(storage);
  const volume = join(bookRoot, "chapters", "卷01");
  await mkdir(volume, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: BOOK, title: "测试书" }), "utf8");
  const index = [];
  for (const number of [1, 2]) {
    const fileName = `卷01/000${number}_第${number}章.md`;
    await writeFile(join(bookRoot, "chapters", fileName), `第${number}章正文`, "utf8");
    index.push({ number, title: `第${number}章`, fileName, wordCount: 5, status: "accepted" });
    insertNarrativeEvent(storage, {
      id: `e-${number}`,
      bookId: BOOK,
      chapterNumber: number,
      eventType: "timeline_advanced",
      subject: "主角",
      predicate: "完成",
      object: `事件${number}`,
      evidenceText: `第${number}章正文`,
      confidence: 0.9,
      source: "settle",
      status: "applied",
      riskLevel: "low",
      createdAt: "2026-06-22T00:00:00.000Z",
      appliedAt: "2026-06-22T00:00:00.000Z",
    });
    recordChapterSettlement(storage, {
      bookId: BOOK,
      chapterNumber: number,
      contentFingerprint: chapterContentFingerprint(`第${number}章正文`),
      eventIds: [`e-${number}`],
      settledAt: "2026-06-22T00:00:00.000Z",
    });
  }
  await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify(index), "utf8");
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function count(sql: string, ...params: unknown[]): number {
  return storage.sqlite.prepare<{ count: number }>(sql).get(...params)?.count ?? 0;
}

async function archivedFiles(): Promise<string[]> {
  const base = join(bookRoot, "chapters", "_discarded");
  const stamps = await readdir(base).catch(() => [] as string[]);
  const files: string[] = [];
  for (const stamp of stamps) {
    for (const entry of await readdir(join(base, stamp), { recursive: true })) {
      if (String(entry).endsWith(".md")) files.push(join(base, stamp, String(entry)));
    }
  }
  return files;
}

async function expectChapterTwoDiscarded() {
  const archived = await archivedFiles();
  expect(archived).toHaveLength(1);
  expect(await readFile(archived[0]!, "utf8")).toBe("第2章正文");
  await expect(readFile(join(bookRoot, "chapters", "卷01", "0002_第2章.md"), "utf8")).rejects.toThrow();
  const index = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as Array<{ number: number }>;
  expect(index.map((entry) => entry.number)).toEqual([1]);
  expect(count(`SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ? AND chapter_number = 2`, BOOK)).toBe(0);
  expect(count(`SELECT COUNT(*) AS count FROM narrative_chapter_settlement WHERE book_id = ? AND chapter_number = 2`, BOOK)).toBe(0);
  // 第 1 章不受影响
  expect(count(`SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ? AND chapter_number = 1`, BOOK)).toBe(1);
  expect(count(`SELECT COUNT(*) AS count FROM narrative_chapter_settlement WHERE book_id = ? AND chapter_number = 1`, BOOK)).toBe(1);
}

describe("删除正式章资源走删章级联", () => {
  it("DELETE 路由：正文归档、记忆与台账清理，响应保持 { ok, resourceId }", async () => {
    const app = createWritingResourceRouter({ resolveBookDir: () => bookRoot });
    const response = await app.request(`http://localhost/api/books/${BOOK}/resources/chapter:2`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resourceId: "chapter:2" });
    await expectChapterTwoDiscarded();

    const again = await app.request(`http://localhost/api/books/${BOOK}/resources/chapter:2`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("resource.manage delete：同样归档并清理，返回 resource", async () => {
    const contribution = NOVEL_RUNTIME_CONTRIBUTION.tools?.find((candidate) => candidate.definition.name === "resource.manage");
    if (!contribution) throw new Error("resource.manage missing");
    const context: ToolExecutionContext = {
      runtimeProjectId: "runtime-1",
      projectRoot: root,
      projectType: "novel",
      enabledPluginIds: ["novelfork-novel"],
      sessionId: "session-1",
      resourceBindings: { "novel.book": { kind: "novel.book", bookId: BOOK, root: bookRoot } },
    };
    const result = await contribution.handler({ action: "delete", resourceId: "chapter:2" }, context);
    expect(result).toMatchObject({ ok: true, data: { resource: { id: "chapter:2", title: "第2章" }, cascade: { deletedEvents: 1 } } });
    await expectChapterTwoDiscarded();
  });
});
