/**
 * 实体索引增量刷新的变更捕获：记下「上次刷新之后，哪些事件 / 事实 / 出场章被写过」。
 *
 * 做法：在当前数据库连接上装 TEMP 触发器，narrative_event / narrative_fact / narrative_chapter_mention
 * 每写一行（增、删；改动推导会读的列时新旧两侧都记）就往连接私有的 TEMP 表追加一条 (book_id, kind, ref)。
 * - TEMP 触发器与 TEMP 表只属于这个连接，不进数据库文件、不影响别的连接，也不改变业务 SQL 的 changes 计数；
 * - 记录随所在事务一起提交或回滚，不会出现「写入回滚了、变更记录还在」；
 * - 别的连接写的行这里看不到——调用方必须另外比对 PRAGMA data_version，变了就整本推导；
 * - 表被 DROP 时 SQLite 会连带删掉它上面的触发器：每次使用前核对触发器是否齐全，
 *   不齐就重装并换一个新的 epoch，持有旧 epoch 的推导状态全部作废（宁可整本推导，不漏变更）；
 * - 每次索引写回在同一事务里清掉本书记录并换一个同步令牌；令牌对不上（写回所在的外层事务回滚了）
 *   就说明记录与推导状态脱节，调用方整本推导。
 */
import { randomUUID } from "node:crypto";

import type { StorageDatabase } from "@vivy1024/novelfork-core";

/**
 * 实体索引推导读取的列。UPDATE 触发器只盯这些列（以及 book_id 与主键）：
 * 改 caused_by_json、slot_key、updated_at 这类与索引无关的列不会让行被重算。
 * 推导新增读取的列时必须同步加在这里，否则增量推导会漏掉对它的修改。
 */
export const EVENT_DERIVATION_COLUMNS = ["id", "book_id", "chapter_number", "event_type", "subject", "object", "subject_entry_id", "object_entry_id", "status"] as const;
export const FACT_DERIVATION_COLUMNS = [
  "id", "book_id", "subject", "predicate", "object", "category", "source_type", "source_id",
  "source_chapter", "valid_from_chapter", "valid_until_chapter", "subject_entry_id", "object_entry_id", "evidence_text", "confidence",
] as const;
export const MENTION_DERIVATION_COLUMNS = ["book_id", "chapter_number", "entry_id"] as const;

const LOG_TABLE = "nf_entity_index_change";
const SYNC_TABLE = "nf_entity_index_sync";
/** 全连接累计的变更记录超过这个数就整体清空并换 epoch（多本书长时间不刷新时防止无限增长）。 */
const MAX_LOG_ROWS = 100_000;

const SOURCES = [
  { table: "narrative_event", kind: "event", ref: "id", columns: EVENT_DERIVATION_COLUMNS },
  { table: "narrative_fact", kind: "fact", ref: "id", columns: FACT_DERIVATION_COLUMNS },
  { table: "narrative_chapter_mention", kind: "mention", ref: "chapter_number", columns: MENTION_DERIVATION_COLUMNS },
] as const;

const TRIGGERS = SOURCES.flatMap((source) => {
  const log = (side: "NEW" | "OLD") => `INSERT INTO ${LOG_TABLE} (book_id, kind, ref) VALUES (${side}.book_id, '${source.kind}', ${side}.${source.ref});`;
  return [
    { name: `nf_eic_${source.kind}_ai`, sql: `AFTER INSERT ON ${source.table} BEGIN ${log("NEW")} END` },
    { name: `nf_eic_${source.kind}_au`, sql: `AFTER UPDATE OF ${source.columns.join(", ")} ON ${source.table} BEGIN ${log("OLD")} ${log("NEW")} END` },
    { name: `nf_eic_${source.kind}_ad`, sql: `AFTER DELETE ON ${source.table} BEGIN ${log("OLD")} END` },
  ];
});
const TRIGGER_NAMES = TRIGGERS.map((trigger) => trigger.name);

let epochCounter = 0;
const trackingEpochs = new WeakMap<StorageDatabase, number>();

function tableExists(storage: StorageDatabase, name: string): boolean {
  return Boolean(storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name));
}

function bumpEpoch(storage: StorageDatabase): number {
  epochCounter += 1;
  trackingEpochs.set(storage, epochCounter);
  return epochCounter;
}

/**
 * 确保本连接上的变更捕获已就绪，返回当前 epoch；装不上（源表缺失等）时返回 null，调用方只能整本推导。
 * epoch 变化 = 之前的变更记录不完整，基于旧 epoch 的推导状态不可再用。
 */
export function ensureEntityIndexChangeTracking(storage: StorageDatabase): number | null {
  try {
    const present = storage.sqlite
      .prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE type = 'trigger' AND name IN (${TRIGGER_NAMES.map(() => "?").join(", ")})`)
      .get(...TRIGGER_NAMES)?.n ?? 0;
    const known = trackingEpochs.get(storage);
    if (present === TRIGGER_NAMES.length && known !== undefined) {
      if (logTooLarge(storage)) {
        storage.sqlite.exec(`DELETE FROM temp.${LOG_TABLE}; DELETE FROM temp.${SYNC_TABLE};`);
        return bumpEpoch(storage);
      }
      return known;
    }
    trackingEpochs.delete(storage);
    if (!SOURCES.every((source) => tableExists(storage, source.table))) return null;
    storage.sqlite.exec(`
      CREATE TEMP TABLE IF NOT EXISTS ${LOG_TABLE} (book_id, kind, ref);
      CREATE INDEX IF NOT EXISTS temp.${LOG_TABLE}_book ON ${LOG_TABLE}(book_id);
      CREATE TEMP TABLE IF NOT EXISTS ${SYNC_TABLE} (book_id PRIMARY KEY, token);
    `);
    for (const trigger of TRIGGERS) {
      storage.sqlite.exec(`DROP TRIGGER IF EXISTS temp.${trigger.name}`);
      storage.sqlite.exec(`CREATE TEMP TRIGGER ${trigger.name} ${trigger.sql}`);
    }
    storage.sqlite.exec(`DELETE FROM temp.${LOG_TABLE}; DELETE FROM temp.${SYNC_TABLE};`);
    return bumpEpoch(storage);
  } catch {
    trackingEpochs.delete(storage);
    // 只装上一半的触发器没有意义（记录不完整），拆掉，免得白白往 TEMP 表里写
    for (const name of TRIGGER_NAMES) {
      try {
        storage.sqlite.exec(`DROP TRIGGER IF EXISTS temp.${name}`);
      } catch {
        // 连接已关闭等：无事可做
      }
    }
    return null;
  }
}

function logTooLarge(storage: StorageDatabase): boolean {
  const maxRowid = storage.sqlite.prepare<{ m: number | null }>(`SELECT MAX(rowid) AS m FROM temp.${LOG_TABLE}`).get()?.m ?? 0;
  if (maxRowid <= MAX_LOG_ROWS) return false;
  const count = storage.sqlite.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM temp.${LOG_TABLE}`).get()?.n ?? 0;
  return count > MAX_LOG_ROWS;
}

export interface EntityIndexChanges {
  readonly eventIds: ReadonlySet<string>;
  readonly factIds: ReadonlySet<string>;
  /** 出场名单被写过的章号（原值）。 */
  readonly mentionChapters: ReadonlySet<unknown>;
  /** 本书变更记录超过 limit 条：批量写入，整本推导更划算也更稳。 */
  readonly overflow: boolean;
}

/**
 * 读取本书自上次同步以来的变更。同步令牌对不上（或变更捕获没装）时返回 null。
 * 调用前必须先 ensureEntityIndexChangeTracking 并核对 epoch。
 */
export function readEntityIndexChanges(storage: StorageDatabase, bookId: string, token: string, limit: number): EntityIndexChanges | null {
  if (!trackingEpochs.has(storage)) return null;
  const synced = storage.sqlite.prepare<{ token: string }>(`SELECT token FROM temp.${SYNC_TABLE} WHERE book_id = ?`).get(bookId);
  if (!synced || synced.token !== token) return null;
  const rows = storage.sqlite
    .prepare<{ kind: string; ref: unknown }>(`SELECT kind, ref FROM temp.${LOG_TABLE} WHERE book_id = ? LIMIT ?`)
    .all(bookId, limit + 1);
  const eventIds = new Set<string>();
  const factIds = new Set<string>();
  const mentionChapters = new Set<unknown>();
  for (const row of rows) {
    if (row.kind === "event") eventIds.add(String(row.ref));
    else if (row.kind === "fact") factIds.add(String(row.ref));
    else mentionChapters.add(row.ref);
  }
  return { eventIds, factIds, mentionChapters, overflow: rows.length > limit };
}

/**
 * 索引写回成功时调用（必须与写回同一事务）：清掉本书变更记录，换一个新的同步令牌并返回。
 * 变更捕获没装时返回空串（之后的 readEntityIndexChanges 必然对不上，自动走整本）。
 */
export function markEntityIndexSynced(storage: StorageDatabase, bookId: string): string {
  if (!trackingEpochs.has(storage)) return "";
  const token = randomUUID();
  storage.sqlite.prepare(`DELETE FROM temp.${LOG_TABLE} WHERE book_id = ?`).run(bookId);
  storage.sqlite.prepare(`INSERT OR REPLACE INTO temp.${SYNC_TABLE} (book_id, token) VALUES (?, ?)`).run(bookId, token);
  return token;
}
