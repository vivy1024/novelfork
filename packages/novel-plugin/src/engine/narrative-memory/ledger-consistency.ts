/**
 * 结算台账与记忆删除的一致性。
 *
 * 事故背景：叙述者用 memory.bulk_delete 按章范围物理删除事件、用 resource.manage 删章后，
 * 结算台账仍把这些章记成「已结算」，event_ids_json 里的事件早已不存在；幂等门照旧跳过，
 * 这几章再也无法重新结算，章节提及、证据链、检索日志等按章派生的行也成了孤儿。
 *
 * 这里收拢三件事：
 * 1. 管理层删除事件时走回收站（可撤销），同一事务里把被删 id 从台账里剔除；
 *    某章台账原本有事件、剔除后一条不剩，就把台账标成失效，让这章可以重新结算。
 * 2. 失效标记的读写：不加列，复用 content_fingerprint，写成 `stale:<原因>:<原指纹>`。
 *    任何真实正文的指纹都是 64 位十六进制，不可能以 `stale:` 开头，因此失效台账必然走「重新结算」，
 *    而且保留了结算次数和原指纹，结算新鲜度视图也会把它显示成「需要重新结算」。
 * 3. 整本对账（reconcileSettlementLedger）：清掉已不存在章节的按章派生行，
 *    把引用的事件全部消失的台账标成失效。只在显式调用时写库；memory.stats 只用 dryRun 报告。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { refreshNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { listChapterFiles } from "../writing-resource/chapter-layout.js";
import {
  loadSurvivingEventIds,
  ensureSettlementLedgerSchema,
  parseStaleLedgerFingerprint,
  staleLedgerFingerprint,
} from "./settlement-idempotency.js";
import { ensureNarrativeMemorySchema, pruneNarrativeEventTrash } from "./storage.js";

interface LedgerRow {
  chapterNumber: number;
  contentFingerprint: string;
  eventIdsJson: string;
}

function parseIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function readLedgerRows(storage: StorageDatabase, bookId: string): LedgerRow[] {
  return storage.sqlite.prepare<LedgerRow>(`
    SELECT chapter_number AS chapterNumber, content_fingerprint AS contentFingerprint, event_ids_json AS eventIdsJson
    FROM narrative_chapter_settlement
    WHERE book_id = ?
    ORDER BY chapter_number ASC
  `).all(bookId);
}

export interface LedgerPruneResult {
  /** event_ids_json 被改写的台账章号。 */
  readonly prunedChapters: readonly number[];
  /** 剔除后一条事件不剩、已标成失效的台账章号。 */
  readonly staleChapters: readonly number[];
}

/**
 * 把被删事件 id 从台账里剔除。必须在调用方的事务里执行，与删除本身同进同退。
 * 原本就没有事件的台账（抽取为空的章）不受影响：它们没有被删的东西，保持「已结算」。
 */
export function pruneLedgerEventIds(
  storage: StorageDatabase,
  bookId: string,
  removedEventIds: readonly string[],
): LedgerPruneResult {
  ensureSettlementLedgerSchema(storage);
  if (removedEventIds.length === 0) return { prunedChapters: [], staleChapters: [] };
  const removed = new Set(removedEventIds);
  const update = storage.sqlite.prepare(`
    UPDATE narrative_chapter_settlement
    SET event_ids_json = ?, content_fingerprint = ?
    WHERE book_id = ? AND chapter_number = ?
  `);
  const prunedChapters: number[] = [];
  const staleChapters: number[] = [];
  for (const row of readLedgerRows(storage, bookId)) {
    const ids = parseIds(row.eventIdsJson);
    const kept = ids.filter((id) => !removed.has(id));
    if (kept.length === ids.length) continue;
    const stale = kept.length === 0;
    update.run(
      JSON.stringify(kept),
      stale ? staleLedgerFingerprint("ledger-orphaned", row.contentFingerprint) : row.contentFingerprint,
      bookId,
      row.chapterNumber,
    );
    prunedChapters.push(row.chapterNumber);
    if (stale) staleChapters.push(row.chapterNumber);
  }
  return { prunedChapters, staleChapters };
}

export interface DeleteNarrativeMemoryEntriesInput {
  readonly bookId: string;
  readonly kind: "fact" | "event";
  readonly ids: readonly string[];
  readonly reason: string;
  readonly now?: string;
}

export interface DeleteNarrativeMemoryEntriesResult {
  readonly deleted: readonly string[];
  readonly failed: ReadonlyArray<{ readonly id: string; readonly error: string }>;
  /** 事件进了回收站（可撤销）；事实没有回收站，物理删除。 */
  readonly trashed: boolean;
  readonly ledger: LedgerPruneResult;
  readonly affectedChapters: readonly number[];
  readonly entityIndexRefreshed: boolean;
  readonly warnings: readonly string[];
}

/**
 * memory.delete / memory.bulk_delete 的唯一写路径。
 * - 整批一个事务：任何一条失败（SQL 异常）整体回滚，不留半删状态；
 * - 事件整行搬进 narrative_event_trash（与待确认队列「丢弃」同一张回收站，任何状态都收），可撤销；
 * - 事实没有回收站，按原语义物理删除，但同样在事务里；
 * - 同事务剔除台账里的被删事件 id，空了就标失效；
 * - 提交后刷新实体索引（状态流水 / 关系边 / 参与者由事件派生）。刷新失败不回滚删除，只记 warning。
 */
export function deleteNarrativeMemoryEntries(
  storage: StorageDatabase,
  input: DeleteNarrativeMemoryEntriesInput,
): DeleteNarrativeMemoryEntriesResult {
  ensureNarrativeMemorySchema(storage);
  ensureSettlementLedgerSchema(storage);
  const deletedAt = input.now ?? new Date().toISOString();
  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const chapters = new Set<number>();
  let ledger: LedgerPruneResult = { prunedChapters: [], staleChapters: [] };

  const run = storage.sqlite.transaction(() => {
    if (input.kind === "event") {
      pruneNarrativeEventTrash(storage, deletedAt);
      const select = storage.sqlite.prepare<{ chapterNumber: number }>(
        `SELECT chapter_number AS chapterNumber FROM narrative_event WHERE book_id = ? AND id = ?`,
      );
      // 回收站里若已有同 id 的旧记录（之前丢弃过、后来又重新结算出同 id），以本次删除为准覆盖。
      const clearTrash = storage.sqlite.prepare(`DELETE FROM narrative_event_trash WHERE book_id = ? AND id = ?`);
      const insertTrash = storage.sqlite.prepare(`
        INSERT INTO narrative_event_trash (
          id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text, confidence,
          source, status, risk_level, subject_entry_id, object_entry_id, caused_by_json, created_at, applied_at,
          deleted_at, deleted_reason
        )
        SELECT
          id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text, confidence,
          source, status, risk_level, subject_entry_id, object_entry_id, caused_by_json, created_at, applied_at,
          ?, ?
        FROM narrative_event WHERE book_id = ? AND id = ?
      `);
      const deleteRow = storage.sqlite.prepare(`DELETE FROM narrative_event WHERE book_id = ? AND id = ?`);
      for (const id of input.ids) {
        const row = select.get(input.bookId, id);
        if (!row) {
          failed.push({ id, error: "not-found" });
          continue;
        }
        clearTrash.run(input.bookId, id);
        insertTrash.run(deletedAt, input.reason, input.bookId, id);
        deleteRow.run(input.bookId, id);
        deleted.push(id);
        chapters.add(row.chapterNumber);
      }
      ledger = pruneLedgerEventIds(storage, input.bookId, deleted);
    } else {
      const select = storage.sqlite.prepare<{ chapterNumber: number | null }>(
        `SELECT source_chapter AS chapterNumber FROM narrative_fact WHERE book_id = ? AND id = ?`,
      );
      const deleteRow = storage.sqlite.prepare(`DELETE FROM narrative_fact WHERE book_id = ? AND id = ?`);
      for (const id of input.ids) {
        const row = select.get(input.bookId, id);
        if (!row) {
          failed.push({ id, error: "not-found" });
          continue;
        }
        deleteRow.run(input.bookId, id);
        deleted.push(id);
        if (typeof row.chapterNumber === "number") chapters.add(row.chapterNumber);
      }
    }
  });
  run();

  const warnings: string[] = [];
  let entityIndexRefreshed = false;
  if (deleted.length > 0) {
    try {
      const refreshed = refreshNarrativeEntityIndex(storage, input.bookId);
      entityIndexRefreshed = refreshed.ok;
      if (!refreshed.ok) warnings.push(`实体索引未刷新：${refreshed.explanation}`);
    } catch (error) {
      warnings.push(`实体索引未刷新（不影响删除结果，下一次结算会自动重建）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    deleted,
    failed,
    trashed: input.kind === "event",
    ledger,
    affectedChapters: [...chapters].sort((a, b) => a - b),
    entityIndexRefreshed,
    warnings,
  };
}

/** 按章号派生、章节不存在后应一并清掉的表。 */
const PER_CHAPTER_DERIVED_TABLES = [
  "narrative_chapter_settlement",
  "narrative_settlement_artifact",
  "narrative_chapter_mention",
  "narrative_story_time_anchor",
  "narrative_structure_score",
  "narrative_retrieval_log",
] as const;

export interface ReconcileSettlementLedgerInput {
  readonly bookId: string;
  /**
   * 当前存在的章号。缺省时从 bookRoot 的章节正文与 index.json 只读收集；两者都没有时不做「缺章清理」。
   */
  readonly existingChapters?: readonly number[];
  readonly bookRoot?: string;
  /** true=只统计不写库（memory.stats 用）。 */
  readonly dryRun?: boolean;
}

export interface ReconcileSettlementLedgerResult {
  readonly bookId: string;
  readonly applied: boolean;
  /** 是否拿到了章节清单；拿不到时跳过缺章清理，只检查台账引用。 */
  readonly chapterListKnown: boolean;
  /** 台账/派生行指向、但已不存在的章号。 */
  readonly missingChapters: readonly number[];
  /** 各表因缺章被清掉（dryRun 时为将清掉）的行数。 */
  readonly removedRows: Readonly<Record<string, number>>;
  /** 引用的事件全部消失、被标成（dryRun 时为将标成）失效的台账章号。 */
  readonly orphanedLedgerChapters: readonly number[];
  /** 已经处于失效状态、等待重新结算的台账章号。 */
  readonly staleLedgerChapters: readonly number[];
  readonly entityIndexRebuilt: boolean;
  readonly warnings: readonly string[];
}

/**
 * 只读收集现存章号：磁盘上的章节正文 ∪ index.json 里的条目。
 * 刻意不用 readChapterIndex：它在索引损坏时会改名留底，对账（尤其 dryRun）不能有这种副作用。
 */
export async function collectExistingChapterNumbers(bookRoot: string): Promise<number[] | undefined> {
  const numbers = new Set<number>();
  let known = false;
  try {
    for (const file of await listChapterFiles(bookRoot)) numbers.add(file.number);
    known = true;
  } catch {
    // 章节目录读不到：交给 index.json 兜底。
  }
  try {
    const parsed = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      known = true;
      for (const entry of parsed) {
        const number = Number((entry as { number?: unknown } | null)?.number);
        if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
      }
    }
  } catch {
    // 索引缺失或损坏：以磁盘正文为准。
  }
  return known ? [...numbers].sort((a, b) => a - b) : undefined;
}

/**
 * 整本台账对账。
 * - 已不存在的章：清掉台账、证据链、章节提及、结构分、检索日志里该章的行。
 *   检索日志例外保留「最新一章的下一章」：那是正在写、还没落盘的章，写前装配会先于正文产生日志。
 *   章节清单为空（新书或读不到）时整步跳过，绝不把整本的派生数据当成孤儿清掉。
 * - 现存章的台账：原本记了事件、但这些事件在活跃表与回收站里一条都找不到的，标成失效。
 * - 有改动时整本重建实体索引。
 */
export async function reconcileSettlementLedger(
  storage: StorageDatabase,
  input: ReconcileSettlementLedgerInput,
): Promise<ReconcileSettlementLedgerResult> {
  ensureNarrativeMemorySchema(storage);
  ensureSettlementLedgerSchema(storage);
  const bookId = input.bookId;
  const dryRun = input.dryRun === true;
  const warnings: string[] = [];

  let existing = input.existingChapters ? [...input.existingChapters] : undefined;
  if (!existing && input.bookRoot) existing = await collectExistingChapterNumbers(input.bookRoot);
  const chapterListKnown = existing !== undefined && existing.length > 0;
  if (existing !== undefined && existing.length === 0) {
    warnings.push("没有找到任何现存章节，已跳过缺章清理，只检查台账里的事件引用。");
  }
  const existingSet = new Set(existing ?? []);
  const nextChapter = existingSet.size > 0 ? Math.max(...existingSet) + 1 : undefined;

  // 1) 缺章
  const missing = new Set<number>();
  const removedRows: Record<string, number> = {};
  const missingByTable = new Map<string, number[]>();
  if (chapterListKnown) {
    for (const table of PER_CHAPTER_DERIVED_TABLES) {
      const rows = storage.sqlite.prepare<{ chapterNumber: number; count: number }>(`
        SELECT chapter_number AS chapterNumber, COUNT(*) AS count FROM ${table}
        WHERE book_id = ? AND chapter_number IS NOT NULL
        GROUP BY chapter_number
      `).all(bookId);
      const tableMissing: number[] = [];
      let count = 0;
      for (const row of rows) {
        if (existingSet.has(row.chapterNumber)) continue;
        if (table === "narrative_retrieval_log" && row.chapterNumber === nextChapter) continue;
        tableMissing.push(row.chapterNumber);
        missing.add(row.chapterNumber);
        count += row.count;
      }
      missingByTable.set(table, tableMissing);
      removedRows[table] = count;
    }
  }

  // 2) 台账引用的事件全部消失
  const orphaned: number[] = [];
  const alreadyStale: number[] = [];
  let surviving: Set<string> | undefined;
  for (const row of readLedgerRows(storage, bookId)) {
    if (chapterListKnown && !existingSet.has(row.chapterNumber)) continue; // 第 1 步会整行删掉
    if (parseStaleLedgerFingerprint(row.contentFingerprint)) {
      alreadyStale.push(row.chapterNumber);
      continue;
    }
    const ids = parseIds(row.eventIdsJson);
    if (ids.length === 0) continue;
    surviving ??= loadSurvivingEventIds(storage, bookId);
    if (!ids.some((id) => surviving!.has(id))) orphaned.push(row.chapterNumber);
  }

  const changed = missing.size > 0 || orphaned.length > 0;
  let entityIndexRebuilt = false;
  if (!dryRun && changed) {
    storage.sqlite.transaction(() => {
      for (const [table, chapters] of missingByTable) {
        const remove = storage.sqlite.prepare(`DELETE FROM ${table} WHERE book_id = ? AND chapter_number = ?`);
        for (const chapter of chapters) remove.run(bookId, chapter);
      }
      const mark = storage.sqlite.prepare(`
        UPDATE narrative_chapter_settlement SET content_fingerprint = ?
        WHERE book_id = ? AND chapter_number = ? AND content_fingerprint = ?
      `);
      const current = new Map(readLedgerRows(storage, bookId).map((row) => [row.chapterNumber, row] as const));
      for (const chapter of orphaned) {
        const row = current.get(chapter);
        if (!row) continue;
        mark.run(staleLedgerFingerprint("ledger-orphaned", row.contentFingerprint), bookId, chapter, row.contentFingerprint);
      }
    })();
    try {
      // 删的是按章派生行而非事件，增量捕获不覆盖这些表，整本推导更稳妥。
      const refreshed = refreshNarrativeEntityIndex(storage, bookId, { incremental: false });
      entityIndexRebuilt = refreshed.ok;
      if (!refreshed.ok) warnings.push(`实体索引未重建：${refreshed.explanation}`);
    } catch (error) {
      warnings.push(`实体索引未重建（下一次结算会自动重建）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    bookId,
    applied: !dryRun && changed,
    chapterListKnown,
    missingChapters: [...missing].sort((a, b) => a - b),
    removedRows,
    orphanedLedgerChapters: orphaned,
    staleLedgerChapters: dryRun ? alreadyStale : [...alreadyStale, ...orphaned].sort((a, b) => a - b),
    entityIndexRebuilt,
    warnings,
  };
}
