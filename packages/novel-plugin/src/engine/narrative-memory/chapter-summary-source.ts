/**
 * 经纬章摘要（chapter-summaries 分类，章摘要的唯一权威源）的只读取数。
 *
 * 章号存在 fields_json.chapterNumber（历史数据也有 chapter_number / 字符串数字 / 只在标题里写「第N章」）。
 * 取数口径：
 *   - 只读 confirmed + participates_in_ai 的条目（needs-review 的机器草稿不进写作上下文）；
 *   - 章号过滤与排序在 SQL 里用 json_extract 做，不再按 updated_at 粗筛：
 *     长篇里回头修过的旧章 updated_at 更新，按 updated_at 取前 N 条会把近章挤掉，
 *     修旧章时又会混进「未来」章节；
 *   - fields_json 里没有章号的老条目，退回到标题「第N章」解析，在 JS 里补过滤。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "../jingwei/category-compat.js";

export interface ChapterSummaryRow {
  readonly id: string;
  /** 条目标题（如「第25章」）。 */
  readonly title: string;
  /** fields_json.title（章节名），可能为空。 */
  readonly fieldTitle: string;
  readonly chapter: number;
  readonly summary: string;
}

export interface LoadChapterSummariesOptions {
  /** 只取 chapter < beforeChapter（写/修第 N 章时传 N）。 */
  readonly beforeChapter?: number;
  /** 只取 chapter >= minChapter。 */
  readonly minChapter?: number;
  /** 从 beforeChapter-1 往前取最多 limit 条；缺省 = 区间内全部（按章号升序返回）。 */
  readonly limit?: number;
}

interface RawRow {
  readonly id: string;
  readonly title: string;
  readonly fields_json: string | null;
}

function parseFieldsJson(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** chapterNumber 容错：数字或字符串数字均可；缺失时回退到标题「第N章」提取。 */
export function toSummaryChapterNumber(value: unknown, fallbackTitle: string): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/u.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
  }
  const titleMatch = /第\s*(\d+)\s*章/u.exec(fallbackTitle);
  return titleMatch?.[1] ? Number(titleMatch[1]) : undefined;
}

/** SQL 侧的章号表达式：fields_json.chapterNumber → chapter_number；非数字时为 NULL。 */
const CHAPTER_EXPR = `CAST(COALESCE(
  json_extract(CASE WHEN json_valid(fields_json) THEN fields_json ELSE '{}' END, '$.chapterNumber'),
  json_extract(CASE WHEN json_valid(fields_json) THEN fields_json ELSE '{}' END, '$.chapter_number')
) AS INTEGER)`;

function toRow(raw: RawRow): ChapterSummaryRow | undefined {
  const fields = parseFieldsJson(raw.fields_json);
  const chapter = toSummaryChapterNumber(fields.chapterNumber ?? fields.chapter_number, raw.title);
  const summary = typeof fields.summary === "string" ? fields.summary.trim() : "";
  // 解析不出章号或摘要为空的条目跳过，不产出半残卡片。
  if (chapter === undefined || !summary) return undefined;
  const fieldTitle = typeof fields.title === "string" ? fields.title.trim() : "";
  return { id: raw.id, title: raw.title, fieldTitle, chapter, summary };
}

/**
 * 读本书已确认的章摘要；结果按章号降序（limit 给定时）或升序（不给 limit 时）。
 * 同章多条时保留第一条（结算侧已保证每章只留一条权威摘要，这里只是兜底）。
 */
export function loadConfirmedChapterSummaries(
  storage: StorageDatabase,
  bookId: string,
  options: LoadChapterSummariesOptions = {},
): ChapterSummaryRow[] {
  const categories = getJingweiCategoryAliases("chapter-summaries");
  const clauses = [
    `book_id = ?`,
    `category IN (${sqlInPlaceholders(categories)})`,
    `deleted_at IS NULL`,
    `COALESCE(status, 'confirmed') = 'confirmed'`,
    `participates_in_ai = 1`,
  ];
  const params: unknown[] = [bookId, ...categories];
  // 有结构化章号的条目在 SQL 里按区间过滤；没有的（chapter 表达式为 NULL）一律取回，交给 JS 按标题解析。
  if (options.beforeChapter !== undefined) {
    clauses.push(`(${CHAPTER_EXPR} IS NULL OR ${CHAPTER_EXPR} < ?)`);
    params.push(options.beforeChapter);
  }
  if (options.minChapter !== undefined) {
    clauses.push(`(${CHAPTER_EXPR} IS NULL OR ${CHAPTER_EXPR} >= ?)`);
    params.push(options.minChapter);
  }
  const rawRows = storage.sqlite.prepare(`
    SELECT id, title, fields_json FROM story_jingwei_entry
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${CHAPTER_EXPR} IS NULL ASC, ${CHAPTER_EXPR} DESC, updated_at DESC, id ASC
  `).all(...params) as RawRow[];

  const seen = new Set<number>();
  const rows: ChapterSummaryRow[] = [];
  for (const raw of rawRows) {
    const row = toRow(raw);
    if (!row) continue;
    if (options.beforeChapter !== undefined && row.chapter >= options.beforeChapter) continue;
    if (options.minChapter !== undefined && row.chapter < options.minChapter) continue;
    if (seen.has(row.chapter)) continue;
    seen.add(row.chapter);
    rows.push(row);
  }
  rows.sort((a, b) => b.chapter - a.chapter || a.id.localeCompare(b.id));
  if (options.limit !== undefined) return rows.slice(0, Math.max(0, options.limit));
  return rows.reverse();
}
