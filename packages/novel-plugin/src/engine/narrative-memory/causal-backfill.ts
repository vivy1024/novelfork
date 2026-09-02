/**
 * 存量显式因果回填。
 *
 * 新结算会把伏笔链写成 narrative_event.caused_by_json；旧库只有列、没有值。
 * 本模块按书扫描 hook 事件，用 inferHookCausalLinks 补前驱：
 * 只填空列，不覆盖已有 caused_by_json；对不上就跳过。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { inferHookCausalLinks, type CausalEventRef } from "./causal-resolve.js";
import { ensureNarrativeMemorySchema } from "./storage.js";

export interface CausalBackfillResult {
  readonly scanned: number;
  readonly linked: number;
  readonly skippedExisting: number;
}

interface HookEventRow {
  id: string;
  chapterNumber: number;
  eventType: string;
  subject: string;
  predicate: string;
  object: string;
  evidenceText: string;
  causedByJson: string | null;
}

const HOOK_TYPES = ["hook_planted", "hook_progressed", "hook_triggered", "hook_resolved"] as const;

export function backfillHookCausalLinks(storage: StorageDatabase, bookId: string): CausalBackfillResult {
  ensureNarrativeMemorySchema(storage);
  const rows = storage.sqlite.prepare<HookEventRow>(`
    SELECT
      id,
      chapter_number AS chapterNumber,
      event_type AS eventType,
      subject,
      predicate,
      object,
      evidence_text AS evidenceText,
      caused_by_json AS causedByJson
    FROM narrative_event
    WHERE book_id = ?
      AND event_type IN (?, ?, ?, ?)
    ORDER BY chapter_number ASC, created_at ASC, id ASC
  `).all(bookId, ...HOOK_TYPES);

  const refs: CausalEventRef[] = rows.map((row) => ({
    id: row.id,
    chapterNumber: row.chapterNumber,
    eventType: row.eventType,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    evidenceText: row.evidenceText,
  }));
  const links = inferHookCausalLinks(refs);
  const update = storage.sqlite.prepare(`
    UPDATE narrative_event
    SET caused_by_json = ?
    WHERE id = ? AND book_id = ? AND (caused_by_json IS NULL OR TRIM(caused_by_json) = '')
  `);

  let linked = 0;
  let skippedExisting = 0;
  const persist = storage.sqlite.transaction(() => {
    for (const row of rows) {
      const causes = links.get(row.id);
      if (!causes || causes.length === 0) continue;
      if (row.causedByJson && row.causedByJson.trim()) {
        skippedExisting += 1;
        continue;
      }
      const result = update.run(JSON.stringify(causes), row.id, bookId);
      if (result.changes > 0) linked += 1;
    }
  });
  persist();

  return { scanned: rows.length, linked, skippedExisting };
}
