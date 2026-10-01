/**
 * 叙事实体索引（T4.1）—— 由经纬条目与叙事记忆派生、可随时整本重建的身份索引。
 *
 * 权威关系：
 * - 实体身份的唯一权威是经纬条目（角色 / 地点 / 势力 / 道具）。本索引不接受任何独立写入，
 *   每次都从经纬条目 + narrative_fact + narrative_event 全量推导，所以不存在「两边不同步」。
 * - 实体 id 取 `ent:<bookId>:<经纬条目 id>`：角色改名、加别名都不会改变 id，下游关系边稳定。
 *
 * 写入 0032 的六张表：
 *   narrative_entity / narrative_entity_alias —— 经纬条目的身份投影与称呼摊平
 *   narrative_event_participant —— 事件参与者；复合主体「甲与乙」在这里拆成两个实体，不再造复合实体
 *   narrative_relation —— 关系类事实按实体 id 建有向边，带故事内有效期
 *   narrative_state_change —— 状态 / 位置类事实按实体记状态流水
 *   narrative_knowledge —— 已确认事实的知情账：subject（及 relationship/location 的 object）
 *                         归并到的实体从事实所在章起「知道」该事实（T4.3，规则见 knowledge-index.ts）
 *
 * 只归并能在经纬里找到的名字；找不到的如实计入「未归并」，不凭空建实体——
 * 新角色应先作为待审经纬条目进入权威源，再在下一次重建时获得身份。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";
import {
  buildEntityDictionary,
  resolveEntity,
  stripParentheticalSuffix,
  type EntityDictionary,
  type EntityDictionaryEntry,
} from "../narrative-memory/entity-dictionary.js";
import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";
import {
  isKnowledgeConfirmed,
  knowledgeRowsForFact,
  OBJECT_IS_ENTITY_FACT_CATEGORIES,
  type KnowledgeRow,
} from "./knowledge-index.js";

/** 经纬分类 → 实体类型；伏笔不是实体，只用来识别「这是伏笔称呼」。 */
const ENTITY_TYPE_BY_CATEGORY: Readonly<Record<string, string>> = {
  characters: "character",
  locations: "location",
  factions: "faction",
  props: "item",
};

const COMPOSITE_SEPARATORS = /[、，,]|与|和|及|跟/u;
/** 对象一侧是实体（人物 / 地点）的事件类型；其余事件的对象是状态值。 */
const OBJECT_IS_ENTITY_EVENT_TYPES: ReadonlySet<string> = new Set(["relationship_changed", "location_changed"]);
const NON_ENTITY_HINTS = [/风险$/u, /情况$/u, /记忆$/u, /安置$/u, /筛查$/u, /之夜/u];
/** 实测未归并称呼里占比最大的是事件 / 情节短语（「故事主线时间」「驻场体检」），不计入链接率分母。 */
const EVENT_PHRASE_HINTS = [
  /时间$/u, /线索$/u, /后果$/u, /旧怨$/u, /悬案$/u, /抢救$/u, /清理$/u, /掩盖$/u,
  /离职$/u, /体检$/u, /方案$/u, /数据$/u, /记录$/u, /场强$/u, /衰减$/u, /层级$/u,
];

const INDEX_TABLES = [
  "narrative_entity",
  "narrative_entity_alias",
  "narrative_event_participant",
  "narrative_relation",
  "narrative_state_change",
  "narrative_knowledge",
] as const;

export interface EntityIndexStats {
  readonly entities: number;
  readonly aliases: number;
  readonly participants: number;
  readonly relations: number;
  readonly stateChanges: number;
  /** 知情账行数（谁从第几章起知道哪条已确认事实）。 */
  readonly knowledge: number;
  /** 参与归并判定的实体称呼总数（已排除伏笔称呼与事件短语）。 */
  readonly totalMentions: number;
  readonly resolvedMentions: number;
  readonly foreshadowMentions: number;
  readonly nonEntityMentions: number;
  /** 未能归并到经纬条目的称呼样例（最多 12 个），用于提示作者补设定。 */
  readonly unresolvedSamples: readonly string[];
  /** 规范名撞名、未进索引的经纬条目 id（同书两个条目剥括号后同名）。 */
  readonly duplicateEntryIds: readonly string[];
}

export type EntityIndexRebuildResult =
  | ({ readonly ok: true; readonly bookId: string; readonly applied: boolean } & EntityIndexStats)
  | { readonly ok: false; readonly bookId: string; readonly reason: "schema-missing"; readonly explanation: string };

// ─── 纯函数：称呼拆分与判定 ───────────────────────────────────────────────

/** 复合主体拆分：「薛行之与方工」→ 两个名字；括号内视为别名不拆；像描述性短语时整体保留。 */
export function splitCompositeSubject(subject: string): { names: string[]; composite: boolean } {
  const trimmed = subject.replace(/\s+/gu, " ").trim();
  if (!trimmed) return { names: [], composite: false };
  if (/[（(].*[）)]/u.test(trimmed)) {
    const stripped = trimmed.replace(/[（(][^（()）]*[）)]/gu, "").trim();
    const outer = stripped.split(COMPOSITE_SEPARATORS).map((part) => part.trim()).filter(Boolean);
    if (outer.length <= 1) return { names: [trimmed], composite: false };
    return { names: outer, composite: true };
  }
  const parts = trimmed.split(COMPOSITE_SEPARATORS).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return { names: [trimmed], composite: false };
  if (parts.some((part) => part.length > 12 || NON_ENTITY_HINTS.some((hint) => hint.test(part)))) {
    return { names: [trimmed], composite: false };
  }
  return { names: parts, composite: true };
}

export function looksLikeEntityName(name: string): boolean {
  const normalized = name.replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > 16) return false;
  if (/[。！？；]/u.test(normalized)) return false;
  return !NON_ENTITY_HINTS.some((hint) => hint.test(normalized));
}

export function looksLikeEventPhrase(name: string): boolean {
  const normalized = name.replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  if (normalized.length >= 5 && EVENT_PHRASE_HINTS.some((hint) => hint.test(normalized))) return true;
  return /^\d{4}[.\-年]/u.test(normalized);
}

// ─── 推导 ────────────────────────────────────────────────────────────────

interface EntityRow {
  readonly id: string;
  readonly entryId: string;
  readonly canonicalName: string;
  readonly entityType: string;
  readonly aliases: readonly string[];
  readonly firstChapter: number | null;
  readonly lastChapter: number | null;
}

interface RelationRow {
  readonly id: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly sourceEventId: string | null;
  readonly evidence: string | null;
  readonly confidence: number;
}

interface StateChangeRow {
  readonly id: string;
  readonly entityId: string;
  readonly fluent: string;
  readonly newValue: string;
  readonly chapter: number;
  readonly evidence: string | null;
  readonly confidence: number;
}

interface ParticipantRow {
  readonly eventId: string;
  readonly entityId: string;
  readonly role: "agent" | "patient";
}

export interface EntityIndexPlan {
  readonly entities: readonly EntityRow[];
  readonly relations: readonly RelationRow[];
  readonly stateChanges: readonly StateChangeRow[];
  readonly participants: readonly ParticipantRow[];
  readonly knowledge: readonly KnowledgeRow[];
  readonly stats: EntityIndexStats;
}

function toChapter(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function tableExists(storage: StorageDatabase, name: string): boolean {
  return Boolean(storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name));
}

function entityIdFor(bookId: string, entryId: string): string {
  return `ent:${bookId}:${entryId}`;
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/**
 * 只读推导：不写库。rebuild 在它之上一次性替换本书索引；dry-run（回填脚本）直接看 stats。
 */
export function planNarrativeEntityIndex(storage: StorageDatabase, bookId: string): EntityIndexPlan {
  const dictionary: EntityDictionary = buildEntityDictionary(storage, bookId);

  const foreshadowKeys = new Set<string>();
  const entityByEntryId = new Map<string, EntityDictionaryEntry>();
  const entities: EntityRow[] = [];
  const duplicateEntryIds: string[] = [];
  const usedCanonical = new Set<string>();

  // 章节首末出场：优先本章全量出场名单（0033），没有时由事件章号补
  const chapterSpan = new Map<string, { first: number; last: number }>();
  const touch = (entryId: string, chapter: number | null) => {
    if (chapter === null) return;
    const span = chapterSpan.get(entryId);
    if (!span) chapterSpan.set(entryId, { first: chapter, last: chapter });
    else chapterSpan.set(entryId, { first: Math.min(span.first, chapter), last: Math.max(span.last, chapter) });
  };
  if (tableExists(storage, "narrative_chapter_mention")) {
    const rows = storage.sqlite
      .prepare<{ entry_id: string; first: number; last: number }>(`
        SELECT entry_id, MIN(chapter_number) AS first, MAX(chapter_number) AS last
        FROM narrative_chapter_mention
        WHERE book_id = ? AND entry_id IS NOT NULL
        GROUP BY entry_id
      `)
      .all(bookId);
    for (const row of rows) {
      touch(row.entry_id, toChapter(row.first));
      touch(row.entry_id, toChapter(row.last));
    }
  }

  let totalMentions = 0;
  let resolvedMentions = 0;
  let foreshadowMentions = 0;
  let nonEntityMentions = 0;
  const unresolvedSamples: string[] = [];

  for (const entry of dictionary.entries) {
    if (entry.category === "foreshadowing") {
      for (const key of entry.lookupKeys) foreshadowKeys.add(normalizeKey(key));
      continue;
    }
    const entityType = ENTITY_TYPE_BY_CATEGORY[entry.category];
    if (!entityType) continue;
    const canonicalKey = normalizeKey(entry.canonicalName);
    // 规范名在同书内唯一（0032 的唯一索引）；撞名的后一个条目如实报告，不静默合并两个人。
    if (usedCanonical.has(canonicalKey)) {
      duplicateEntryIds.push(entry.entryId);
      continue;
    }
    usedCanonical.add(canonicalKey);
    entityByEntryId.set(entry.entryId, entry);
  }

  /** 把一个原始称呼归到经纬条目；伏笔称呼、事件短语、非实体短语只计数。 */
  const classify = (rawName: string): EntityDictionaryEntry | null => {
    if (!looksLikeEntityName(rawName)) return null;
    if (looksLikeEventPhrase(rawName)) {
      nonEntityMentions += 1;
      return null;
    }
    const normalized = normalizeKey(rawName);
    if (foreshadowKeys.has(normalized) || foreshadowKeys.has(normalizeKey(stripParentheticalSuffix(rawName)))) {
      foreshadowMentions += 1;
      return null;
    }
    totalMentions += 1;
    const hit = resolveEntity(dictionary, rawName)?.entry ?? null;
    if (hit && entityByEntryId.has(hit.entryId)) {
      resolvedMentions += 1;
      return hit;
    }
    if (unresolvedSamples.length < 12 && !unresolvedSamples.includes(rawName)) unresolvedSamples.push(rawName);
    return null;
  };

  /** 结算已写入的 entry_id 优先；没有时再按称呼拆分归并。 */
  const resolveSide = (raw: unknown, entryId: unknown): { hits: EntityDictionaryEntry[]; composite: boolean } => {
    if (typeof entryId === "string" && entityByEntryId.has(entryId)) {
      resolvedMentions += 1;
      totalMentions += 1;
      return { hits: [entityByEntryId.get(entryId)!], composite: false };
    }
    const split = splitCompositeSubject(String(raw ?? ""));
    const hits: EntityDictionaryEntry[] = [];
    for (const name of split.names) {
      const hit = classify(name);
      if (hit && !hits.some((existing) => existing.entryId === hit.entryId)) hits.push(hit);
    }
    return { hits, composite: split.composite };
  };

  /**
   * 知情账专用的静默归并：与 classify 同一套判定（实体字典 + 伏笔/事件短语排除），
   * 但不计入称呼链接率的分子分母——知情对象的归并不该改写实体归并统计口径。
   */
  const resolveSideQuiet = (raw: unknown, entryId: unknown): EntityDictionaryEntry[] => {
    if (typeof entryId === "string" && entityByEntryId.has(entryId)) return [entityByEntryId.get(entryId)!];
    const split = splitCompositeSubject(String(raw ?? ""));
    const hits: EntityDictionaryEntry[] = [];
    for (const name of split.names) {
      if (!looksLikeEntityName(name) || looksLikeEventPhrase(name)) continue;
      const normalized = normalizeKey(name);
      if (foreshadowKeys.has(normalized) || foreshadowKeys.has(normalizeKey(stripParentheticalSuffix(name)))) continue;
      const hit = resolveEntity(dictionary, name)?.entry ?? null;
      if (hit && entityByEntryId.has(hit.entryId) && !hits.some((existing) => existing.entryId === hit.entryId)) hits.push(hit);
    }
    return hits;
  };

  // ① 事件 → 参与者
  const participants: ParticipantRow[] = [];
  const participantKeys = new Set<string>();
  const events = storage.sqlite
    .prepare<{ id: string; chapter_number: number; event_type: string; subject: string; object: string; subject_entry_id: string | null; object_entry_id: string | null }>(`
      SELECT id, chapter_number, event_type, subject, object, subject_entry_id, object_entry_id
      FROM narrative_event
      WHERE book_id = ? AND status != 'rejected'
      ORDER BY chapter_number ASC, id ASC
    `)
    .all(bookId);
  for (const event of events) {
    // 只有关系变化与位置变化的对象是实体；其余事件的对象是状态值（「重伤」「被未庄排斥」），
    // 拿去当称呼归并会把归并率压低，还会误导作者去经纬里给状态值建条目（2026-09-30 真模型基准）。
    const sides: Array<readonly ["agent" | "patient", string, string | null]> = [["agent", event.subject, event.subject_entry_id]];
    if (OBJECT_IS_ENTITY_EVENT_TYPES.has(event.event_type)) sides.push(["patient", event.object, event.object_entry_id]);
    for (const [role, raw, entryId] of sides) {
      for (const hit of resolveSide(raw, entryId).hits) {
        const key = `${event.id}\u0000${hit.entryId}\u0000${role}`;
        if (participantKeys.has(key)) continue;
        participantKeys.add(key);
        participants.push({ eventId: event.id, entityId: entityIdFor(bookId, hit.entryId), role });
        touch(hit.entryId, toChapter(event.chapter_number));
      }
    }
  }

  // ② 事实 → 关系边 / 状态流水 / 知情账
  const relations: RelationRow[] = [];
  const relationKeys = new Set<string>();
  const stateChanges: StateChangeRow[] = [];
  const knowledge: KnowledgeRow[] = [];
  // 知情来源只取已确认事实：event 来源要求其来源事件已应用（待审 / 驳回不算）。
  const appliedEventIds = new Set(
    storage.sqlite.prepare<{ id: string }>(
      "SELECT id FROM narrative_event WHERE book_id = ? AND status = 'applied'",
    ).all(bookId).map((row) => row.id),
  );
  const facts = storage.sqlite
    .prepare<{
      id: string; subject: string; predicate: string; object: string; category: string;
      source_type: string; source_id: string | null;
      source_chapter: number | null; valid_from_chapter: number | null; valid_until_chapter: number | null;
      subject_entry_id: string | null; object_entry_id: string | null; evidence_text: string | null; confidence: number | null;
    }>(`
      SELECT id, subject, predicate, object, category, source_type, source_id,
             source_chapter, valid_from_chapter, valid_until_chapter,
             subject_entry_id, object_entry_id, evidence_text, confidence
      FROM narrative_fact
      WHERE book_id = ?
      ORDER BY COALESCE(source_chapter, valid_from_chapter, 0) ASC, id ASC
    `)
    .all(bookId);
  for (const fact of facts) {
    const chapter = toChapter(fact.source_chapter) ?? toChapter(fact.valid_from_chapter);
    const confidence = typeof fact.confidence === "number" ? fact.confidence : 1;
    const evidence = fact.evidence_text?.slice(0, 400) || null;
    const subject = resolveSide(fact.subject, fact.subject_entry_id);

    if (isKnowledgeConfirmed(fact.source_type, fact.source_id, appliedEventIds)) {
      // 知情账：subject 归并到的实体知道；relationship / location 的 object 也是实体（关系事实双方都知道）。
      const knowers = new Set<string>();
      for (const hit of subject.hits) knowers.add(entityIdFor(bookId, hit.entryId));
      if (OBJECT_IS_ENTITY_FACT_CATEGORIES.has(fact.category)) {
        for (const hit of resolveSideQuiet(fact.object, fact.object_entry_id)) knowers.add(entityIdFor(bookId, hit.entryId));
      }
      knowledge.push(...knowledgeRowsForFact({
        factId: fact.id,
        sourceType: fact.source_type,
        sourceId: fact.source_id,
        chapter,
        evidence: fact.evidence_text,
        confidence,
      }, [...knowers]));
    }

    if (fact.category === "relationship") {
      // 关系事实常把双方都写在 subject（「薛行之与方工」），object 是一句关系描述：
      // 边主要来自复合主体内部互连，object 是实体名时再连 subject → object。
      const object = resolveSide(fact.object, fact.object_entry_id);
      const pairs: [EntityDictionaryEntry, EntityDictionaryEntry][] = [];
      if (subject.composite && subject.hits.length > 1) {
        for (let i = 0; i < subject.hits.length; i += 1) {
          for (let j = i + 1; j < subject.hits.length; j += 1) pairs.push([subject.hits[i]!, subject.hits[j]!]);
        }
      }
      for (const source of subject.hits) for (const target of object.hits) pairs.push([source, target]);
      const validFrom = toChapter(fact.valid_from_chapter) ?? chapter;
      const predicate = (fact.predicate || "关联").slice(0, 80);
      for (const [source, target] of pairs) {
        if (source.entryId === target.entryId) continue;
        const subjectId = entityIdFor(bookId, source.entryId);
        const objectId = entityIdFor(bookId, target.entryId);
        const key = `${subjectId}\u0000${predicate}\u0000${objectId}\u0000${validFrom ?? ""}`;
        if (relationKeys.has(key)) continue;
        relationKeys.add(key);
        relations.push({
          id: `rel:${fact.id}:${source.entryId}:${target.entryId}`.slice(0, 240),
          subjectId, predicate, objectId, validFrom,
          validTo: toChapter(fact.valid_until_chapter),
          sourceEventId: null, evidence, confidence,
        });
      }
      continue;
    }

    if ((fact.category === "character_state" || fact.category === "location") && chapter !== null) {
      for (const hit of subject.hits) {
        stateChanges.push({
          id: `st:${fact.id}:${hit.entryId}`.slice(0, 240),
          entityId: entityIdFor(bookId, hit.entryId),
          fluent: (fact.predicate || "状态").slice(0, 80),
          newValue: String(fact.object ?? "").slice(0, 400),
          chapter, evidence, confidence,
        });
        touch(hit.entryId, chapter);
      }
    }
  }

  for (const entry of entityByEntryId.values()) {
    const span = chapterSpan.get(entry.entryId);
    entities.push({
      id: entityIdFor(bookId, entry.entryId),
      entryId: entry.entryId,
      canonicalName: entry.canonicalName,
      entityType: ENTITY_TYPE_BY_CATEGORY[entry.category]!,
      aliases: entry.lookupKeys.filter((key) => normalizeKey(key) !== normalizeKey(entry.canonicalName)),
      firstChapter: span?.first ?? null,
      lastChapter: span?.last ?? null,
    });
  }

  return {
    entities,
    relations,
    stateChanges,
    participants,
    knowledge,
    stats: {
      entities: entities.length,
      aliases: entities.reduce((sum, entity) => sum + entity.aliases.length + 1, 0),
      participants: participants.length,
      relations: relations.length,
      stateChanges: stateChanges.length,
      knowledge: knowledge.length,
      totalMentions,
      resolvedMentions,
      foreshadowMentions,
      nonEntityMentions,
      unresolvedSamples,
      duplicateEntryIds,
    },
  };
}

/**
 * 整本重建：一个事务里清掉本书旧索引再写入新推导结果，失败整体回滚、旧索引原样保留。
 * narrative_knowledge 外键指向实体；它与五张索引表同一份推导来源，同一个事务里整体重写。
 */
export function rebuildNarrativeEntityIndex(
  storage: StorageDatabase,
  bookId: string,
  options: { readonly dryRun?: boolean; readonly now?: number } = {},
): EntityIndexRebuildResult {
  // 事实 / 事件表由运行时建表（不走编号迁移），与其他叙事记忆存取一样先确保存在。
  ensureNarrativeMemorySchema(storage);
  if (!INDEX_TABLES.every((table) => tableExists(storage, table))) {
    return {
      ok: false,
      bookId,
      reason: "schema-missing",
      explanation: "这个数据库还没有实体索引相关的表（迁移 0032 未执行），本次跳过实体归并；正文、事实与事件不受影响。",
    };
  }
  const plan = planNarrativeEntityIndex(storage, bookId);
  if (options.dryRun) return { ok: true, bookId, applied: false, ...plan.stats };

  const now = options.now ?? Date.now();
  const db = storage.sqlite;
  const insertEntity = db.prepare(`
    INSERT INTO narrative_entity
      (id, book_id, canonical_name, entity_type, aliases_json, attrs_json, entry_id, first_chapter, last_chapter,
       lifecycle, source, confidence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, 'active', 'settlement', 1.0, ?, ?)
  `);
  const insertAlias = db.prepare(`
    INSERT INTO narrative_entity_alias (book_id, alias, entity_id, confidence)
    VALUES (?, ?, ?, 1.0)
    ON CONFLICT(book_id, alias) DO NOTHING
  `);
  const insertParticipant = db.prepare(`
    INSERT INTO narrative_event_participant (book_id, event_id, entity_id, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id, entity_id, role) DO NOTHING
  `);
  const insertRelation = db.prepare(`
    INSERT INTO narrative_relation
      (id, book_id, subject_id, predicate, object_id, relation_kind, valid_from, valid_to, source_event_id,
       evidence_text, confidence, recorded_at)
    VALUES (?, ?, ?, ?, ?, 'relationship', ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);
  const insertState = db.prepare(`
    INSERT INTO narrative_state_change
      (id, book_id, entity_id, fluent, new_value, chapter_number, evidence_text, confidence, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertKnowledge = db.prepare(`
    INSERT INTO narrative_knowledge
      (id, book_id, knower_id, fact_kind, fact_ref, knows_from, knows_until, certainty, evidence_text, recorded_at)
    VALUES (?, ?, ?, 'fact', ?, ?, NULL, 'knows', ?, ?)
  `);

  db.transaction(() => {
    // 子表先删，父表后删，不依赖连接上是否开启外键级联
    for (const table of ["narrative_knowledge", "narrative_event_participant", "narrative_relation", "narrative_state_change", "narrative_entity_alias", "narrative_entity"]) {
      db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(bookId);
    }
    for (const entity of plan.entities) {
      insertEntity.run(
        entity.id, bookId, entity.canonicalName, entity.entityType, JSON.stringify(entity.aliases),
        entity.entryId, entity.firstChapter, entity.lastChapter, now, now,
      );
      for (const alias of [entity.canonicalName, ...entity.aliases]) insertAlias.run(bookId, alias, entity.id);
    }
    for (const participant of plan.participants) {
      insertParticipant.run(bookId, participant.eventId, participant.entityId, participant.role);
    }
    for (const relation of plan.relations) {
      insertRelation.run(
        relation.id, bookId, relation.subjectId, relation.predicate, relation.objectId, relation.validFrom,
        relation.validTo, relation.sourceEventId, relation.evidence, relation.confidence, now,
      );
    }
    for (const change of plan.stateChanges) {
      insertState.run(change.id, bookId, change.entityId, change.fluent, change.newValue, change.chapter, change.evidence, change.confidence, now);
    }
    for (const row of plan.knowledge) {
      insertKnowledge.run(row.id, bookId, row.entityId, row.factRef, row.knowsFrom, row.evidence, now);
    }
  })();

  return { ok: true, bookId, applied: true, ...plan.stats };
}
