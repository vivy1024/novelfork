/**
 * 章节结算新鲜度（T4.2 正文接纳）。
 *
 * 任何入口改了章节正文（写作台、Runtime 编辑器与文件回退、Agent 写工具、外部编辑器），
 * 章节对账都会把最新正文指纹写进 chapters/index.json 的 contentHash；结算台账记着结算时的指纹。
 * 两者用同一个 chapterContentFingerprint，比较即可判断记忆是否过期。
 *
 * 状态是现算的派生视图，不落盘：过期的章，其事实、事件与经纬章摘要都视为可能过期，
 * 直到重新结算。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { listChapterFiles, readChapterIndex } from "../writing-resource/chapter-layout.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "./settlement-idempotency.js";

export type ChapterSettlementFreshnessStatus = "fresh" | "stale" | "unsettled" | "unknown";

export interface ChapterSettlementFreshness {
  readonly chapterNumber: number;
  readonly title: string;
  readonly status: ChapterSettlementFreshnessStatus;
  readonly settledAt?: string;
  /** 章节索引最后一次记录的修改时间。 */
  readonly updatedAt?: string;
}

export interface BookSettlementFreshness {
  readonly chapters: readonly ChapterSettlementFreshness[];
  readonly staleChapters: readonly number[];
  readonly unsettledChapters: readonly number[];
}

// ─── 按文件的指纹缓存 ──────────────────────────────────────────────────────
//
// 每写一章都要判断全书已结算章是否过期；逐章重读正文会让开销随书长线性增长（1000 章就是每章读 1000 个文件）。
// 指纹只取决于文件内容，所以按文件的「身份戳」缓存：大小、修改时间、状态变更时间、文件号全都没变才复用。
// - 修改时间与状态变更时间都取纳秒（Windows NTFS 精度 100ns，ext4/APFS 为纳秒），不取整，同一秒内的两次写入也分得开；
// - 回退工具若把修改时间改回旧值，状态变更时间（ctime）仍会前进，照样判为变化；
// - 换文件（原子写入 rename、回退重建）文件号一般会变，也判为变化。
// 剩余风险：在同一 100ns 时间片内写入等长的不同内容且 ctime 也落在同一时间片——正常编辑不会发生。
// 作为兜底，最近 RECENT_ALWAYS_REREAD 个章号每次仍重读正文（正在写的那几章最容易被连续改动），不依赖身份戳。
// 缓存放在进程内，按书分区，最多保留 MAX_CACHED_BOOKS 本书（LRU），单本书最多 MAX_CACHED_FILES 个文件。

const RECENT_ALWAYS_REREAD = 3;
const MAX_CACHED_BOOKS = 8;
const MAX_CACHED_FILES = 20_000;

interface FileStamp {
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly ino: bigint;
}

interface CachedFingerprint {
  readonly stamp: FileStamp;
  readonly fingerprint: string;
}

const fingerprintCache = new Map<string, Map<string, CachedFingerprint>>();

function bookCache(bookRoot: string): Map<string, CachedFingerprint> {
  let cache = fingerprintCache.get(bookRoot);
  if (cache) {
    fingerprintCache.delete(bookRoot);
  } else {
    cache = new Map();
  }
  fingerprintCache.set(bookRoot, cache);
  while (fingerprintCache.size > MAX_CACHED_BOOKS) fingerprintCache.delete(fingerprintCache.keys().next().value!);
  return cache;
}

function sameStamp(left: FileStamp, right: FileStamp): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.ino === right.ino;
}

/** 测试用：清空进程内指纹缓存。 */
export function clearSettlementFreshnessCache(): void {
  fingerprintCache.clear();
}

/**
 * 读一个章节文件的正文指纹；身份戳没变时复用缓存。读不到返回 null（缺失或损坏）。
 * forceRead：不看缓存，必须读盘（最近几章兜底）。
 */
async function fileFingerprint(cache: Map<string, CachedFingerprint>, path: string, forceRead: boolean): Promise<string | null> {
  const info = await stat(path, { bigint: true }).catch(() => null);
  if (!info?.isFile()) {
    cache.delete(path);
    return null;
  }
  const stamp: FileStamp = { size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs, ino: info.ino };
  const cached = cache.get(path);
  if (!forceRead && cached && sameStamp(cached.stamp, stamp)) return cached.fingerprint;

  const content = await readFile(path, "utf8").catch(() => null);
  if (content === null) {
    cache.delete(path);
    return null;
  }
  const fingerprint = chapterContentFingerprint(content);
  // 读的过程中文件又被改了：这次结果按读到的内容算，但不缓存，下次重新读
  const after = await stat(path, { bigint: true }).catch(() => null);
  if (after && sameStamp(stamp, { size: after.size, mtimeNs: after.mtimeNs, ctimeNs: after.ctimeNs, ino: after.ino })) {
    cache.delete(path);
    if (cache.size >= MAX_CACHED_FILES) cache.clear();
    cache.set(path, { stamp, fingerprint });
  } else {
    cache.delete(path);
  }
  return fingerprint;
}

export async function readBookSettlementFreshness(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
): Promise<BookSettlementFreshness> {
  ensureSettlementLedgerSchema(storage);
  const index = await readChapterIndex(bookRoot);
  const rows = storage.sqlite
    .prepare<{ chapter_number: number; content_fingerprint: string; settled_at: string }>(
      "SELECT chapter_number, content_fingerprint, settled_at FROM narrative_chapter_settlement WHERE book_id = ?",
    )
    .all(bookId);
  const settledByChapter = new Map(rows.map((row) => [row.chapter_number, row] as const));

  // 指纹按磁盘正文现算，不信索引里的 contentHash：回退改了文件后索引仍可能是回退前的旧值（对账还没跑）。
  // 磁盘正文的指纹按文件身份戳缓存（见上），文件被动过就重读，所以回退同样能识别。
  // 按章号而非索引 fileName 找文件，使回退造成的改名或移动也能被识别；同号多份时取排序后的第一份，结果确定。
  const diskFileByNumber = new Map<number, string>();
  for (const file of await listChapterFiles(bookRoot)) {
    if (!diskFileByNumber.has(file.number)) diskFileByNumber.set(file.number, join(bookRoot, file.relativePath));
  }

  const cache = bookCache(bookRoot);
  const sorted = [...index].sort((a, b) => a.number - b.number);
  const recentNumbers = new Set(sorted.slice(-RECENT_ALWAYS_REREAD).map((entry) => entry.number));

  const chapters = await Promise.all(sorted.map(async (entry): Promise<ChapterSettlementFreshness> => {
    const settled = settledByChapter.get(entry.number);
    const base = {
      chapterNumber: entry.number,
      title: entry.title,
      ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    };
    if (!settled) return { ...base, status: "unsettled" };
    const diskPath = diskFileByNumber.get(entry.number);
    const fingerprint = diskPath ? await fileFingerprint(cache, diskPath, recentNumbers.has(entry.number)) : null;
    // 正文读不到（缺失或损坏）：如实标「未知」，不冒充新鲜或过期。
    if (fingerprint === null) {
      return { ...base, status: "unknown", settledAt: settled.settled_at };
    }
    return {
      ...base,
      status: fingerprint === settled.content_fingerprint ? "fresh" : "stale",
      settledAt: settled.settled_at,
    };
  }));

  return {
    chapters,
    staleChapters: chapters.filter((chapter) => chapter.status === "stale").map((chapter) => chapter.chapterNumber),
    unsettledChapters: chapters.filter((chapter) => chapter.status === "unsettled").map((chapter) => chapter.chapterNumber),
  };
}
