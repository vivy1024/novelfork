/**
 * 机器写入与作者手改撞车时的待处理队列（T-24）。
 *
 * 语义：机器结算读条目时拿到一个版本快照，等它要写的时候作者已经手改保存过。
 * 这时机器**不覆盖**作者内容（VS Code 式：incoming change 等人裁决），
 * 把「机器本来想写什么」记到这里，并在条目上挂 conflict_status=pending，
 * 作者在经纬条目页看到冲突提示，核对后保留自己的或改用机器版。
 *
 * 为什么不留旧版本内容：条目每次写入前都有 jingwei_revision 快照，
 * 作者内容不会丢；这里只存机器那一版的差异，供核对，不参与 AI 注入。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

/** 机器写入与库里内容不一致时的冲突详情（T-24 VS Code 式处理）。 */
export interface LedgerStaleWriteInfo {
  readonly kind: "version-mismatch" | "created-after-read";
  readonly entryId: string;
  readonly category: string;
  readonly title: string;
  readonly expectedVersion: number;
  readonly currentVersion: number;
  readonly changedBy: string;
  /** 机器本次想写的字段键（字段级），不含标题/正文这类整体覆盖。 */
  readonly changedFields: readonly string[];
}

/** 待作者核对的冲突：机器读到的版本已经不是库里的版本，机器不覆盖。 */
export interface LedgerStaleWrite {
  readonly reason: string;
  readonly info: LedgerStaleWriteInfo;
}

export interface LedgerConflictRecord {
  readonly id: string;
  readonly bookId: string;
  readonly entryId: string;
  readonly category: string;
  readonly title: string;
  readonly kind: "version-mismatch" | "created-after-read";
  readonly reason: string;
  readonly changedBy: string;
  readonly changedFields: readonly string[];
  readonly expectedVersion: number;
  readonly currentVersion: number;
  readonly createdAt: number;
}

export function ensureLedgerConflictSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "jingwei_ledger_conflict" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "book_id" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "category" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL DEFAULT '',
      "kind" TEXT NOT NULL,
      "reason" TEXT NOT NULL DEFAULT '',
      "changed_by" TEXT NOT NULL DEFAULT '',
      "changed_fields_json" TEXT NOT NULL DEFAULT '[]',
      "expected_version" INTEGER NOT NULL DEFAULT 0,
      "current_version" INTEGER NOT NULL DEFAULT 0,
      "created_at" INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jingwei_ledger_conflict_book ON "jingwei_ledger_conflict" ("book_id", "created_at");
  `);
}

function rowToRecord(row: Record<string, unknown>): LedgerConflictRecord {
  let changedFields: string[] = [];
  try {
    const parsed = JSON.parse(String(row.changed_fields_json ?? "[]")) as unknown;
    if (Array.isArray(parsed)) changedFields = parsed.map((item) => String(item));
  } catch {
    changedFields = [];
  }
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    entryId: String(row.entry_id),
    category: String(row.category ?? ""),
    title: String(row.title ?? ""),
    kind: row.kind === "created-after-read" ? "created-after-read" : "version-mismatch",
    reason: String(row.reason ?? ""),
    changedBy: String(row.changed_by ?? ""),
    changedFields,
    expectedVersion: Number(row.expected_version ?? 0),
    currentVersion: Number(row.current_version ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

/** 记下「机器这一版没写进去」。同条目重复冲突只留一条，避免每次结算都堆一条。 */
export function recordLedgerConflict(
  storage: StorageDatabase,
  bookId: string,
  conflict: LedgerStaleWrite,
  now = Date.now(),
): LedgerConflictRecord {
  ensureLedgerConflictSchema(storage);
  const { info } = conflict;
  const fields = [...info.changedFields];
  const existing = storage.sqlite.prepare(`
    SELECT id FROM "jingwei_ledger_conflict" WHERE book_id = ? AND entry_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(bookId, info.entryId) as { id: string } | undefined;
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    storage.sqlite.prepare(`
      UPDATE "jingwei_ledger_conflict"
      SET category = ?, title = ?, kind = ?, reason = ?, changed_by = ?, changed_fields_json = ?,
          expected_version = ?, current_version = ?, created_at = ?
      WHERE id = ?
    `).run(info.category, info.title, info.kind, conflict.reason, info.changedBy, JSON.stringify(fields), info.expectedVersion, info.currentVersion, now, id);
  } else {
    storage.sqlite.prepare(`
      INSERT INTO "jingwei_ledger_conflict" (
        id, book_id, entry_id, category, title, kind, reason, changed_by, changed_fields_json,
        expected_version, current_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, bookId, info.entryId, info.category, info.title, info.kind, conflict.reason, info.changedBy, JSON.stringify(fields), info.expectedVersion, info.currentVersion, now);
  }
  // 条目上的冲突标记：作者在经纬条目页直接看到「存在协同修改冲突」提示。
  if (info.entryId) {
    storage.sqlite.prepare(`
      UPDATE "story_jingwei_entry"
      SET "conflict_status" = 'pending', "conflict_detail" = ?
      WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
    `).run(
      `机器（${info.changedBy}）想写入 ${fields.join("/")}，但作者在它读取之后改过这一条；机器这一版没有落库，请核对。`,
      bookId,
      info.entryId,
    );
  }
  return {
    id,
    bookId,
    entryId: info.entryId,
    category: info.category,
    title: info.title,
    kind: info.kind,
    reason: conflict.reason,
    changedBy: info.changedBy,
    changedFields: fields,
    expectedVersion: info.expectedVersion,
    currentVersion: info.currentVersion,
    createdAt: now,
  };
}

/** 某书全部待核对的机器写入冲突，新的在前。 */
export function listLedgerConflicts(storage: StorageDatabase, bookId: string): LedgerConflictRecord[] {
  ensureLedgerConflictSchema(storage);
  const rows = storage.sqlite.prepare(`
    SELECT * FROM "jingwei_ledger_conflict" WHERE book_id = ? ORDER BY created_at DESC
  `).all(bookId) as Array<Record<string, unknown>>;
  return rows.map(rowToRecord);
}
