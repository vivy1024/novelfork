/**
 * 结算台账对账路由：dryRun 只报告；显式 POST 才修复。章节清单从可信书目录只读收集。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { chapterContentFingerprint, readChapterSettlementRecord, recordChapterSettlement } from "../engine/narrative-memory/settlement-idempotency.js";
import { createNarrativeMemoryRouter } from "./narrative-memory.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("POST settlement-ledger/reconcile", () => {
  it("dryRun 不写库；正式调用清掉已删章节的台账", async () => {
    const dir = join(tmpdir(), `novelfork-ledger-reconcile-route-${crypto.randomUUID()}`);
    tempDirs.push(dir);
    const bookRoot = join(dir, "book");
    await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
    await writeFile(join(bookRoot, "chapters", "卷01", "0001_开篇.md"), "第一章", "utf8");
    await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{ number: 1, title: "开篇", fileName: "卷01/0001_开篇.md" }]), "utf8");
    const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
    try {
      ensureNarrativeMemorySchema(storage);
      for (const chapter of [1, 4, 5]) {
        recordChapterSettlement(storage, { bookId: "book-1", chapterNumber: chapter, contentFingerprint: chapterContentFingerprint(`第${chapter}章`), eventIds: [], settledAt: "2026-06-22T00:00:00.000Z" });
      }
      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });

      const preview = await app.request("http://localhost/api/books/book-1/narrative-memory/settlement-ledger/reconcile?dryRun=1", { method: "POST" });
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({ ok: true, applied: false, missingChapters: [4, 5] });
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 4 })).toBeDefined();

      const stats = await app.request("http://localhost/api/books/book-1/narrative-memory/stats");
      expect((await stats.json() as { stats: { ledgerHealth: unknown } }).stats.ledgerHealth)
        .toMatchObject({ ok: false, chapterListKnown: true, missingChapters: [4, 5] });

      const applied = await app.request("http://localhost/api/books/book-1/narrative-memory/settlement-ledger/reconcile", { method: "POST" });
      expect(await applied.json()).toMatchObject({ ok: true, applied: true, missingChapters: [4, 5] });
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 4 })).toBeUndefined();
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 1 })).toBeDefined();
    } finally {
      storage.close();
    }
  });
});
