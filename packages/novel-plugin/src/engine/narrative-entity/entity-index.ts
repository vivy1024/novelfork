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

import { createHash } from "node:crypto";

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
  derivedRowId,
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

// ─── 称呼归并备忘 ──────────────────────────────────────────────────────────
//
// 推导里最贵的是逐条称呼跑正则判定 + 字典归并；同一个称呼在几百章里反复出现，
// 而判定结果只取决于称呼本身和本书实体字典。所以按「字典内容指纹」备忘：
// 字典一变（改名、加别名、新伏笔草稿）指纹就变，旧备忘整体作废，不存在过期结果。
// 备忘只省计算，不改变推导：计数器每次照常按调用顺序累加。

type NameOutcome =
  | { readonly kind: "ignored" | "event-phrase" | "foreshadow" | "unresolved" }
  | { readonly kind: "resolved"; readonly entryId: string };

interface ResolutionMemo {
  readonly fingerprint: string;
  readonly outcomes: Map<string, NameOutcome>;
  readonly splits: Map<string, { names: string[]; composite: boolean }>;
}

/** 每个数据库连接最多备忘几本书（LRU）；单本书最多备忘多少个称呼，超出清空重来。 */
const MAX_MEMO_BOOKS = 16;
const MAX_MEMO_NAMES = 200_000;
const resolutionMemos = new WeakMap<StorageDatabase, Map<string, ResolutionMemo>>();

function dictionaryFingerprint(dictionary: EntityDictionary): string {
  const hash = createHash("sha256");
  for (const entry of dictionary.entries) {
    hash.update(JSON.stringify([entry.entryId, entry.category, entry.canonicalName, entry.lookupKeys]));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function resolutionMemoFor(storage: StorageDatabase, bookId: string, fingerprint: string): ResolutionMemo {
  let books = resolutionMemos.get(storage);
  if (!books) {
    books = new Map();
    resolutionMemos.set(storage, books);
  }
  const existing = books.get(bookId);
  books.delete(bookId);
  const memo = existing && existing.fingerprint === fingerprint && existing.outcomes.size + existing.splits.size < MAX_MEMO_NAMES
    ? existing
    : { fingerprint, outcomes: new Map(), splits: new Map() };
  books.set(bookId, memo);
  while (books.size > MAX_MEMO_BOOKS) books.delete(books.keys().next().value!);
  return memo;
}

/**
 * 只读推导：不写库。rebuild 在它之上写入本书索引；dry-run（回填脚本）直接看 stats。
 */
export function planNarrativeEntityIndex(storage: StorageDatabase, bookId: string): EntityIndexPlan {
  const dictionary: EntityDictionary = buildEntityDictionary(storage, bookId);
  const memo = resolutionMemoFor(storage, bookId, dictionaryFingerprint(dictionary));

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

  /** 一个称呼的归并判定（只取决于称呼与字典，可备忘）。 */
  const outcomeOf = (rawName: string): NameOutcome => {
    const cached = memo.outcomes.get(rawName);
    if (cached) return cached;
    let outcome: NameOutcome;
    if (!looksLikeEntityName(rawName)) outcome = { kind: "ignored" };
    else if (looksLikeEventPhrase(rawName)) outcome = { kind: "event-phrase" };
    else if (foreshadowKeys.has(normalizeKey(rawName)) || foreshadowKeys.has(normalizeKey(stripParentheticalSuffix(rawName)))) outcome = { kind: "foreshadow" };
    else {
      const hit = resolveEntity(dictionary, rawName)?.entry ?? null;
      outcome = hit && entityByEntryId.has(hit.entryId) ? { kind: "resolved", entryId: hit.entryId } : { kind: "unresolved" };
    }
    memo.outcomes.set(rawName, outcome);
    return outcome;
  };

  const splitOf = (raw: unknown): { names: string[]; composite: boolean } => {
    const text = String(raw ?? "");
    const cached = memo.splits.get(text);
    if (cached) return cached;
    const split = splitCompositeSubject(text);
    memo.splits.set(text, split);
    return split;
  };

  /** 把一个原始称呼归到经纬条目；伏笔称呼、事件短语、非实体短语只计数。 */
  const classify = (rawName: string): EntityDictionaryEntry | null => {
    const outcome = outcomeOf(rawName);
    switch (outcome.kind) {
      case "ignored":
        return null;
      case "event-phrase":
        nonEntityMentions += 1;
        return null;
      case "foreshadow":
        foreshadowMentions += 1;
        return null;
      case "resolved":
        totalMentions += 1;
        resolvedMentions += 1;
        return entityByEntryId.get(outcome.entryId)!;
      case "unresolved":
        totalMentions += 1;
        if (unresolvedSamples.length < 12 && !unresolvedSamples.includes(rawName)) unresolvedSamples.push(rawName);
        return null;
    }
  };

  /** 结算已写入的 entry_id 优先；没有时再按称呼拆分归并。 */
  const resolveSide = (raw: unknown, entryId: unknown): { hits: EntityDictionaryEntry[]; composite: boolean } => {
    if (typeof entryId === "string" && entityByEntryId.has(entryId)) {
      resolvedMentions += 1;
      totalMentions += 1;
      return { hits: [entityByEntryId.get(entryId)!], composite: false };
    }
    const split = splitOf(raw);
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
    const split = splitOf(raw);
    const hits: EntityDictionaryEntry[] = [];
    for (const name of split.names) {
      const outcome = outcomeOf(name);
      if (outcome.kind !== "resolved") continue;
      if (!hits.some((existing) => existing.entryId === outcome.entryId)) hits.push(entityByEntryId.get(outcome.entryId)!);
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
          id: derivedRowId(`rel:${fact.id}:${source.entryId}:${target.entryId}`),
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
          id: derivedRowId(`st:${fact.id}:${hit.entryId}`),
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

// ─── 写入：整本重写与差量写回 ──────────────────────────────────────────────
//
// 推导只有 planNarrativeEntityIndex 一个来源；两种写法写出来的行逐项相同，区别只在写多少：
// - rebuild：清空本书六张表再全量插入（显式重建、导入、删章这些批量入口）。
// - refresh：与「库里现有的索引行」逐行比对，只删 / 改 / 插变化的行（每章结算）。
//   现有行优先取进程内快照（上次写完时记下的）；快照不可信时从库里读回再比对，不会整本重写。
// 时间戳列（created_at / updated_at / recorded_at）记的是行最后一次写入的时刻，不参与比对：
// 整本重写时全书同一时刻，差量写回时只有变化的行刷新。

interface DesiredRow<T> {
  readonly signature: string;
  readonly row: T;
}

interface AliasRow {
  readonly alias: string;
  readonly entityId: string;
}

/** 六张表按主键（或唯一键）组织的目标行集合；与 INSERT … ON CONFLICT DO NOTHING 一样先到先得。 */
interface DesiredIndex {
  readonly entities: Map<string, DesiredRow<EntityRow>>;
  readonly aliases: Map<string, DesiredRow<AliasRow>>;
  readonly participants: Map<string, DesiredRow<ParticipantRow>>;
  readonly relations: Map<string, DesiredRow<RelationRow>>;
  readonly stateChanges: Map<string, DesiredRow<StateChangeRow>>;
  readonly knowledge: Map<string, DesiredRow<KnowledgeRow>>;
}

type SignatureIndex = { readonly [K in keyof DesiredIndex]: Map<string, string> };

const entitySignature = (values: readonly unknown[]) => JSON.stringify(values);
const participantKey = (eventId: string, entityId: string, role: string) => `${eventId}\u0000${entityId}\u0000${role}`;

function desiredIndexFromPlan(plan: EntityIndexPlan): DesiredIndex {
  const entities = new Map<string, DesiredRow<EntityRow>>();
  const aliases = new Map<string, DesiredRow<AliasRow>>();
  for (const entity of plan.entities) {
    if (entities.has(entity.id)) continue;
    entities.set(entity.id, {
      row: entity,
      signature: entitySignature([entity.canonicalName, entity.entityType, JSON.stringify(entity.aliases), "{}", entity.entryId, entity.firstChapter, entity.lastChapter, "active", "settlement", 1]),
    });
    for (const alias of [entity.canonicalName, ...entity.aliases]) {
      if (aliases.has(alias)) continue;
      aliases.set(alias, { row: { alias, entityId: entity.id }, signature: entitySignature([entity.id, 1]) });
    }
  }
  const participants = new Map<string, DesiredRow<ParticipantRow>>();
  for (const participant of plan.participants) {
    const key = participantKey(participant.eventId, participant.entityId, participant.role);
    if (!participants.has(key)) participants.set(key, { row: participant, signature: "" });
  }
  const relations = new Map<string, DesiredRow<RelationRow>>();
  const relationTriples = new Set<string>();
  for (const relation of plan.relations) {
    // 唯一索引 (book_id, subject_id, predicate, object_id, valid_from)：valid_from 为空时 SQLite 不判重
    const triple = relation.validFrom === null ? null : `${relation.subjectId}\u0000${relation.predicate}\u0000${relation.objectId}\u0000${relation.validFrom}`;
    if (relations.has(relation.id) || (triple !== null && relationTriples.has(triple))) continue;
    if (triple !== null) relationTriples.add(triple);
    relations.set(relation.id, {
      row: relation,
      signature: entitySignature([relation.subjectId, relation.predicate, relation.objectId, "relationship", null, relation.validFrom, relation.validTo, relation.sourceEventId, relation.evidence, relation.confidence, null]),
    });
  }
  const stateChanges = new Map<string, DesiredRow<StateChangeRow>>();
  for (const change of plan.stateChanges) {
    if (stateChanges.has(change.id)) continue;
    stateChanges.set(change.id, {
      row: change,
      signature: entitySignature([change.entityId, change.fluent, null, change.newValue, change.chapter, null, change.evidence, change.confidence]),
    });
  }
  const knowledge = new Map<string, DesiredRow<KnowledgeRow>>();
  for (const row of plan.knowledge) {
    if (knowledge.has(row.id)) continue;
    knowledge.set(row.id, { row, signature: entitySignature([row.entityId, "fact", row.factRef, row.knowsFrom, null, "knows", row.evidence]) });
  }
  return { entities, aliases, participants, relations, stateChanges, knowledge };
}

function signaturesOf(desired: DesiredIndex): SignatureIndex {
  const pick = <T>(map: Map<string, DesiredRow<T>>) => new Map([...map].map(([key, value]) => [key, value.signature] as const));
  return {
    entities: pick(desired.entities),
    aliases: pick(desired.aliases),
    participants: pick(desired.participants),
    relations: pick(desired.relations),
    stateChanges: pick(desired.stateChanges),
    knowledge: pick(desired.knowledge),
  };
}

/** 从库里读回本书现有索引行，按与 desiredIndexFromPlan 相同的签名规则组织。 */
function readIndexSignatures(storage: StorageDatabase, bookId: string): SignatureIndex {
  const db = storage.sqlite;
  const entities = new Map<string, string>();
  for (const row of db.prepare<Record<string, unknown>>(`
    SELECT id, canonical_name, entity_type, aliases_json, attrs_json, entry_id, first_chapter, last_chapter, lifecycle, source, confidence
    FROM narrative_entity WHERE book_id = ?
  `).all(bookId)) {
    entities.set(String(row.id), entitySignature([row.canonical_name, row.entity_type, row.aliases_json, row.attrs_json, row.entry_id, row.first_chapter, row.last_chapter, row.lifecycle, row.source, row.confidence]));
  }
  const aliases = new Map<string, string>();
  for (const row of db.prepare<Record<string, unknown>>("SELECT alias, entity_id, confidence FROM narrative_entity_alias WHERE book_id = ?").all(bookId)) {
    aliases.set(String(row.alias), entitySignature([row.entity_id, row.confidence]));
  }
  const participants = new Map<string, string>();
  for (const row of db.prepare<Record<string, unknown>>("SELECT event_id, entity_id, role FROM narrative_event_participant WHERE book_id = ?").all(bookId)) {
    participants.set(participantKey(String(row.event_id), String(row.entity_id), String(row.role)), "");
  }
  const relations = new Map<string, string>();
  for (const row of db.prepare<Record<string, unknown>>(`
    SELECT id, subject_id, predicate, object_id, relation_kind, sentiment, valid_from, valid_to, source_event_id, evidence_text, confidence, invalidated_at
    FROM narrative_relation WHERE book_id = ?
  `).all(bookId)) {
    relations.set(String(row.id), entitySignature([row.subject_id, row.predicate, row.object_id, row.relation_kind, row.sentiment, row.valid_from, row.valid_to, row.source_event_id, row.evidence_text, row.confidence, row.invalidated_at]));
  }
  const stateChanges = new Map<string, string>();
  for (const row of db.prepare<Record<string, unknown>>(`
    SELECT id, entity_id, fluent, old_value, new_value, chapter_number, event_id, evidence_text, confidence
    FROM narrative_state_change WHERE book_id = ?
  `).all(bookId)) {
    stateChanges.set(String(row.id), entitySignature([row.entity_id, row.fluent, row.old_value, row.new_value, row.chapter_number, row.event_id, row.evidence_text, row.confidence]));
  }
  const knowledge = new Map<string, string>();
  for (const row of db.prepare<Record<string, unknown>>(`
    SELECT id, knower_id, fact_kind, fact_ref, knows_from, knows_until, certainty, evidence_text
    FROM narrative_knowledge WHERE book_id = ?
  `).all(bookId)) {
    knowledge.set(String(row.id), entitySignature([row.knower_id, row.fact_kind, row.fact_ref, row.knows_from, row.knows_until, row.certainty, row.evidence_text]));
  }
  return { entities, aliases, participants, relations, stateChanges, knowledge };
}

// ─── 进程内快照 ────────────────────────────────────────────────────────────
//
// 记下上次写完时本书六张表的行签名，以及一个廉价的「库指纹」：每张表本书的行数与最大 rowid，
// 加上 PRAGMA data_version（别的连接提交过写入就会变）。下次差量写回前先比指纹，
// 对不上（进程重启、删书后同 id 重建、别处动过这几张表）就从库里读回，绝不拿过期快照去比对。

interface IndexSnapshot {
  readonly fingerprint: string;
  readonly signatures: SignatureIndex;
}

const MAX_SNAPSHOT_BOOKS = 8;
const indexSnapshots = new WeakMap<StorageDatabase, Map<string, IndexSnapshot>>();

function indexFingerprint(storage: StorageDatabase, bookId: string): string {
  const parts: unknown[] = [storage.sqlite.pragma("data_version", { simple: true })];
  for (const table of INDEX_TABLES) {
    const row = storage.sqlite
      .prepare<{ n: number; maxRowid: number | null }>(`SELECT COUNT(*) AS n, MAX(rowid) AS maxRowid FROM ${table} WHERE book_id = ?`)
      .get(bookId);
    parts.push(row?.n ?? 0, row?.maxRowid ?? null);
  }
  return JSON.stringify(parts);
}

function rememberSnapshot(storage: StorageDatabase, bookId: string, signatures: SignatureIndex): void {
  let books = indexSnapshots.get(storage);
  if (!books) {
    books = new Map();
    indexSnapshots.set(storage, books);
  }
  books.delete(bookId);
  books.set(bookId, { fingerprint: indexFingerprint(storage, bookId), signatures });
  while (books.size > MAX_SNAPSHOT_BOOKS) books.delete(books.keys().next().value!);
}

function forgetSnapshot(storage: StorageDatabase, bookId: string): void {
  indexSnapshots.get(storage)?.delete(bookId);
}

function currentSignatures(storage: StorageDatabase, bookId: string): { readonly signatures: SignatureIndex; readonly source: "snapshot" | "database" } {
  const snapshot = indexSnapshots.get(storage)?.get(bookId);
  if (snapshot && snapshot.fingerprint === indexFingerprint(storage, bookId)) return { signatures: snapshot.signatures, source: "snapshot" };
  return { signatures: readIndexSignatures(storage, bookId), source: "database" };
}

export interface EntityIndexWriteStats {
  /** full = 清空重写；diff = 只写变化的行。 */
  readonly mode: "full" | "diff";
  /** diff 模式下比对基准的来源：进程内快照，或从库里读回。 */
  readonly baseline?: "snapshot" | "database";
  readonly inserted: number;
  readonly updated: number;
  readonly deleted: number;
}

function schemaMissing(bookId: string): EntityIndexRebuildResult {
  return {
    ok: false,
    bookId,
    reason: "schema-missing",
    explanation: "这个数据库还没有实体索引相关的表（迁移 0032 未执行），本次跳过实体归并；正文、事实与事件不受影响。",
  };
}

/**
 * 差量刷新（每章结算用）：推导与 rebuild 完全相同，只把与库里现有索引不同的行写回。
 * 一个事务内完成，失败整体回滚、旧索引原样保留；结果与整本重建逐项一致（时间戳列除外）。
 */
export function refreshNarrativeEntityIndex(
  storage: StorageDatabase,
  bookId: string,
  options: { readonly now?: number } = {},
): EntityIndexRebuildResult & { readonly write?: EntityIndexWriteStats } {
  ensureNarrativeMemorySchema(storage);
  if (!INDEX_TABLES.every((table) => tableExists(storage, table))) return schemaMissing(bookId);
  const plan = planNarrativeEntityIndex(storage, bookId);
  const desired = desiredIndexFromPlan(plan);
  const now = options.now ?? Date.now();
  const db = storage.sqlite;

  let write: EntityIndexWriteStats;
  try {
    write = db.transaction(() => {
      const current = currentSignatures(storage, bookId);
      const counts = applyIndexDiff(storage, bookId, current.signatures, desired, now);
      return { mode: "diff" as const, baseline: current.source, ...counts };
    })();
  } catch (error) {
    // 回滚后库里是旧索引，快照可能已不对应；下次从库里读回
    forgetSnapshot(storage, bookId);
    throw error;
  }
  rememberSnapshot(storage, bookId, signaturesOf(desired));
  return { ok: true, bookId, applied: true, ...plan.stats, write };
}

function applyIndexDiff(
  storage: StorageDatabase,
  bookId: string,
  current: SignatureIndex,
  desired: DesiredIndex,
  now: number,
): { inserted: number; updated: number; deleted: number } {
  const db = storage.sqlite;
  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  /** 分出：要删的旧键、要新插的键、签名变了的键。 */
  const split = <T>(currentRows: Map<string, string>, desiredRows: Map<string, DesiredRow<T>>) => {
    const removed: string[] = [];
    const added: string[] = [];
    const changed: string[] = [];
    for (const key of currentRows.keys()) if (!desiredRows.has(key)) removed.push(key);
    for (const [key, value] of desiredRows) {
      const existing = currentRows.get(key);
      if (existing === undefined) added.push(key);
      else if (existing !== value.signature) changed.push(key);
    }
    return { removed, added, changed };
  };

  const entityDiff = split(current.entities, desired.entities);
  const aliasDiff = split(current.aliases, desired.aliases);
  const participantDiff = split(current.participants, desired.participants);
  const relationDiff = split(current.relations, desired.relations);
  const stateDiff = split(current.stateChanges, desired.stateChanges);
  const knowledgeDiff = split(current.knowledge, desired.knowledge);

  // ① 子表：删掉不再需要的行；签名变了的行也先删（后面重插），避免唯一键在逐行更新时互相顶撞
  const deleteParticipant = db.prepare("DELETE FROM narrative_event_participant WHERE book_id = ? AND event_id = ? AND entity_id = ? AND role = ?");
  for (const key of participantDiff.removed) {
    const [eventId, entityId, role] = key.split("\u0000");
    deleted += Number(deleteParticipant.run(bookId, eventId, entityId, role).changes);
  }
  const deleteById = (table: string, ids: readonly string[]) => {
    const statement = db.prepare(`DELETE FROM ${table} WHERE book_id = ? AND id = ?`);
    for (const id of ids) statement.run(bookId, id);
  };
  deleteById("narrative_knowledge", [...knowledgeDiff.removed, ...knowledgeDiff.changed]);
  deleteById("narrative_relation", [...relationDiff.removed, ...relationDiff.changed]);
  deleteById("narrative_state_change", [...stateDiff.removed, ...stateDiff.changed]);
  deleted += knowledgeDiff.removed.length + relationDiff.removed.length + stateDiff.removed.length;
  // 别名改指向时也先删后插：它原先指向的实体若在下面被删，外键级联会先把别名删掉，原地 UPDATE 就会落空
  const deleteAlias = db.prepare("DELETE FROM narrative_entity_alias WHERE book_id = ? AND alias = ?");
  for (const alias of aliasDiff.removed) deleted += Number(deleteAlias.run(bookId, alias).changes);
  for (const alias of aliasDiff.changed) deleteAlias.run(bookId, alias);

  // ② 实体：先删、再改、最后插。改名可能与另一实体「互换」规范名，先挪到占位名再写终值，避开唯一索引
  deleteById("narrative_entity", entityDiff.removed);
  deleted += entityDiff.removed.length;
  const placeholder = db.prepare("UPDATE narrative_entity SET canonical_name = ? WHERE book_id = ? AND id = ?");
  for (const id of entityDiff.changed) placeholder.run(`\u0000renaming:${id}`, bookId, id);
  const updateEntity = db.prepare(`
    UPDATE narrative_entity
    SET canonical_name = ?, entity_type = ?, aliases_json = ?, attrs_json = '{}', entry_id = ?, first_chapter = ?, last_chapter = ?,
        lifecycle = 'active', source = 'settlement', confidence = 1.0, updated_at = ?
    WHERE book_id = ? AND id = ?
  `);
  for (const id of entityDiff.changed) {
    const entity = desired.entities.get(id)!.row;
    updateEntity.run(entity.canonicalName, entity.entityType, JSON.stringify(entity.aliases), entity.entryId, entity.firstChapter, entity.lastChapter, now, bookId, id);
  }
  updated += entityDiff.changed.length;
  const statements = insertStatements(storage);
  for (const id of entityDiff.added) {
    const entity = desired.entities.get(id)!.row;
    statements.entity.run(entity.id, bookId, entity.canonicalName, entity.entityType, JSON.stringify(entity.aliases), entity.entryId, entity.firstChapter, entity.lastChapter, now, now);
  }
  inserted += entityDiff.added.length;

  // ③ 别名与子表：插新行、重插签名变了的行
  for (const alias of aliasDiff.changed) statements.alias.run(bookId, alias, desired.aliases.get(alias)!.row.entityId);
  updated += aliasDiff.changed.length;
  for (const alias of aliasDiff.added) statements.alias.run(bookId, alias, desired.aliases.get(alias)!.row.entityId);
  inserted += aliasDiff.added.length;
  for (const key of participantDiff.added) {
    const participant = desired.participants.get(key)!.row;
    statements.participant.run(bookId, participant.eventId, participant.entityId, participant.role);
  }
  inserted += participantDiff.added.length;
  for (const id of [...relationDiff.changed, ...relationDiff.added]) {
    const relation = desired.relations.get(id)!.row;
    statements.relation.run(relation.id, bookId, relation.subjectId, relation.predicate, relation.objectId, relation.validFrom, relation.validTo, relation.sourceEventId, relation.evidence, relation.confidence, now);
  }
  for (const id of [...stateDiff.changed, ...stateDiff.added]) {
    const change = desired.stateChanges.get(id)!.row;
    statements.state.run(change.id, bookId, change.entityId, change.fluent, change.newValue, change.chapter, change.evidence, change.confidence, now);
  }
  for (const id of [...knowledgeDiff.changed, ...knowledgeDiff.added]) {
    const row = desired.knowledge.get(id)!.row;
    statements.knowledge.run(row.id, bookId, row.entityId, row.factRef, row.knowsFrom, row.evidence, now);
  }
  inserted += relationDiff.added.length + stateDiff.added.length + knowledgeDiff.added.length;
  updated += relationDiff.changed.length + stateDiff.changed.length + knowledgeDiff.changed.length;
  return { inserted, updated, deleted };
}

function insertStatements(storage: StorageDatabase) {
  const db = storage.sqlite;
  return {
    entity: db.prepare(`
      INSERT INTO narrative_entity
        (id, book_id, canonical_name, entity_type, aliases_json, attrs_json, entry_id, first_chapter, last_chapter,
         lifecycle, source, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, 'active', 'settlement', 1.0, ?, ?)
    `),
    alias: db.prepare(`
      INSERT INTO narrative_entity_alias (book_id, alias, entity_id, confidence)
      VALUES (?, ?, ?, 1.0)
      ON CONFLICT(book_id, alias) DO NOTHING
    `),
    participant: db.prepare(`
      INSERT INTO narrative_event_participant (book_id, event_id, entity_id, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id, entity_id, role) DO NOTHING
    `),
    relation: db.prepare(`
      INSERT INTO narrative_relation
        (id, book_id, subject_id, predicate, object_id, relation_kind, valid_from, valid_to, source_event_id,
         evidence_text, confidence, recorded_at)
      VALUES (?, ?, ?, ?, ?, 'relationship', ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `),
    state: db.prepare(`
      INSERT INTO narrative_state_change
        (id, book_id, entity_id, fluent, new_value, chapter_number, evidence_text, confidence, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `),
    knowledge: db.prepare(`
      INSERT INTO narrative_knowledge
        (id, book_id, knower_id, fact_kind, fact_ref, knows_from, knows_until, certainty, evidence_text, recorded_at)
      VALUES (?, ?, ?, 'fact', ?, ?, NULL, 'knows', ?, ?)
    `),
  };
}

/**
 * 整本重建：一个事务里清掉本书旧索引再写入新推导结果，失败整体回滚、旧索引原样保留。
 * narrative_knowledge 外键指向实体；它与五张索引表同一份推导来源，同一个事务里整体重写。
 * 显式重建、导入、删章这些批量入口用它；每章结算用 refreshNarrativeEntityIndex（结果相同，只写变化的行）。
 */
export function rebuildNarrativeEntityIndex(
  storage: StorageDatabase,
  bookId: string,
  options: { readonly dryRun?: boolean; readonly now?: number } = {},
): EntityIndexRebuildResult & { readonly write?: EntityIndexWriteStats } {
  // 事实 / 事件表由运行时建表（不走编号迁移），与其他叙事记忆存取一样先确保存在。
  ensureNarrativeMemorySchema(storage);
  if (!INDEX_TABLES.every((table) => tableExists(storage, table))) return schemaMissing(bookId);
  const plan = planNarrativeEntityIndex(storage, bookId);
  if (options.dryRun) return { ok: true, bookId, applied: false, ...plan.stats };

  const now = options.now ?? Date.now();
  const db = storage.sqlite;
  const desired = desiredIndexFromPlan(plan);
  const statements = insertStatements(storage);
  const insertEntity = statements.entity;
  const insertAlias = statements.alias;
  const insertParticipant = statements.participant;
  const insertRelation = statements.relation;
  const insertState = statements.state;
  const insertKnowledge = statements.knowledge;

  try {
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
  } catch (error) {
    forgetSnapshot(storage, bookId);
    throw error;
  }
  rememberSnapshot(storage, bookId, signaturesOf(desired));
  const rowCount = (map: Map<string, unknown>) => map.size;
  const write: EntityIndexWriteStats = {
    mode: "full",
    inserted: rowCount(desired.entities) + rowCount(desired.aliases) + rowCount(desired.participants) + rowCount(desired.relations) + rowCount(desired.stateChanges) + rowCount(desired.knowledge),
    updated: 0,
    deleted: 0,
  };
  return { ok: true, bookId, applied: true, ...plan.stats, write };
}
