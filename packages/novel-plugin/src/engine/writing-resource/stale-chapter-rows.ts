/**
 * 产品库里过时的旧章节行（只读报告，不执行任何删除）。
 *
 * 章节正文的权威在书根的 chapters/ 文件；产品库 writing_resource 里 type='chapter' 的行
 * 是改为文件存储之前的旧副本。已软删除（deleted_at 非空）或已归档的行不再被任何读取路径使用，
 * 但正文仍占着库空间。这里只列出它们与大小，供作者决定是否清理；删除需另行授权执行。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

export interface StaleChapterRow {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber: number | null;
  readonly title: string;
  readonly status: string;
  readonly version: number;
  readonly contentBytes: number;
  readonly deletedAt: number | null;
  /** 为什么判为过时。 */
  readonly reason: "soft-deleted" | "archived";
}

export interface StaleChapterRowsReport {
  readonly dryRun: true;
  readonly rows: readonly StaleChapterRow[];
  readonly totalContentBytes: number;
  /** 仍在使用（未删除、未归档）的章节行数：这些不在报告范围内。 */
  readonly liveRows: number;
}

export function reportStaleChapterRows(storage: StorageDatabase, options: { readonly bookId?: string } = {}): StaleChapterRowsReport {
  const where = options.bookId ? "AND book_id = ?" : "";
  const args = options.bookId ? [options.bookId] : [];
  const rows = storage.sqlite
    .prepare<{
      id: string;
      book_id: string;
      chapter_number: number | null;
      title: string;
      status: string;
      version: number;
      content_bytes: number;
      deleted_at: number | null;
    }>(
      `SELECT id, book_id, chapter_number, title, status, version,
              length(CAST(content AS BLOB)) AS content_bytes, deleted_at
       FROM writing_resource
       WHERE type = 'chapter' AND (deleted_at IS NOT NULL OR status = 'archived') ${where}
       ORDER BY book_id, chapter_number, version`,
    )
    .all(...args)
    .map((row): StaleChapterRow => ({
      id: row.id,
      bookId: row.book_id,
      chapterNumber: row.chapter_number,
      title: row.title,
      status: row.status,
      version: row.version,
      contentBytes: Number(row.content_bytes ?? 0),
      deletedAt: row.deleted_at,
      reason: row.deleted_at !== null ? "soft-deleted" : "archived",
    }));
  const live = storage.sqlite
    .prepare<{ count: number }>(
      `SELECT COUNT(*) AS count FROM writing_resource
       WHERE type = 'chapter' AND deleted_at IS NULL AND status != 'archived' ${where}`,
    )
    .get(...args);
  return {
    dryRun: true,
    rows,
    totalContentBytes: rows.reduce((sum, row) => sum + row.contentBytes, 0),
    liveRows: live?.count ?? 0,
  };
}
