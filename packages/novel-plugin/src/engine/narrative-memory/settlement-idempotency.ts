/**
 * 章后结算幂等（P5）。
 *
 * 为什么幂等键必须是 (bookId, chapterNumber, 正文内容指纹) 而不只是章号：
 * 「同一章再结算」有两种完全相反的含义 ——
 * - 内容未变：agent 重试、管线发起后又手动补一次、settle_range 扫到已结算章。这时重复抽取只会
 *   反复写同样的事实、反复往待审队列里塞同样的条目，必须跳过。
 * - 内容已变：章节被改写。这时旧结算结论已经不对应当前正文，必须重新抽取。
 * 只用章号会把第二种情况一起挡掉；带上内容指纹才能把两者分开。
 *
 * 为什么判定必须发生在抽取之前：
 * chapter-event-extractor 走 LLM，同一段正文两次调用的输出并不保证一致。若先抽取再去重，
 * 第二次结算会产出一批「新 tuple」的事件，去重键对不上，重复写入照旧发生。
 * 因此这里的判定是结算的前置门，不是结算之后的清理。
 *
 * 为什么必须持久化一张台账，不能从事件流推导：
 * 「这章结算过」可以从 narrative_event 有没有该章的行推出来，但推不出两件事 ——
 * 1. 结算时的正文长什么样（事件行里没有正文指纹），因此无法区分「内容未变」与「已被改写」；
 * 2. 抽取结果为空的章（extracted=0）在事件流里没有任何行，会被永久误判成「从未结算」，
 *    每次 settle_range 都要重跑一次 LLM。
 * 台账只存推导不出来的部分：内容指纹、结算时间、重结算次数、本次产出的事件 id。
 * 事件的 applied/pending/rejected 计数不落盘，读取时从 narrative_event 现算，
 * 这样作者后续批准/驳回会自动反映到台账视图里，不会出现两份互相矛盾的计数。
 */

import { createHash } from "node:crypto";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { NarrativeEventStatus } from "./types.js";

/** 结算台账表；与 narrative_* 家族一致，走运行时 ensure schema，不进 drizzle 迁移。 */
export function ensureSettlementLedgerSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_chapter_settlement (
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      content_fingerprint TEXT NOT NULL,
      settled_at TEXT NOT NULL,
      settlement_count INTEGER NOT NULL,
      event_ids_json TEXT NOT NULL,
      PRIMARY KEY (book_id, chapter_number)
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_chapter_settlement_book
      ON narrative_chapter_settlement(book_id, chapter_number);
  `);
}

/**
 * 正文内容指纹。
 *
 * 归一化只做两件事：统一换行符、去首尾空白。
 * 换行符归一化是必需的：同一份正文在 Windows/Unix 落盘会有 CRLF/LF 差异，
 * 那不是作者改写，不该触发重新抽取。
 * 内部空白**不折叠** —— 网文的空行与缩进承载分段节奏，改了就是改了正文。
 */
export function chapterContentFingerprint(content: string): string {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export type ChapterSettlementRecord = Readonly<{
  bookId: string;
  chapterNumber: number;
  contentFingerprint: string;
  settledAt: string;
  /** 该章被结算过几次（首次=1，之后每次改写重结算 +1）。 */
  settlementCount: number;
  /** 最近一次结算产出/复用的事件 id。 */
  eventIds: readonly string[];
}>;

interface SettlementRow {
  bookId: string;
  chapterNumber: number;
  contentFingerprint: string;
  settledAt: string;
  settlementCount: number;
  eventIdsJson: string;
}

const SETTLEMENT_SELECT = `
  SELECT
    book_id AS bookId,
    chapter_number AS chapterNumber,
    content_fingerprint AS contentFingerprint,
    settled_at AS settledAt,
    settlement_count AS settlementCount,
    event_ids_json AS eventIdsJson
  FROM narrative_chapter_settlement
`;

function parseEventIds(json: string): readonly string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: SettlementRow): ChapterSettlementRecord {
  return {
    bookId: row.bookId,
    chapterNumber: row.chapterNumber,
    contentFingerprint: row.contentFingerprint,
    settledAt: row.settledAt,
    settlementCount: row.settlementCount,
    eventIds: parseEventIds(row.eventIdsJson),
  };
}

export function readChapterSettlementRecord(
  storage: StorageDatabase,
  input: Readonly<{ bookId: string; chapterNumber: number }>,
): ChapterSettlementRecord | undefined {
  ensureSettlementLedgerSchema(storage);
  const row = storage.sqlite
    .prepare<SettlementRow>(`${SETTLEMENT_SELECT} WHERE book_id = ? AND chapter_number = ?`)
    .get(input.bookId, input.chapterNumber);
  return row ? rowToRecord(row) : undefined;
}

/** 台账里记录的事件当前状态分布；从 narrative_event 现算，不落盘。 */
export type SettledEventStatusCounts = Readonly<{
  total: number;
  applied: number;
  pending: number;
  rejected: number;
  highRiskPending: number;
}>;

export function countSettledEventStatuses(
  storage: StorageDatabase,
  input: Readonly<{ bookId: string; eventIds: readonly string[] }>,
): SettledEventStatusCounts {
  const empty: SettledEventStatusCounts = { total: 0, applied: 0, pending: 0, rejected: 0, highRiskPending: 0 };
  if (input.eventIds.length === 0) return empty;

  const placeholders = input.eventIds.map(() => "?").join(", ");
  const rows = storage.sqlite
    .prepare<{ status: NarrativeEventStatus; riskLevel: string }>(`
      SELECT status, risk_level AS riskLevel
      FROM narrative_event
      WHERE book_id = ? AND id IN (${placeholders})
    `)
    .all(input.bookId, ...input.eventIds);

  let applied = 0;
  let pending = 0;
  let rejected = 0;
  let highRiskPending = 0;
  for (const row of rows) {
    if (row.status === "applied") applied += 1;
    else if (row.status === "pending") {
      pending += 1;
      if (row.riskLevel === "high") highRiskPending += 1;
    } else if (row.status === "rejected") rejected += 1;
  }
  return { total: rows.length, applied, pending, rejected, highRiskPending };
}

export type ChapterSettlementIdempotencyDecision = Readonly<{
  /** settle=首次结算；resettle=正文已变，需要重新抽取；skip=同章同内容，跳过。 */
  decision: "settle" | "resettle" | "skip";
  /** 本次正文的指纹。 */
  fingerprint: string;
  /** 台账中已有的记录（首次结算时为 undefined）。 */
  record?: ChapterSettlementRecord;
  /** decision=resettle 时，上一次结算所依据的正文指纹。 */
  previousFingerprint?: string;
  /** decision=skip 时，既有结算产出事件的当前状态分布。 */
  existingEventCounts?: SettledEventStatusCounts;
  /** force=true 强制重结算时为 true，用于把「被强制」与「内容真的变了」区分开。 */
  forced?: boolean;
}>;

/**
 * 结算幂等判定。必须在任何抽取（尤其 LLM 抽取）之前调用。
 *
 * force=true 是逃生口：上一次结算漏抽或抽错时，作者/agent 需要在正文没变的情况下重跑。
 * 它不跳过判定，只是把 skip 提升为 resettle，并在结果里标记 forced，保持可观测。
 */
export function decideChapterSettlementIdempotency(
  storage: StorageDatabase,
  input: Readonly<{ bookId: string; chapterNumber: number; content: string; force?: boolean }>,
): ChapterSettlementIdempotencyDecision {
  const fingerprint = chapterContentFingerprint(input.content);
  const record = readChapterSettlementRecord(storage, { bookId: input.bookId, chapterNumber: input.chapterNumber });

  if (!record) return { decision: "settle", fingerprint };

  if (record.contentFingerprint !== fingerprint) {
    return { decision: "resettle", fingerprint, record, previousFingerprint: record.contentFingerprint };
  }

  if (input.force) {
    return { decision: "resettle", fingerprint, record, previousFingerprint: record.contentFingerprint, forced: true };
  }

  return {
    decision: "skip",
    fingerprint,
    record,
    existingEventCounts: countSettledEventStatuses(storage, { bookId: input.bookId, eventIds: record.eventIds }),
  };
}

/** 结算完成后写入/更新台账。只有真正跑完抽取与归约的结算才记录。 */
export function recordChapterSettlement(
  storage: StorageDatabase,
  input: Readonly<{
    bookId: string;
    chapterNumber: number;
    contentFingerprint: string;
    eventIds: readonly string[];
    settledAt: string;
    /** 判定阶段读到的既有记录；用于累加重结算次数。 */
    previousRecord?: ChapterSettlementRecord;
  }>,
): ChapterSettlementRecord {
  ensureSettlementLedgerSchema(storage);
  const settlementCount = (input.previousRecord?.settlementCount ?? 0) + 1;
  storage.sqlite
    .prepare(`
      INSERT INTO narrative_chapter_settlement (
        book_id,
        chapter_number,
        content_fingerprint,
        settled_at,
        settlement_count,
        event_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, chapter_number) DO UPDATE SET
        content_fingerprint = excluded.content_fingerprint,
        settled_at = excluded.settled_at,
        settlement_count = excluded.settlement_count,
        event_ids_json = excluded.event_ids_json
    `)
    .run(
      input.bookId,
      input.chapterNumber,
      input.contentFingerprint,
      input.settledAt,
      settlementCount,
      JSON.stringify([...input.eventIds]),
    );

  return {
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    contentFingerprint: input.contentFingerprint,
    settledAt: input.settledAt,
    settlementCount,
    eventIds: [...input.eventIds],
  };
}

/**
 * 该事件状态是否已经是终态、不该被后续结算再动。
 *
 * 章节改写后重结算时，抽取器很可能重新抽出同一条 tuple。事件 id 由 tuple 决定，
 * 所以行本身不会重复插入，但若让它再走一遍归约就会出现两种坏结果：
 * - 作者驳回过的事件被重新处理，在面板上「又活了」；
 * - 作者批准过的事件被重新走一遍写入路径。
 * 因此复用到的既有事件只要已是 applied/rejected，就直接跳过归约：作者的裁决是终态。
 */
export function isTerminalSettlementStatus(status: NarrativeEventStatus): boolean {
  return status === "applied" || status === "rejected";
}
