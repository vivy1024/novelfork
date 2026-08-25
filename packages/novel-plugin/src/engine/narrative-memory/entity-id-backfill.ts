/**
 * T8 · 身份链存量回填。
 *
 * C 批之后新结算的事件会在写入端归一化并挂上 subjectEntryId/objectEntryId，
 * 但存量事件（字典建立之前结算的）大多没有身份链——角色节点点击、按 ID 直查
 * 对老章节全部落空。本模块用同一份实体字典把旧事件补挂：
 * 只回填缺失列，绝不改写已有关联；解析不到的行保持原样（诚实不动）。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { buildEntityDictionary, resolveEntity, type EntityDictionary } from "./entity-dictionary.js";

export interface EntityIdBackfillResult {
  /** 扫描到的缺失事件数（subject 或 object 至少一列为空）。 */
  scanned: number;
  subjectBackfilled: number;
  objectBackfilled: number;
  /** 主客体都尝试过但字典未命中的事件数。 */
  unresolved: number;
}

interface PendingRow {
  id: string;
  subject: string;
  object: string | null;
}

function loadPendingRows(storage: StorageDatabase, bookId: string): readonly PendingRow[] {
  return storage.sqlite.prepare<{ id: string; subject: string; object: string | null }>(`
    SELECT id, subject, object
    FROM narrative_event
    WHERE book_id = ?
      AND (subject_entry_id IS NULL OR object_entry_id IS NULL)
    ORDER BY chapter_number ASC, created_at ASC
  `).all(bookId) as ReadonlyArray<PendingRow> & readonly PendingRow[];
}

function setSubjectEntryId(storage: StorageDatabase, id: string, entryId: string): void {
  storage.sqlite.prepare(
    "UPDATE narrative_event SET subject_entry_id = ? WHERE id = ?",
  ).run(entryId, id);
}

function setObjectEntryId(storage: StorageDatabase, id: string, entryId: string): void {
  storage.sqlite.prepare(
    "UPDATE narrative_event SET object_entry_id = ? WHERE id = ?",
  ).run(entryId, id);
}

/**
 * 回填一本书的存量事件身份链。幂等：已挂链的列不重扫；
 * 字典为空（书还没有实体条目）时直接返回零计数，不报错。
 */
export function backfillNarrativeEventEntityIds(storage: StorageDatabase, bookId: string): EntityIdBackfillResult {
  const dictionary: EntityDictionary = buildEntityDictionary(storage, bookId);
  if (dictionary.entries.length === 0) {
    return { scanned: 0, subjectBackfilled: 0, objectBackfilled: 0, unresolved: 0 };
  }

  const rows = loadPendingRows(storage, bookId);
  let subjectBackfilled = 0;
  let objectBackfilled = 0;
  let unresolved = 0;

  for (const row of rows) {
    const current = storage.sqlite.prepare<{ subject_entry_id: string | null; object_entry_id: string | null }>(
      "SELECT subject_entry_id, object_entry_id FROM narrative_event WHERE id = ?",
    ).get(row.id);
    // 行可能在扫描间隙被并发结算补挂——以最新值为准，只补仍缺失的列。
    const needSubject = !current?.subject_entry_id;
    const needObject = !current?.object_entry_id && typeof row.object === "string" && row.object.trim().length > 0;
    if (!needSubject && !needObject) continue;

    let anyResolved = false;
    let anyAttempted = false;

    if (needSubject) {
      anyAttempted = true;
      const hit = resolveEntity(dictionary, row.subject);
      if (hit) {
        setSubjectEntryId(storage, row.id, hit.entry.entryId);
        subjectBackfilled += 1;
        anyResolved = true;
      }
    }
    if (needObject) {
      anyAttempted = true;
      const hit = resolveEntity(dictionary, row.object as string);
      if (hit) {
        setObjectEntryId(storage, row.id, hit.entry.entryId);
        objectBackfilled += 1;
        anyResolved = true;
      }
    }

    if (anyAttempted && !anyResolved) unresolved += 1;
  }

  return { scanned: rows.length, subjectBackfilled, objectBackfilled, unresolved };
}
