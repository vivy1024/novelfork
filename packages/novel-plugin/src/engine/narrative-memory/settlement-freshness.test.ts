import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chapterRelativePath, writeChapterIndex } from "../writing-resource/chapter-layout.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "./settlement-idempotency.js";
import { readBookSettlementFreshness } from "./settlement-freshness.js";

let storage: StorageDatabase;
let bookRoot: string;
let tempDir: string;

const settledOriginal = "雨落在旧站台上。她把信封放进外套。";
const settledThenReverted = "雨落在旧站台上。她把信封藏进了鞋底。";
const settledAndUnchanged = "天亮之前，他终于走进了那座城。";

function recordSettlement(chapterNumber: number, content: string) {
  ensureSettlementLedgerSchema(storage);
  storage.sqlite.prepare(`
    INSERT INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json)
    VALUES ('book-1', ?, ?, '2026-09-28T00:00:00.000Z', 1, '[]')
  `).run(chapterNumber, chapterContentFingerprint(content));
}

async function writeChapterFile(number: number, title: string, content: string) {
  const relativePath = chapterRelativePath("卷01", number, title);
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await writeFile(join(bookRoot, "chapters", relativePath.replace(/^chapters[\\/]/u, "")), content, "utf8");
  return relativePath;
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-settlement-freshness-${crypto.randomUUID()}`);
  bookRoot = join(tempDir, "book");
  await mkdir(bookRoot, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: "book-1", title: "回退" }), "utf8");
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("readBookSettlementFreshness after a file revert (T-20)", () => {
  it("reports a settled chapter stale when the disk body was reverted but the index still holds the old fingerprint", async () => {
    // 结算时正文为 settledOriginal；之后 Runtime 回退把磁盘正文改成 settledThenReverted。
    // 索引的 contentHash 仍是回退前的旧指纹（对账还没跑），读取新鲜度必须按磁盘重算才能判出过期。
    const fileName = await writeChapterFile(1, "雨夜", settledThenReverted);
    await writeChapterIndex(bookRoot, [{
      number: 1,
      title: "雨夜",
      fileName: fileName.replace(/^chapters[\\/]/u, ""),
      wordCount: 3200,
      updatedAt: "2026-09-28T00:00:00.000Z",
      contentHash: chapterContentFingerprint(settledOriginal),
    }]);
    recordSettlement(1, settledOriginal);

    const freshness = await readBookSettlementFreshness(storage, "book-1", bookRoot);

    expect(freshness.chapters[0]?.status).toBe("stale");
    expect(freshness.staleChapters).toEqual([1]);
  });

  it("keeps a settled chapter fresh when the disk body still matches the settled fingerprint", async () => {
    const fileName = await writeChapterFile(2, "入城", settledAndUnchanged);
    await writeChapterIndex(bookRoot, [{
      number: 2,
      title: "入城",
      fileName: fileName.replace(/^chapters[\\/]/u, ""),
      wordCount: 3560,
      updatedAt: "2026-09-29T00:00:00.000Z",
      contentHash: chapterContentFingerprint(settledAndUnchanged),
    }]);
    recordSettlement(2, settledAndUnchanged);

    const freshness = await readBookSettlementFreshness(storage, "book-1", bookRoot);

    expect(freshness.chapters[0]?.status).toBe("fresh");
    expect(freshness.staleChapters).toEqual([]);
  });

  it("reports unknown, not fresh or stale, when a settled chapter's disk body cannot be read", async () => {
    // 索引与台账都有这一章，但磁盘上没有对应正文：无法判断，必须如实标「未知」。
    await writeChapterIndex(bookRoot, [{
      number: 5,
      title: "失踪",
      fileName: chapterRelativePath("卷01", 5, "失踪").replace(/^chapters[\\/]/u, ""),
      wordCount: 1000,
      updatedAt: "2026-09-30T00:00:00.000Z",
      contentHash: chapterContentFingerprint("索引里的旧指纹"),
    }]);
    recordSettlement(5, "索引里的旧指纹");

    const freshness = await readBookSettlementFreshness(storage, "book-1", bookRoot);

    expect(freshness.chapters[0]?.status).toBe("unknown");
    expect(freshness.staleChapters).toEqual([]);
  });
});
