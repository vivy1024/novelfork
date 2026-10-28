/**
 * 长篇规模基准：已结算 N 章（每章约 3000 字）的书上，readBookSettlementFreshness 首次与后续调用的耗时与读盘次数。
 *
 * 默认跳过；需要时：
 *   NOVELFORK_BENCH=1 pnpm --filter @vivy1024/novelfork-novel-plugin exec vitest run src/engine/narrative-memory/settlement-freshness.bench.test.ts
 * 数据写在临时目录，跑完删除。
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chapterRelativePath, listChapterFiles, readChapterIndex, writeChapterIndex } from "../writing-resource/chapter-layout.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "./settlement-idempotency.js";
import { clearSettlementFreshnessCache, readBookSettlementFreshness } from "./settlement-freshness.js";

const SIZES = [500, 1000];
const CHAPTER_CHARS = 3000;

describe.skipIf(!process.env.NOVELFORK_BENCH)("结算新鲜度基准", () => {
  let tempDir: string;
  let storage: StorageDatabase;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `novelfork-freshness-bench-${crypto.randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
    ensureSettlementLedgerSchema(storage);
  });

  afterAll(async () => {
    storage?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  for (const chapters of SIZES) {
    it(`${chapters} 章`, async () => {
      const bookId = `bench-${chapters}`;
      const bookRoot = join(tempDir, bookId);
      await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
      const insert = storage.sqlite.prepare(`
        INSERT INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json)
        VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 1, '[]')
      `);
      const entries = [];
      for (let number = 1; number <= chapters; number += 1) {
        const content = `第${number}章\n${"山雨欲来风满楼。".repeat(CHAPTER_CHARS / 8)}`;
        const relative = chapterRelativePath("卷01", number, `章${number}`);
        await writeFile(join(bookRoot, "chapters", relative), content, "utf8");
        entries.push({ number, title: `章${number}`, fileName: relative, wordCount: CHAPTER_CHARS, updatedAt: "2026-10-01T00:00:00.000Z" });
        insert.run(bookId, number, chapterContentFingerprint(content));
      }
      await writeChapterIndex(bookRoot, entries);

      // 改前实现（逐章读全文算指纹）的等价开销：读索引 + 扫目录 + 全部正文读一遍
      const legacySamples: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const start = performance.now();
        await readChapterIndex(bookRoot);
        const listed = await listChapterFiles(bookRoot);
        await Promise.all(listed.map(async (file) => chapterContentFingerprint(await readFile(join(bookRoot, file.relativePath), "utf8"))));
        legacySamples.push(performance.now() - start);
      }
      legacySamples.sort((a, b) => a - b);
      console.log(`[freshness legacy] ${JSON.stringify({ chapters, legacyMedianMs: Number(legacySamples[1]!.toFixed(1)) })}`);

      clearSettlementFreshnessCache();
      const coldStart = performance.now();
      const cold = await readBookSettlementFreshness(storage, bookId, bookRoot);
      const coldMs = performance.now() - coldStart;
      expect(cold.staleChapters).toEqual([]);

      const warmSamples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const start = performance.now();
        const warm = await readBookSettlementFreshness(storage, bookId, bookRoot);
        warmSamples.push(performance.now() - start);
        expect(warm).toEqual(cold);
      }
      warmSamples.sort((a, b) => a - b);

      // 分阶段：读索引、扫章节目录、逐文件 stat、逐文件读正文并算指纹（即旧实现每次都要做的事）
      const phase = async (fn: () => Promise<unknown>) => {
        const start = performance.now();
        await fn();
        return Number((performance.now() - start).toFixed(1));
      };
      const files = await listChapterFiles(bookRoot);
      const phases = {
        readIndexMs: await phase(() => readChapterIndex(bookRoot)),
        listFilesMs: await phase(() => listChapterFiles(bookRoot)),
        statAllMs: await phase(() => Promise.all(files.map((file) => stat(join(bookRoot, file.relativePath), { bigint: true })))),
        readAndHashAllMs: await phase(() => Promise.all(files.map(async (file) => chapterContentFingerprint(await readFile(join(bookRoot, file.relativePath), "utf8"))))),
      };
      console.log(`[freshness phases] ${JSON.stringify({ chapters, ...phases })}`);
      console.log(`[freshness bench] ${JSON.stringify({ chapters, coldMs: Number(coldMs.toFixed(1)), warmMedianMs: Number(warmSamples[2]!.toFixed(1)) })}`);
    }, 300_000);
  }
});
