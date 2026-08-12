/**
 * fts-index.ts — 经纬 bigram FTS5 索引的写入、重建与一致性自愈。
 *
 * 表结构见迁移 0028_jingwei_search_index.sql：
 * - jingwei_entry_fts：contentless FTS5（rowid = doc_id），存储 gram 化字段
 * - jingwei_fts_doc：doc_id → entry_id 映射 + entry_updated_at（一致性比对）
 *
 * 写入侧（entry-repo 的 create/update/revert/retire/softDelete）调用
 * syncEntryFts / removeEntryFts，与业务写入同一事务；
 * 检索入口先调用 ensureBookFtsFresh 做 O(扫描) 一致性检查，
 * 兜住绕过 repo 的直写（如迁移、导入、旧代码直插 SQL）。
 */
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { toGrams } from "./grams.js";

export interface FtsSyncFields {
  readonly entryId: string;
  readonly bookId: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly keywords: readonly string[];
  readonly summaryMd: string | null;
  readonly contentMd: string;
  readonly updatedAt: Date;
  /** 条目状态（confirmed | draft | needs-review），用于一致性比对 */
  readonly status: string;
}

export interface FtsCandidate {
  readonly entryId: string;
  readonly bookId: string;
  /** bm25 分（已取正，越大越相关） */
  readonly score: number;
}

const FTS_ROWID_LOOKUP = `SELECT "doc_id" FROM "jingwei_fts_doc" WHERE "entry_id" = ?`;

function gramColumns(fields: FtsSyncFields): { titleG: string; aliasG: string; tagG: string; keywordG: string; summaryG: string; contentG: string } {
  return {
    titleG: toGrams(fields.title),
    aliasG: toGrams(fields.aliases.join(" ")),
    tagG: toGrams(fields.tags.join(" ")),
    keywordG: toGrams(fields.keywords.join(" ")),
    summaryG: toGrams(fields.summaryMd ?? ""),
    contentG: toGrams(fields.contentMd),
  };
}

/** upsert 单条条目的 FTS 索引（与业务写入同一事务时调用） */
export function syncEntryFts(storage: StorageDatabase, fields: FtsSyncFields): void {
  const existing = storage.sqlite.prepare(FTS_ROWID_LOOKUP).get(fields.entryId) as { doc_id: number } | undefined;
  const grams = gramColumns(fields);
  const updatedAtMs = fields.updatedAt.getTime();

  if (existing) {
    storage.sqlite
      .prepare(`UPDATE "jingwei_entry_fts" SET "title_g" = ?, "alias_g" = ?, "tag_g" = ?, "keyword_g" = ?, "summary_g" = ?, "content_g" = ? WHERE "rowid" = ?`)
      .run(grams.titleG, grams.aliasG, grams.tagG, grams.keywordG, grams.summaryG, grams.contentG, existing.doc_id);
    storage.sqlite
      .prepare(`UPDATE "jingwei_fts_doc" SET "book_id" = ?, "indexed_at" = ?, "entry_updated_at" = ?, "entry_status" = ? WHERE "entry_id" = ?`)
      .run(fields.bookId, Date.now(), updatedAtMs, fields.status, fields.entryId);
    return;
  }

  const result = storage.sqlite
    .prepare(`INSERT INTO "jingwei_entry_fts" ("rowid", "title_g", "alias_g", "tag_g", "keyword_g", "summary_g", "content_g") VALUES (NULL, ?, ?, ?, ?, ?, ?)`)
    .run(grams.titleG, grams.aliasG, grams.tagG, grams.keywordG, grams.summaryG, grams.contentG);
  const docId = Number(result.lastInsertRowid);
  storage.sqlite
    .prepare(`INSERT INTO "jingwei_fts_doc" ("doc_id", "entry_id", "book_id", "indexed_at", "entry_updated_at", "entry_status") VALUES (?, ?, ?, ?, ?, ?)`)
    .run(docId, fields.entryId, fields.bookId, Date.now(), updatedAtMs, fields.status);
}

/**
 * 删除单条条目的 FTS 索引（retire / softDelete 时调用）
 */
export function removeEntryFts(storage: StorageDatabase, entryId: string): void {
  const row = storage.sqlite.prepare(FTS_ROWID_LOOKUP).get(entryId) as { doc_id: number } | undefined;
  if (!row) return;
  storage.sqlite.prepare(`DELETE FROM "jingwei_entry_fts" WHERE "rowid" = ?`).run(row.doc_id);
  storage.sqlite.prepare(`DELETE FROM "jingwei_fts_doc" WHERE "entry_id" = ?`).run(entryId);
}

/**
 * 全量重建某本书的 FTS 索引。
 * 事务内完成：先清空该书全部 doc，再按当前有效条目（deleted_at IS NULL）重建。
 * 不依赖 entry-repo（避免循环依赖），直接读取条目表的必要字段。
 */
export function rebuildBookFts(storage: StorageDatabase, bookId: string): number {
  const rows = storage.sqlite
    .prepare(
      `SELECT "id", "book_id", "title", "content_md", "summary_md", "aliases_json", "tags_json",
              "visibility_rule_json", "status",
              CASE
                WHEN typeof("updated_at") IN ('integer', 'real') THEN CAST("updated_at" AS INTEGER)
                ELSE CAST(ROUND(unixepoch("updated_at", 'subsec') * 1000) AS INTEGER)
              END AS "updated_at_ms"
       FROM "story_jingwei_entry"
       WHERE "book_id" = ? AND "deleted_at" IS NULL`, 
    )
    .all(bookId) as Array<{
    id: string;
    book_id: string;
    title: string;
    content_md: string;
    summary_md: string | null;
    aliases_json: string;
    tags_json: string;
    visibility_rule_json: string;
    status: string | null;
    updated_at_ms: number;
  }>;

  const run = storage.sqlite.transaction(() => {
    const docRows = storage.sqlite.prepare(`SELECT "doc_id" FROM "jingwei_fts_doc" WHERE "book_id" = ?`).all(bookId) as Array<{ doc_id: number }>;
    const removeDoc = storage.sqlite.prepare(`DELETE FROM "jingwei_entry_fts" WHERE "rowid" = ?`);
    for (const row of docRows) removeDoc.run(row.doc_id);
    storage.sqlite.prepare(`DELETE FROM "jingwei_fts_doc" WHERE "book_id" = ?`).run(bookId);

    for (const row of rows) {
      const visibility = safeJson<{ keywords?: string[] }>(row.visibility_rule_json, {});
      const fields: FtsSyncFields = {
        entryId: row.id,
        bookId: row.book_id,
        title: row.title,
        aliases: safeJson<string[]>(row.aliases_json, []),
        tags: safeJson<string[]>(row.tags_json, []),
        keywords: visibility.keywords ?? [],
        summaryMd: row.summary_md,
        contentMd: row.content_md,
        updatedAt: new Date(row.updated_at_ms),
        status: row.status ?? "confirmed",
      };
      syncEntryFts(storage, fields);
    }
  });
  run();
  return rows.length;
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * 一致性自愈：比对 jingwei_fts_doc 与 story_jingwei_entry 的
 * 行数 / 最新 updated_at，不一致则重建。返回是否触发重建。
 * 每本书每次检索前调用一次；5000 条全量重建实测约 700ms。
 */
export function ensureBookFtsFresh(storage: StorageDatabase, bookId: string): boolean {
  const dbRow = storage.sqlite
    .prepare(
      `SELECT COUNT(*) AS "count", COALESCE(MAX("entry_updated_at"), 0) AS "maxUpdatedAt" FROM "jingwei_fts_doc" WHERE "book_id" = ?`,
    )
    .get(bookId) as { count: number; maxUpdatedAt: number };
  const sourceRow = storage.sqlite
    .prepare(
      `SELECT COUNT(*) AS "count",
              COALESCE(MAX(
                CASE
                  WHEN typeof("updated_at") IN ('integer', 'real') THEN CAST("updated_at" AS INTEGER)
                  ELSE CAST(ROUND(unixepoch("updated_at", 'subsec') * 1000) AS INTEGER)
                END
              ), 0) AS "maxUpdatedAt",
              COALESCE(MAX("status"), '') AS "maxStatus"
       FROM "story_jingwei_entry" WHERE "book_id" = ? AND "deleted_at" IS NULL`,
    )
    .get(bookId) as { count: number; maxUpdatedAt: number; maxStatus: string };
  const dbStatusRow = storage.sqlite
    .prepare(`SELECT COALESCE(MAX("entry_status"), '') AS "maxStatus" FROM "jingwei_fts_doc" WHERE "book_id" = ?`)
    .get(bookId) as { maxStatus: string };

  // status 是检索可见性边界（AI 只读 confirmed），直改 status 也应触发重建，
  // 否则「仅改状态」的条目在索引与过滤层不一致。
  if (dbRow.count === sourceRow.count && dbRow.maxUpdatedAt === sourceRow.maxUpdatedAt && dbStatusRow.maxStatus === sourceRow.maxStatus) {
    return false;
  }
  rebuildBookFts(storage, bookId);
  return true;
}

/**
 * 执行 FTS MATCH 查询，返回候选（entryId + 归一化 bm25 分）。
 * expr 为空串时返回 []（调用方应走 LIKE 兜底）。
 * 字段权重：title 10 / aliases 8 / tags 6 / keywords 5 / summary 4 / content 1。
 *
 * 标题优先（titleFirst）：当某词在正文中命中面很大时（如随机文本 5000 条中
 * 近 5000 条正文都含「寒焰诀」），纯 bm25 会淹没有价值的标题/别名命中。
 * 此时先按 title_g / alias_g 列限定召回，再补全字段候选，标题命中排在前面。
 */
export function searchFtsCandidates(
  storage: StorageDatabase,
  bookId: string,
  expr: string,
  limit: number,
  titleFirst = false,
): FtsCandidate[] {
  if (expr.length === 0 || limit <= 0) return [];

  const queryAll = (ftsExpr: string, cap: number): FtsCandidate[] => {
    // book_id 过滤不能放外层 WHERE（先全表 JOIN 再 bm25 排序会到 ~700ms）；
    // 先在 FTS 子查询内 MATCH + bm25 排序 + LIMIT，再按主键 JOIN 映射表（<5ms）。
    const rows = storage.sqlite
      .prepare(
        `SELECT d."entry_id" AS entryId, x."score" AS score
         FROM (SELECT "rowid", bm25("jingwei_entry_fts", 10.0, 8.0, 6.0, 5.0, 4.0, 1.0) * -1 AS score
               FROM "jingwei_entry_fts"
               WHERE "jingwei_entry_fts" MATCH ?
               ORDER BY score DESC
               LIMIT ?) x
         JOIN "jingwei_fts_doc" d ON d."doc_id" = x."rowid"
         WHERE d."book_id" = ?
         ORDER BY x."score" DESC
         LIMIT ?`,
      )
      .all(ftsExpr, cap, bookId, cap) as Array<{ entryId: string; score: number }>;
    return rows.map((row) => ({ entryId: row.entryId, bookId, score: row.score }));
  };

  if (!titleFirst) return queryAll(expr, limit);

  // 标题/别名列限定命中（数量少但优先）：两次列查询合并
  const titleHits: Array<{ entryId: string; score: number }> = [];
  const bareExpr = expr.replace(/^"|"$/gu, "").replace(/"/gu, '""');
  for (const column of ["title_g", "alias_g"] as const) {
    try {
      titleHits.push(...queryAll(`${column}:"${bareExpr}"`, Math.max(limit * 4, 50)));
    } catch {
      // 列限定查询失败时忽略（如短语含特殊字符），继续走全字段路径
    }
  }
  if (titleHits.length === 0) {
    // 无标题/别名命中：正文命中面可能很大（随机文本下「寒焰诀」命中 2000+ 条），
    // 窗口放大到 limit×100 兜住有意义的正文命中
    return queryAll(expr, Math.max(limit * 100, 200));
  }

  // 标题命中优先：标题/别名命中 +10k 提权；正文候选只取标题命中数的 4 倍做补充
  const restLimit = Math.max(limit * 4, titleHits.length * 4);
  const rest = queryAll(expr, restLimit);
  const merged = new Map<string, FtsCandidate>();
  for (const hit of titleHits) {
    merged.set(hit.entryId, { entryId: hit.entryId, bookId, score: hit.score + 10_000 });
  }
  for (const hit of rest) {
    if (merged.has(hit.entryId)) {
      const existing = merged.get(hit.entryId)!;
      merged.set(hit.entryId, { ...existing, score: Math.max(existing.score, hit.score + 10_000) });
    } else {
      merged.set(hit.entryId, hit);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(limit, titleHits.length));
}
