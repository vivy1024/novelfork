/**
 * 人物知情边界索引（T4.3 知情部分）—— narrative_knowledge 由已确认的叙事记忆事实整本派生。
 *
 * 权威关系与推导规则（不依赖模型新抽取，与实体索引同一来源、同一趟重建）：
 * - 知情来源只取「已确认 / 已应用」的事实：
 *     · source_type = 'event' 的事实，要求其来源事件在 narrative_event 里是 applied；
 *       待审（pending）与驳回（rejected）的事件不产生事实，也不会让人物「知道」；
 *     · manual / import 等作者权威来源的事实直接算已确认。
 * - 凡事实的 subject 归并到实体（含复合主体拆分），该实体从事实所在章起「知道」这条事实；
 *   object 一侧只在对象确为实体类别的类别（relationship / location）归并——关系事实双方都知道。
 * - 参与者缺失的事实不算「他知道」：subject / object 归并不到经纬实体的事实不产生知情行。
 * - 章号缺失（source_chapter 与 valid_from_chapter 皆空）的事实无法定界知情起点，跳过并计数。
 *
 * 表结构（迁移 0032）：knower_id 指向 narrative_entity.id，fact_kind 固定 'fact'，
 * fact_ref 指向 narrative_fact.id，knows_from 为知情起始章，certainty 固定 'knows'。
 *
 * 写入时机：由 entity-index 的整本重建事务统一刷新（结算后、手动重建、书籍导入共用一条路径）。
 * 本模块还承载「第 N 章时某角色知道什么 / 还不知道什么」的查询，供路由与写作注入复用。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";

/** object 一侧是实体的记忆类别；其余类别的 object 是状态值，不当知情人。 */
export const OBJECT_IS_ENTITY_FACT_CATEGORIES: ReadonlySet<string> = new Set(["relationship", "location"]);

/**
 * 「他还不知道」反推时关心的记忆类别：与剧情有关、且典型地存在「秘密」的事。
 * 伏笔 / 时间线属于作者视角的结构信息，不是人物的 知识，不参与。
 */
export const UNAWARE_FACT_CATEGORIES: readonly string[] = ["relationship", "character_state", "location", "world_fact"];

/** 「他还不知道」列表默认条数上限（注入与接口共用，超出按章号降序截断）。 */
export const DEFAULT_UNAWARE_LIMIT = 8;

export interface KnowledgeRow {
  readonly id: string;
  readonly entityId: string;
  readonly factRef: string;
  readonly knowsFrom: number;
  readonly evidence: string | null;
}

export interface KnowledgeFactRef {
  readonly factId: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  /** source_chapter 优先，其次 valid_from_chapter。 */
  readonly chapter: number | null;
  readonly evidence: string | null;
  readonly confidence: number;
}

function toChapter(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return value !== null && value !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 事实是否属于「已确认 / 已应用」的知情来源。
 * event 来源必须来源事件已应用（待审不算）；作者权威来源（manual / import / jingwei / runtime-state）直接算。
 */
export function isKnowledgeConfirmed(
  sourceType: string,
  sourceId: string | null,
  appliedEventIds: ReadonlySet<string>,
): boolean {
  if (sourceType === "event") return sourceId !== null && appliedEventIds.has(sourceId);
  return true;
}

/**
 * 由一条已确认事实与归并出的知情人集合生成知情行（纯函数，不写库）。
 * chapter 为空或知情人集合为空时返回空数组——参与者缺失、章号缺失都不算「他知道」。
 */
export function knowledgeRowsForFact(fact: KnowledgeFactRef, knowerEntityIds: readonly string[]): KnowledgeRow[] {
  if (fact.chapter === null) return [];
  const evidence = fact.evidence?.slice(0, 400) || null;
  const rows: KnowledgeRow[] = [];
  const seen = new Set<string>();
  for (const entityId of knowerEntityIds) {
    if (seen.has(entityId)) continue;
    seen.add(entityId);
    rows.push({
      id: `know:${fact.factId}:${entityId}`.slice(0, 240),
      entityId,
      factRef: fact.factId,
      knowsFrom: fact.chapter,
      evidence,
    });
  }
  return rows;
}

// ─── 查询 ────────────────────────────────────────────────────────────────

export interface KnowledgeEntity {
  readonly id: string;
  readonly entryId: string | null;
  readonly name: string;
  readonly type: string;
  readonly firstChapter: number | null;
  readonly lastChapter: number | null;
}

export interface KnowledgeKnownFact {
  readonly factId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: string;
  /** knows_from：他从第几章起知道。 */
  readonly chapter: number;
  readonly evidence: string | null;
  readonly confidence: number;
}

export interface KnowledgeUnawareFact {
  readonly factId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: string;
  /** 事实发生 / 记录章。 */
  readonly chapter: number;
  readonly evidence: string | null;
  readonly confidence: number;
}

export interface KnowledgeStateValue {
  readonly fluent: string;
  readonly value: string;
  readonly chapter: number;
}

export interface EntityKnowledgeAnswer {
  readonly ok: true;
  readonly schemaMissing: boolean;
  readonly entity: KnowledgeEntity | null;
  /** 查询基准章；null 表示「至今」。 */
  readonly chapter: number | null;
  /** 截至该章他知道（且仍有效）的事实，按知情章升序。 */
  readonly knows: readonly KnowledgeKnownFact[];
  /** 截至该章已发生、仍有效、但他不在场的关键事实（他不该知道），按章号降序限量。 */
  readonly unaware: readonly KnowledgeUnawareFact[];
  /** 现状：每个方面（fluent）取该章之前最后一条状态流水值。 */
  readonly state: readonly KnowledgeStateValue[];
  readonly stats: {
    readonly entities: number;
    readonly knowledgeRows: number;
    readonly stateChanges: number;
  };
}

export type KnowledgeEmptyReason = "schema-missing" | "index-empty" | "entity-not-found" | "no-knowledge";

export interface KnowledgeExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

function tableExists(storage: StorageDatabase, name: string): boolean {
  return Boolean(storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name));
}

export function explainKnowledgeEmpty(reason: KnowledgeEmptyReason, context: { chapter?: number; name?: string } = {}): KnowledgeExplanation {
  switch (reason) {
    case "schema-missing":
      return {
        whatHappened: "这个数据库还没有实体索引相关的表（迁移 0032 未执行）。",
        whyItMatters: "知情边界只按实体 ID 记账，没有索引表就无法确认谁在场、谁知道；正文、事实与事件不受影响。",
        suggestedAction: "重启 NovelFork 让数据库迁移执行完成后再查询。",
      };
    case "index-empty":
      return {
        whatHappened: "这本书的知情索引还是空的。",
        whyItMatters: "知情记录由已确认的记忆事实按实体派生：还没有结算出事实，或实体索引还没有重建过。",
        suggestedAction: "先结算已写章节（结算后会自动重建实体与知情索引）；已有结算记录的话，点「重建索引」立即重建。",
      };
    case "entity-not-found":
      return {
        whatHappened: `实体索引里找不到${context.name ? `「${context.name}」` : "这个实体"}。`,
        whyItMatters: "只有经纬里的角色 / 地点 / 势力 / 道具条目会进入实体索引；条目刚建立或刚改名时，要重建后才有身份。",
        suggestedAction: "确认它在经纬里是角色 / 地点 / 势力 / 道具条目，且没有与另一条目同名，然后点「重建索引」。",
      };
    case "no-knowledge":
      return {
        whatHappened: `${context.name ? `「${context.name}」` : "这个实体"}${context.chapter ? `截至第 ${context.chapter} 章` : "目前"}还没有知情记录。`,
        whyItMatters: "知情记录来自已确认记忆事实里能归并到实体的 subject / object；没在事实里出现过的角色自然没有「他知道」的账。",
        suggestedAction: "结算他出场、涉事的章节；事实里的人名要能在经纬里找到对应条目，归并不到实体的事实不会算他知道。",
      };
  }
}

function loadStats(storage: StorageDatabase, bookId: string): EntityKnowledgeAnswer["stats"] {
  const count = (table: string) => storage.sqlite
    .prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE book_id = ?`)
    .get(bookId)?.n ?? 0;
  return {
    entities: count("narrative_entity"),
    knowledgeRows: count("narrative_knowledge"),
    stateChanges: count("narrative_state_change"),
  };
}

function emptyAnswer(bookId: string, chapter: number | null, schemaMissing: boolean, stats?: EntityKnowledgeAnswer["stats"]): EntityKnowledgeAnswer {
  return {
    ok: true,
    schemaMissing,
    entity: null,
    chapter,
    knows: [],
    unaware: [],
    state: [],
    stats: stats ?? { entities: 0, knowledgeRows: 0, stateChanges: 0 },
  };
}

export function findKnowledgeEntity(
  storage: StorageDatabase,
  bookId: string,
  lookup: { entityId?: string; entryId?: string },
): KnowledgeEntity | null {
  const row = lookup.entityId
    ? storage.sqlite.prepare<{ id: string; entry_id: string | null; canonical_name: string; entity_type: string; first_chapter: number | null; last_chapter: number | null }>(
      "SELECT id, entry_id, canonical_name, entity_type, first_chapter, last_chapter FROM narrative_entity WHERE book_id = ? AND id = ?",
    ).get(bookId, lookup.entityId)
    : lookup.entryId
      ? storage.sqlite.prepare<{ id: string; entry_id: string | null; canonical_name: string; entity_type: string; first_chapter: number | null; last_chapter: number | null }>(
        "SELECT id, entry_id, canonical_name, entity_type, first_chapter, last_chapter FROM narrative_entity WHERE book_id = ? AND entry_id = ? ORDER BY canonical_name ASC LIMIT 1",
      ).get(bookId, lookup.entryId)
      : undefined;
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    name: row.canonical_name,
    type: row.entity_type,
    firstChapter: toChapter(row.first_chapter),
    lastChapter: toChapter(row.last_chapter),
  };
}

/**
 * 实体别名 / 规范名 → 实体 id（写作注入把出场名单按名字归并到实体）。
 * 只查实体索引自己的别名摊平表，不按文本模糊匹配；返回顺序与输入名单一致、按实体去重。
 */
export function resolveKnowledgeEntitiesByNames(storage: StorageDatabase, bookId: string, names: readonly string[]): KnowledgeEntity[] {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const placeholders = wanted.map(() => "?").join(", ");
  const byAlias = new Map<string, string>();
  for (const row of storage.sqlite.prepare<{ alias: string; entity_id: string }>(`
    SELECT alias, entity_id FROM narrative_entity_alias
    WHERE book_id = ? AND alias IN (${placeholders})
  `).all(bookId, ...wanted) as Array<{ alias: string; entity_id: string }>) {
    byAlias.set(row.alias, row.entity_id);
  }
  const byCanonical = new Map<string, string>();
  for (const row of storage.sqlite.prepare<{ canonical_name: string; id: string }>(`
    SELECT canonical_name, id FROM narrative_entity
    WHERE book_id = ? AND canonical_name IN (${placeholders})
  `).all(bookId, ...wanted) as Array<{ canonical_name: string; id: string }>) {
    byCanonical.set(row.canonical_name, row.id);
  }
  const seen = new Set<string>();
  const result: KnowledgeEntity[] = [];
  for (const name of wanted) {
    const entityId = byAlias.get(name) ?? byCanonical.get(name);
    if (!entityId || seen.has(entityId)) continue;
    seen.add(entityId);
    const entity = findKnowledgeEntity(storage, bookId, { entityId });
    if (entity) result.push(entity);
  }
  return result;
}

export interface QueryEntityKnowledgeOptions {
  readonly entityId?: string;
  readonly entryId?: string;
  /** 基准章；缺省表示「至今」（不过滤上限）。 */
  readonly chapter?: number;
  readonly unawareLimit?: number;
  readonly stateLimit?: number;
}

/**
 * 「第 N 章时这个角色知道什么 / 还不知道什么」。
 * - 知道：narrative_knowledge 里 knows_from ≤ N 且事实截至第 N 章仍有效（valid_until 为空或 > N）；
 * - 不知道：截至第 N 章已发生、仍有效的关键类别事实里，知情账上没有他的——他不在场，不该知道；
 * - 现状：状态流水按方面取第 N 章（含）之前最后一条。
 */
export function queryEntityKnowledge(storage: StorageDatabase, bookId: string, options: QueryEntityKnowledgeOptions): EntityKnowledgeAnswer {
  ensureNarrativeMemorySchema(storage);
  const chapter = options.chapter !== undefined && Number.isSafeInteger(options.chapter) && options.chapter > 0 ? options.chapter : null;
  const chapterCap = chapter ?? Number.MAX_SAFE_INTEGER;
  const unawareLimit = Math.max(1, Math.min(options.unawareLimit ?? DEFAULT_UNAWARE_LIMIT, 50));
  const stateLimit = Math.max(1, Math.min(options.stateLimit ?? 12, 50));

  if (!["narrative_entity", "narrative_knowledge", "narrative_state_change"].every((table) => tableExists(storage, table))) {
    return emptyAnswer(bookId, chapter, true);
  }
  const stats = loadStats(storage, bookId);
  const entity = findKnowledgeEntity(storage, bookId, { entityId: options.entityId, entryId: options.entryId });
  if (!entity) return { ...emptyAnswer(bookId, chapter, false, stats), entity: null };

  const knows = storage.sqlite.prepare<{
    fact_ref: string; knows_from: number; subject: string; predicate: string; object: string; category: string; evidence: string | null; confidence: number | null;
  }>(`
    SELECT k.fact_ref, k.knows_from, f.subject, f.predicate, f.object, f.category, k.evidence_text AS evidence, f.confidence
    FROM narrative_knowledge k
    JOIN narrative_fact f ON f.id = k.fact_ref
    WHERE k.book_id = ? AND k.knower_id = ? AND k.fact_kind = 'fact'
      AND k.knows_from <= ?
      AND (f.valid_until_chapter IS NULL OR f.valid_until_chapter > ?)
    ORDER BY k.knows_from ASC, k.fact_ref ASC
  `).all(bookId, entity.id, chapterCap, chapterCap)
    .map((row): KnowledgeKnownFact => ({
      factId: row.fact_ref,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      category: row.category,
      chapter: row.knows_from,
      evidence: row.evidence,
      confidence: typeof row.confidence === "number" ? row.confidence : 1,
    }));

  const categoryPlaceholders = UNAWARE_FACT_CATEGORIES.map(() => "?").join(", ");
  const unaware = storage.sqlite.prepare<{
    id: string; subject: string; predicate: string; object: string; category: string; chapter: number; evidence_text: string | null; confidence: number | null;
  }>(`
    SELECT f.id, f.subject, f.predicate, f.object, f.category,
           COALESCE(f.source_chapter, f.valid_from_chapter) AS chapter,
           f.evidence_text, f.confidence
    FROM narrative_fact f
    LEFT JOIN narrative_event e ON e.id = f.source_id
    WHERE f.book_id = ?
      AND f.category IN (${categoryPlaceholders})
      AND COALESCE(f.source_chapter, f.valid_from_chapter) IS NOT NULL
      AND COALESCE(f.source_chapter, f.valid_from_chapter) <= ?
      AND (f.valid_until_chapter IS NULL OR f.valid_until_chapter > ?)
      AND (f.source_type != 'event' OR e.status = 'applied')
      AND f.id NOT IN (
        SELECT fact_ref FROM narrative_knowledge
        WHERE book_id = ? AND knower_id = ? AND fact_kind = 'fact'
      )
    ORDER BY chapter DESC, f.confidence DESC, f.id ASC
    LIMIT ?
  `).all(bookId, ...UNAWARE_FACT_CATEGORIES, chapterCap, chapterCap, bookId, entity.id, unawareLimit)
    .map((row): KnowledgeUnawareFact => ({
      factId: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      category: row.category,
      chapter: row.chapter,
      evidence: row.evidence_text,
      confidence: typeof row.confidence === "number" ? row.confidence : 1,
    }));

  const stateRows = storage.sqlite.prepare<{ fluent: string; new_value: string; chapter_number: number }>(`
    SELECT fluent, new_value, chapter_number
    FROM narrative_state_change
    WHERE book_id = ? AND entity_id = ? AND chapter_number <= ?
    ORDER BY chapter_number ASC, id ASC
  `).all(bookId, entity.id, chapterCap);
  const latestByFluent = new Map<string, KnowledgeStateValue>();
  for (const row of stateRows) {
    const value = String(row.new_value ?? "");
    if (!value.trim()) continue;
    latestByFluent.set(row.fluent, { fluent: row.fluent, value, chapter: row.chapter_number });
  }
  const state = [...latestByFluent.values()]
    .sort((a, b) => b.chapter - a.chapter || a.fluent.localeCompare(b.fluent, "zh"))
    .slice(0, stateLimit);

  return {
    ok: true,
    schemaMissing: false,
    entity,
    chapter,
    knows,
    unaware,
    state,
    stats,
  };
}
