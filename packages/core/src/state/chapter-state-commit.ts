import type { StorageDatabase } from "../storage/index.js";
import {
  type ChapterStateDelta,
  ChapterStateDeltaSchema,
  computeDeltaFingerprint,
} from "../models/chapter-state-delta.js";

export class RevisionConflictError extends Error {
  readonly currentRevision: number;
  readonly expectedRevision: number;
  readonly bookId: string;

  constructor(bookId: string, currentRevision: number, expectedRevision: number) {
    super(`State revision conflict for book "${bookId}": expected revision ${expectedRevision}, but current is ${currentRevision}.`);
    this.name = "RevisionConflictError";
    this.bookId = bookId;
    this.currentRevision = currentRevision;
    this.expectedRevision = expectedRevision;
  }
}

export interface ChapterStateCommitContext {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly delta: ChapterStateDelta;
  readonly fingerprint: string;
  readonly baseRevision: number;
  readonly resultingRevision: number;
  readonly deltaId: string;
  readonly committedAt: number;
}

export interface CommitChapterStateInput<TProjection = void> {
  readonly bookId: string;
  readonly delta: ChapterStateDelta;
  /** 期望的基准版本。若提供且与当前数据库版本不一致，则拒绝提交并抛出 RevisionConflictError */
  readonly expectedStateRevision?: number;
  /** 是否强制覆盖版本校验（默认 false） */
  readonly force?: boolean;
  readonly now?: () => number;
  /**
   * 在同一 SQLite 短事务中执行事件/事实/投影写入。
   * 回调抛错时，delta 记录和 state_revision 一并回滚。
   */
  readonly project?: (context: ChapterStateCommitContext) => TProjection;
}

export interface CommitChapterStateResult<TProjection = void> {
  readonly ok: true;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly baseRevision: number;
  readonly resultingRevision: number;
  readonly fingerprint: string;
  readonly idempotent: boolean;
  readonly deltaId: string;
  readonly committedAt: number;
  readonly projection?: TProjection;
}

export interface ChapterStateDeltaRecord {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly fingerprint: string;
  readonly baseRevision: number;
  readonly resultingRevision: number;
  readonly delta: ChapterStateDelta;
  readonly createdAt: number;
}

export function ensureChapterStateDeltaSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS book (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      jingwei_mode TEXT NOT NULL DEFAULT 'dynamic',
      current_chapter INTEGER NOT NULL DEFAULT 0,
      state_revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapter_state_delta (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      resulting_revision INTEGER NOT NULL,
      delta_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_state_delta_book_chapter
      ON chapter_state_delta(book_id, chapter_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_state_delta_book_fingerprint
      ON chapter_state_delta(book_id, fingerprint);
  `);
  try {
    storage.sqlite.exec(`ALTER TABLE book ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // 正式迁移或上面的 CREATE TABLE 已经带了该列。
  }
}

export function getBookStateRevision(storage: StorageDatabase, bookId: string): number {
  try {
    const row = storage.sqlite.prepare(`
      SELECT state_revision FROM book WHERE id = ?
    `).get(bookId) as { state_revision?: number } | undefined;
    return typeof row?.state_revision === "number" ? row.state_revision : 0;
  } catch {
    return 0;
  }
}

export function getChapterStateDeltaByFingerprint(
  storage: StorageDatabase,
  bookId: string,
  fingerprint: string,
): ChapterStateDeltaRecord | null {
  ensureChapterStateDeltaSchema(storage);
  const row = storage.sqlite.prepare(`
    SELECT id, book_id, chapter_number, fingerprint, base_revision, resulting_revision, delta_json, created_at
    FROM chapter_state_delta
    WHERE book_id = ? AND fingerprint = ?
  `).get(bookId, fingerprint) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    chapterNumber: Number(row.chapter_number),
    fingerprint: String(row.fingerprint),
    baseRevision: Number(row.base_revision),
    resultingRevision: Number(row.resulting_revision),
    delta: JSON.parse(String(row.delta_json)) as ChapterStateDelta,
    createdAt: Number(row.created_at),
  };
}

export function listChapterStateDeltas(
  storage: StorageDatabase,
  bookId: string,
  options: { readonly chapterNumber?: number; readonly limit?: number } = {},
): ChapterStateDeltaRecord[] {
  ensureChapterStateDeltaSchema(storage);
  let sql = `
    SELECT id, book_id, chapter_number, fingerprint, base_revision, resulting_revision, delta_json, created_at
    FROM chapter_state_delta
    WHERE book_id = ?
  `;
  const params: unknown[] = [bookId];
  if (typeof options.chapterNumber === "number") {
    sql += ` AND chapter_number = ?`;
    params.push(options.chapterNumber);
  }
  sql += ` ORDER BY resulting_revision ASC`;
  if (typeof options.limit === "number") {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }

  const rows = storage.sqlite.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    bookId: String(row.book_id),
    chapterNumber: Number(row.chapter_number),
    fingerprint: String(row.fingerprint),
    baseRevision: Number(row.base_revision),
    resultingRevision: Number(row.resulting_revision),
    delta: JSON.parse(String(row.delta_json)) as ChapterStateDelta,
    createdAt: Number(row.created_at),
  }));
}

function applyChapterStateCommit<TProjection>(
  storage: StorageDatabase,
  input: CommitChapterStateInput<TProjection>,
  delta: ChapterStateDelta,
  fingerprint: string,
  now: number,
): CommitChapterStateResult<TProjection> {
  const bookId = String(input.bookId).trim();
  const existing = getChapterStateDeltaByFingerprint(storage, bookId, fingerprint);
  if (existing) {
    return {
      ok: true,
      bookId,
      chapterNumber: existing.chapterNumber,
      baseRevision: existing.baseRevision,
      resultingRevision: existing.resultingRevision,
      fingerprint: existing.fingerprint,
      idempotent: true,
      deltaId: existing.id,
      committedAt: existing.createdAt,
    };
  }

  let bookRow = storage.sqlite.prepare(`
    SELECT id, state_revision FROM book WHERE id = ?
  `).get(bookId) as { id: string; state_revision?: number } | undefined;

  if (!bookRow) {
    storage.sqlite.prepare(`
      INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at)
      VALUES (?, ?, 'dynamic', 0, ?, ?)
    `).run(bookId, bookId, now, now);
    bookRow = { id: bookId, state_revision: 0 };
  }

  const currentRevision = typeof bookRow.state_revision === "number" ? bookRow.state_revision : 0;

  if (
    !input.force
    && typeof input.expectedStateRevision === "number"
    && currentRevision !== input.expectedStateRevision
  ) {
    throw new RevisionConflictError(bookId, currentRevision, input.expectedStateRevision);
  }

  const nextRevision = currentRevision + 1;
  const deltaId = crypto.randomUUID();

  storage.sqlite.prepare(`
    INSERT INTO chapter_state_delta (
      id, book_id, chapter_number, fingerprint, base_revision, resulting_revision, delta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deltaId,
    bookId,
    delta.chapterNumber,
    fingerprint,
    currentRevision,
    nextRevision,
    JSON.stringify(delta),
    now,
  );

  storage.sqlite.prepare(`
    UPDATE book SET state_revision = ?, updated_at = ? WHERE id = ?
  `).run(nextRevision, now, bookId);

  const projection = input.project?.({
    storage,
    bookId,
    delta,
    fingerprint,
    baseRevision: currentRevision,
    resultingRevision: nextRevision,
    deltaId,
    committedAt: now,
  });

  return {
    ok: true,
    bookId,
    chapterNumber: delta.chapterNumber,
    baseRevision: currentRevision,
    resultingRevision: nextRevision,
    fingerprint,
    idempotent: false,
    deltaId,
    committedAt: now,
    ...(projection === undefined ? {} : { projection }),
  };
}

/**
 * 单次状态提交原子入口（P1a）。
 * 在单次 SQLite 事务中完成：
 * 1. 内容指纹幂等拦截（相同 delta 直接返回已提交版本）
 * 2. expectedStateRevision CAS 版本并发校验（不匹配抛 409 冲突）
 * 3. 写入 chapter_state_delta 记录
 * 4. 递增并更新 book.state_revision
 * 5. 可选投影回调与 delta 同事务提交，出错全部回滚
 */
export function commitChapterStateDelta<TProjection = void>(
  storage: StorageDatabase,
  input: CommitChapterStateInput<TProjection>,
): CommitChapterStateResult<TProjection> {
  const bookId = String(input.bookId).trim();
  if (!bookId) throw new Error("bookId cannot be empty");

  const delta = ChapterStateDeltaSchema.parse(input.delta);
  const fingerprint = computeDeltaFingerprint(delta);
  const now = input.now ? input.now() : Date.now();

  ensureChapterStateDeltaSchema(storage);

  const executeCommit = storage.sqlite.transaction(() => (
    applyChapterStateCommit(storage, { ...input, bookId }, delta, fingerprint, now)
  ));

  return executeCommit();
}
