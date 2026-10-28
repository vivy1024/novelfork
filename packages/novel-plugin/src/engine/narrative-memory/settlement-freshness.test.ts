import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stat, utimes } from "node:fs/promises";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 包一层 readFile 计数：只统计读章节正文（.md）的次数，其余照常走真实实现
const readCounter = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const overrides = {
    readFile: (async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      if (typeof path === "string" && path.endsWith(".md")) readCounter.paths.push(path);
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof actual.readFile,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

import { chapterRelativePath, writeChapterIndex } from "../writing-resource/chapter-layout.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "./settlement-idempotency.js";
import { clearSettlementFreshnessCache, readBookSettlementFreshness } from "./settlement-freshness.js";

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
  clearSettlementFreshnessCache();
  readCounter.paths.length = 0;
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

describe("readBookSettlementFreshness 指纹缓存（长篇每章写作不再重读全书）", () => {
  const CHAPTERS = 20;
  const body = (number: number) => `第${number}章正文。${"雨".repeat(40)}`;

  async function seedSettledBook() {
    const entries = [];
    const paths = new Map<number, string>();
    for (let number = 1; number <= CHAPTERS; number += 1) {
      const relative = await writeChapterFile(number, `章${number}`, body(number));
      const fileName = relative.replace(/^chapters[\\/]/u, "");
      paths.set(number, join(bookRoot, "chapters", fileName));
      entries.push({ number, title: `章${number}`, fileName, wordCount: 40, updatedAt: "2026-10-01T00:00:00.000Z", contentHash: chapterContentFingerprint(body(number)) });
      recordSettlement(number, body(number));
    }
    await writeChapterIndex(bookRoot, entries);
    return paths;
  }

  it("首次读全部；之后只重读最近 3 章，没改的章不读", async () => {
    await seedSettledBook();
    const first = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    expect(first.staleChapters).toEqual([]);
    expect(readCounter.paths).toHaveLength(CHAPTERS);

    readCounter.paths.length = 0;
    const second = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    expect(second.chapters.every((chapter) => chapter.status === "fresh")).toBe(true);
    expect(readCounter.paths).toHaveLength(3);
    expect(readCounter.paths.every((path) => /00(18|19|20)_/u.test(path))).toBe(true);
  });

  it("改了较早的一章：只重读它（加上最近 3 章），并判为过期", async () => {
    const paths = await seedSettledBook();
    await readBookSettlementFreshness(storage, "book-1", bookRoot);

    await writeFile(paths.get(5)!, `${body(5)}改写了结尾。`, "utf8");
    readCounter.paths.length = 0;
    const freshness = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    expect(freshness.staleChapters).toEqual([5]);
    expect(readCounter.paths).toHaveLength(4);
    expect(readCounter.paths.some((path) => path.includes("0005_"))).toBe(true);
  });

  it("回退成等长内容并把修改时间改回原值，仍判为过期（状态变更时间会前进）", async () => {
    const paths = await seedSettledBook();
    const target = paths.get(2)!;
    const before = await stat(target);
    await readBookSettlementFreshness(storage, "book-1", bookRoot);

    // 等长替换：大小不变；再用 utimes 把 mtime 拨回旧值，模拟回退工具保留时间戳
    const reverted = body(2).replace("雨", "雪");
    expect(Buffer.byteLength(reverted)).toBe(Buffer.byteLength(body(2)));
    await writeFile(target, reverted, "utf8");
    await utimes(target, before.atime, before.mtime);
    const after = await stat(target);
    expect(after.size).toBe(before.size);
    // utimes 只能写到毫秒（Windows 上还会四舍五入），拨回后与原值相差不到 1ms——
    // 只看「秒级修改时间 + 大小」的缓存会被骗过
    expect(Math.abs(after.mtimeMs - before.mtimeMs)).toBeLessThan(1);
    expect(Math.floor(after.mtimeMs / 1000)).toBe(Math.floor(before.mtimeMs / 1000));

    const freshness = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    expect(freshness.staleChapters).toEqual([2]);
  });

  it("换成新文件（删掉再建、改名）也能识别；文件消失判为未知", async () => {
    const paths = await seedSettledBook();
    await readBookSettlementFreshness(storage, "book-1", bookRoot);

    await rm(paths.get(7)!);
    await writeFile(paths.get(7)!, `${body(7)}重写`, "utf8");
    await rm(paths.get(9)!);
    const freshness = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    expect(freshness.staleChapters).toEqual([7]);
    expect(freshness.chapters.find((chapter) => chapter.chapterNumber === 9)?.status).toBe("unknown");
  });

  it("结果与不带缓存的逐章重读完全一致", async () => {
    const paths = await seedSettledBook();
    await readBookSettlementFreshness(storage, "book-1", bookRoot);
    await writeFile(paths.get(3)!, "完全不同的正文", "utf8");
    await writeFile(paths.get(11)!, body(11), "utf8");
    const cached = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    clearSettlementFreshnessCache();
    const uncached = await readBookSettlementFreshness(storage, "book-1", bookRoot);
    expect(cached).toEqual(uncached);
    expect(cached.staleChapters).toEqual([3]);
  });
});
