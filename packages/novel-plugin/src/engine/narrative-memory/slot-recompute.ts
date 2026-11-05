/**
 * 存量书的状态槽重算：按受控谓词重新计算 slot_key，并关闭被同槽新值取代、却仍挂着的旧值。
 *
 * 词表扩充前，「所在位置 / 本章所在位置 / 本章主要活动位置」各占一个槽，旧值从没被关闭，
 * 一个人同时有好几个「当前位置」。重算后它们落在同一个「所在」槽，这里把除最新值外的旧值关闭：
 *   - 只改 slot_key 与 valid_until_chapter（加 updated_at），不删任何行、不改内容与证据；
 *   - 旧值止于同槽下一个更晚值的起点章（与结算时 reducer 的关闭规则一致）；起点相同的取排序靠前者为当前值；
 *   - 作者手动写的值（manual）只会被更晚的手动值关闭，机器值盖不住它，保持打开并计入 skippedManual；
 *   - dryRun 只统计，不写库。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { narrativeFactSlotKey } from "./slot-key.js";
import { ensureNarrativeMemorySchema } from "./storage.js";

export interface RecomputeNarrativeStateSlotsOptions {
  readonly dryRun?: boolean;
  /** 样例条数上限（只用于展示）。 */
  readonly sampleLimit?: number;
}

export interface RecomputeNarrativeStateSlotsSample {
  readonly subject: string;
  readonly kept: string;
  readonly closed: readonly string[];
}

export interface RecomputeNarrativeStateSlotsResult {
  readonly bookId: string;
  readonly dryRun: boolean;
  /** 参与重算的事实条数（人物状态 / 位置类）。 */
  readonly scanned: number;
  /** slot_key 需要改写的条数。 */
  readonly rekeyed: number;
  /** 出现多个 open 值、被收拢的槽数。 */
  readonly collapsedSlots: number;
  /** 被关闭的旧值条数。 */
  readonly closed: number;
  /** 因作者手动值受保护而保留打开的条数。 */
  readonly skippedManual: number;
  readonly samples: readonly RecomputeNarrativeStateSlotsSample[];
}

interface FactRow {
  readonly id: string;
  readonly bookId: string;
  readonly category: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence: number;
  readonly sourceType: string;
  readonly sourceChapter: number | null;
  readonly validFrom: number | null;
  readonly validUntil: number | null;
  readonly updatedAt: string;
  readonly slotKey: string | null;
}

function startOf(row: FactRow): number {
  return row.validFrom ?? row.sourceChapter ?? -1;
}

/** 与 queryNarrativeFactSlotHeads 同序：起点章降序、置信度降序、更新时间降序、id 升序。 */
function headOrder(a: FactRow, b: FactRow): number {
  return startOf(b) - startOf(a)
    || b.confidence - a.confidence
    || b.updatedAt.localeCompare(a.updatedAt)
    || a.id.localeCompare(b.id);
}

function describe(row: FactRow): string {
  return `${row.predicate}：${row.object}`;
}

export function recomputeNarrativeStateSlots(
  storage: StorageDatabase,
  bookId: string,
  options: RecomputeNarrativeStateSlotsOptions = {},
): RecomputeNarrativeStateSlotsResult {
  ensureNarrativeMemorySchema(storage);
  const dryRun = options.dryRun === true;
  const sampleLimit = Math.max(0, options.sampleLimit ?? 10);
  const rows = storage.sqlite.prepare<FactRow>(`
    SELECT id, book_id AS bookId, category, subject, predicate, object, confidence,
           source_type AS sourceType, source_chapter AS sourceChapter,
           valid_from_chapter AS validFrom, valid_until_chapter AS validUntil,
           updated_at AS updatedAt, slot_key AS slotKey
    FROM narrative_fact
    WHERE book_id = ? AND category IN ('character_state', 'location')
  `).all(bookId);

  const rekeys: Array<{ id: string; slotKey: string }> = [];
  const openBySlot = new Map<string, FactRow[]>();
  for (const row of rows) {
    const slotKey = narrativeFactSlotKey(row);
    if (slotKey !== row.slotKey) rekeys.push({ id: row.id, slotKey });
    if (row.validUntil !== null) continue;
    const bucket = openBySlot.get(slotKey) ?? [];
    bucket.push(row);
    openBySlot.set(slotKey, bucket);
  }

  const closes: Array<{ id: string; until: number }> = [];
  const samples: RecomputeNarrativeStateSlotsSample[] = [];
  let collapsedSlots = 0;
  let skippedManual = 0;
  for (const bucket of openBySlot.values()) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort(headOrder);
    const head = ordered[0]!;
    const closedHere: FactRow[] = [];
    // ordered[i] 的接替者是排在它前面、起点不早于它的最近一条；止于接替者的起点章。
    for (let index = 1; index < ordered.length; index += 1) {
      const row = ordered[index]!;
      const successors = ordered.slice(0, index);
      const eligible = row.sourceType === "manual"
        ? successors.filter((other) => other.sourceType === "manual")
        : successors;
      if (eligible.length === 0) {
        skippedManual += 1;
        continue;
      }
      const until = Math.min(...eligible.map(startOf).filter((chapter) => chapter >= startOf(row)));
      closes.push({ id: row.id, until: Number.isFinite(until) ? Math.max(0, until) : Math.max(0, startOf(row)) });
      closedHere.push(row);
    }
    if (closedHere.length === 0) continue;
    collapsedSlots += 1;
    if (samples.length < sampleLimit) {
      samples.push({ subject: head.subject, kept: describe(head), closed: closedHere.map(describe) });
    }
  }

  if (!dryRun && (rekeys.length > 0 || closes.length > 0)) {
    const now = new Date().toISOString();
    const updateSlot = storage.sqlite.prepare(`UPDATE narrative_fact SET slot_key = ? WHERE id = ?`);
    const close = storage.sqlite.prepare(`
      UPDATE narrative_fact SET valid_until_chapter = ?, updated_at = ? WHERE id = ? AND valid_until_chapter IS NULL
    `);
    storage.sqlite.transaction(() => {
      for (const rekey of rekeys) updateSlot.run(rekey.slotKey, rekey.id);
      for (const item of closes) close.run(item.until, now, item.id);
    })();
  }

  return {
    bookId,
    dryRun,
    scanned: rows.length,
    rekeyed: rekeys.length,
    collapsedSlots,
    closed: closes.length,
    skippedManual,
    samples,
  };
}
