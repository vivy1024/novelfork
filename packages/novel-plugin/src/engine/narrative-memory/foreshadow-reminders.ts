/**
 * 休眠伏笔提醒的轮转记录：把「第 N 章提醒过」记进经纬伏笔条目 fields_json.remindedChapters（无需迁移）。
 *
 * 只动这一个系统字段：不新增修订、不改 version / updated_at / source——这是召回的副产物，
 * 不是作者或 Agent 对伏笔内容的修改，不应触发冲突检测或出现在修订历史里。
 * 轮转只看当前章之前的记录（lastRemindedBefore），所以同一章重复召回、回头修旧章都不改变挑选结果。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { appendRemindedChapter, parseForeshadowLedgerFields } from "./foreshadow-ledger.js";

export function recordHookReminders(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  entryIds: readonly string[],
): number {
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0 || entryIds.length === 0) return 0;
  let written = 0;
  try {
    const select = storage.sqlite.prepare<{ fieldsJson: string | null }>(
      `SELECT fields_json AS fieldsJson FROM story_jingwei_entry WHERE book_id = ? AND id = ? AND deleted_at IS NULL`,
    );
    const update = storage.sqlite.prepare(
      `UPDATE story_jingwei_entry SET fields_json = ?, custom_fields_json = ? WHERE book_id = ? AND id = ?`,
    );
    storage.sqlite.transaction(() => {
      for (const entryId of new Set(entryIds)) {
        const row = select.get(bookId, entryId);
        if (!row) continue;
        let fields: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(row.fieldsJson ?? "{}") as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
        } catch {
          // 字段损坏时不覆盖，交给作者修
          continue;
        }
        const current = parseForeshadowLedgerFields(fields).remindedChapters;
        const next = appendRemindedChapter(current, chapterNumber);
        if (next === current) continue;
        const json = JSON.stringify({ ...fields, remindedChapters: next });
        update.run(json, json, bookId, entryId);
        written += 1;
      }
    })();
  } catch {
    // 记录失败只影响轮转公平性，不阻断召回
    return written;
  }
  return written;
}
