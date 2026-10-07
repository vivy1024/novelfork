/**
 * 「全书走势」章节时间线读模型。
 *
 * 只读聚合：章节索引（chapters/index.json）是章节列表与字数的权威；
 * 经纬 chapter-summaries 类目提供章摘要；narrative_event 只数已应用（applied）的事件；
 * narrative_chapter_mention 提供出场人物；结算新鲜度沿用
 * engine/narrative-memory/settlement-freshness.ts 的现算判定（不另造权威源）。
 *
 * 容错纪律：任何一路数据缺失/损坏都只降级为空值（空数组 / 0 / null / false），
 * 绝不抛异常，让前端时间线总能拿到可渲染的骨架。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "../jingwei/category-compat.js";
import { queryChapterMentions } from "../narrative-memory/storage.js";
import { readBookSettlementFreshness } from "../narrative-memory/settlement-freshness.js";
import { readChapterIndex, type ChapterIndexRecord } from "../writing-resource/chapter-layout.js";

/** 每章时间线上直接列出的人物数；超出部分折进 moreCast。 */
export const CHAPTER_TIMELINE_CAST_LIMIT = 6;

export interface ChapterTimelineCastMember {
  readonly name: string;
  readonly entryId?: string;
}

export interface ChapterTimelineChapter {
  readonly number: number;
  readonly title: string;
  readonly volume?: string;
  readonly chars: number;
  /** 已确认摘要优先，否则待审摘要，都没有则为 null。 */
  readonly summary: string | null;
  /** 正文在结算后被改过（结算新鲜度判定为 stale）。 */
  readonly summaryStale: boolean;
  /** 本章已应用（applied）事件总数。 */
  readonly eventCount: number;
  /** 已应用的 hook_planted 数。 */
  readonly plantedHooks: number;
  /** 已应用的 hook_resolved 数。 */
  readonly recoveredHooks: number;
  readonly cast: readonly ChapterTimelineCastMember[];
  /** cast 之外还有多少人出场。 */
  readonly moreCast: number;
}

export interface BookChapterTimeline {
  readonly chapters: readonly ChapterTimelineChapter[];
  /** 结算台账里已结算到第几章；一笔结算都没有则为 null。 */
  readonly settledThrough: number | null;
}

interface ChapterSummaryRow {
  readonly title: string;
  readonly content_md: string | null;
  readonly fields_json: string | null;
  readonly status: string | null;
  readonly updated_at: number | null;
}

function parseFieldsJson(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** 去掉摘要开头的 markdown 标题行（「# 第N章摘要：…」这类结算遗留），只留正文。 */
function stripLeadingHeadings(text: string): string {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line === "" || /^#{1,6}\s/u.test(line)) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n").trim();
}

/** chapterNumber 容错：数字或字符串数字均可；缺失时回退到标题「第N章」提取。 */
function toChapterNumber(value: unknown, fallbackTitle: string): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/u.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
  }
  const titleMatch = /第\s*(\d+)\s*章/u.exec(fallbackTitle);
  return titleMatch?.[1] ? Number(titleMatch[1]) : undefined;
}

/**
 * 逐章取章摘要：已确认（status confirmed）优先于待审条目；同一状态取最新更新的一条。
 * 摘要为空串的条目视为没有摘要。
 */
function readChapterSummaries(storage: StorageDatabase, bookId: string): Map<number, string> {
  try {
    const categories = getJingweiCategoryAliases("chapter-summaries");
    const rows = storage.sqlite.prepare<ChapterSummaryRow>(
      `SELECT title, content_md, fields_json, status, updated_at
       FROM story_jingwei_entry
       WHERE book_id = ?
         AND category IN (${sqlInPlaceholders(categories)})
         AND deleted_at IS NULL`,
    ).all(bookId, ...categories);

    const picked = new Map<number, { confirmed: boolean; updatedAt: number; text: string }>();
    for (const row of rows) {
      const fields = parseFieldsJson(row.fields_json);
      const chapter = toChapterNumber(fields.chapterNumber ?? fields.chapter_number, row.title);
      if (chapter === undefined) continue;
      const fromFields = typeof fields.summary === "string" ? fields.summary.trim() : "";
      const fromContent = typeof row.content_md === "string" ? row.content_md.trim() : "";
      // 早期结算把「# 第N章摘要：标题」整段 markdown 写进了摘要，时间线只留正文。
      const text = stripLeadingHeadings(fromFields || fromContent);
      if (!text) continue;
      const candidate = {
        confirmed: (row.status ?? "confirmed") === "confirmed",
        updatedAt: typeof row.updated_at === "number" ? row.updated_at : 0,
        text,
      };
      const current = picked.get(chapter);
      if (!current
        || (candidate.confirmed && !current.confirmed)
        || (candidate.confirmed === current.confirmed && candidate.updatedAt >= current.updatedAt)) {
        picked.set(chapter, candidate);
      }
    }
    return new Map(Array.from(picked, ([chapter, value]) => [chapter, value.text]));
  } catch {
    return new Map();
  }
}

/** 已应用事件按章分组计数；只数 status = 'applied'。 */
function readAppliedEventCounts(storage: StorageDatabase, bookId: string): Map<number, { total: number; planted: number; resolved: number }> {
  const counts = new Map<number, { total: number; planted: number; resolved: number }>();
  try {
    const rows = storage.sqlite.prepare<{ chapter_number: number; event_type: string; n: number }>(
      `SELECT chapter_number, event_type, COUNT(*) AS n
       FROM narrative_event
       WHERE book_id = ? AND status = 'applied'
       GROUP BY chapter_number, event_type`,
    ).all(bookId);
    for (const row of rows) {
      const bucket = counts.get(row.chapter_number) ?? { total: 0, planted: 0, resolved: 0 };
      bucket.total += row.n;
      if (row.event_type === "hook_planted") bucket.planted += row.n;
      if (row.event_type === "hook_resolved") bucket.resolved += row.n;
      counts.set(row.chapter_number, bucket);
    }
  } catch {
    // 表还没建（从未来过结算）时按全书 0 处理。
  }
  return counts;
}

/** 章所属卷目录：索引 fileName 形如「卷01/0001_标题.md」，取目录部分；旧扁平索引没有卷。 */
function volumeOf(entry: ChapterIndexRecord): string | undefined {
  const normalized = entry.fileName.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return undefined;
  const volume = normalized.slice(0, slash).trim();
  return volume || undefined;
}

function readSettledThrough(storage: StorageDatabase, bookId: string): number | null {
  try {
    const row = storage.sqlite.prepare<{ latest: number | null }>(
      "SELECT MAX(chapter_number) AS latest FROM narrative_chapter_settlement WHERE book_id = ?",
    ).get(bookId);
    return row && typeof row.latest === "number" ? row.latest : null;
  } catch {
    return null;
  }
}

/**
 * 构建全书章节时间线。
 *
 * 章节索引与结算新鲜度都要读书籍目录（chapters/index.json 在文件系统上），
 * 因此 bookRoot 是必需参；任何一路失败时都退化为可渲染的空骨架而不是抛错。
 */
export async function buildChapterTimeline(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
): Promise<BookChapterTimeline> {
  const index = await readChapterIndex(bookRoot).catch(() => [] as ChapterIndexRecord[]);

  // 结算新鲜度本身就是「过期/未结算」的现算判定，复用同一份结果，不重复实现。
  const freshness = await readBookSettlementFreshness(storage, bookId, bookRoot)
    .catch(() => ({ chapters: [], staleChapters: [], unsettledChapters: [] }));
  const staleSet = new Set(freshness.staleChapters);

  const summaries = readChapterSummaries(storage, bookId);
  const eventCounts = readAppliedEventCounts(storage, bookId);

  const chapters = [...index]
    .sort((a, b) => a.number - b.number)
    .map((entry): ChapterTimelineChapter => {
      let cast: ChapterTimelineCastMember[] = [];
      try {
        cast = queryChapterMentions(storage, bookId, entry.number)
          .map((mention) => ({ name: mention.name, ...(mention.entryId ? { entryId: mention.entryId } : {}) }));
      } catch {
        cast = [];
      }
      const events = eventCounts.get(entry.number) ?? { total: 0, planted: 0, resolved: 0 };
      const volume = volumeOf(entry);
      return {
        number: entry.number,
        title: entry.title,
        ...(volume ? { volume } : {}),
        chars: entry.wordCount,
        summary: summaries.get(entry.number) ?? null,
        summaryStale: staleSet.has(entry.number),
        eventCount: events.total,
        plantedHooks: events.planted,
        recoveredHooks: events.resolved,
        cast: cast.slice(0, CHAPTER_TIMELINE_CAST_LIMIT),
        moreCast: Math.max(0, cast.length - CHAPTER_TIMELINE_CAST_LIMIT),
      };
    });

  return {
    chapters,
    settledThrough: readSettledThrough(storage, bookId) ?? freshness.chapters.reduce<number | null>(
      (latest, chapter) => (chapter.settledAt ? Math.max(latest ?? 0, chapter.chapterNumber) : latest),
      null,
    ),
  };
}
