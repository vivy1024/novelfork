/**
 * 叙事实体索引（T4.1）—— 由经纬条目与叙事记忆派生、可随时整本重建的身份索引。
 *
 * 权威关系：
 * - 实体身份的唯一权威是经纬条目（角色 / 地点 / 势力 / 道具）。本索引不接受任何独立写入，
 *   全部从经纬条目 + narrative_fact + narrative_event + narrative_chapter_mention 推导，所以不存在「两边不同步」。
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
 *
 * 推导有两条路径，结果逐行相同（等价性测试 entity-index-incremental.test.ts 逐章比对）：
 * - 整本推导：读全书事件 / 事实 / 出场名单逐行推导。显式重建、导入、删章、改写重结算、
 *   实体字典变化（经纬条目 / 别名改动、新伏笔草稿）以及下面列出的任何不确定情况都走这条。
 * - 增量推导（每章结算）：只重算上次刷新之后被写过的事件、事实、出场章，与进程内保存的推导状态合并。
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
import { normalizeStateFact } from "../narrative-memory/state-predicate.js";
import {
  ensureEntityIndexChangeTracking,
  markEntityIndexSynced,
  readEntityIndexChanges,
  type EntityIndexChanges,
} from "./entity-index-changes.js";
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

// ─── 推导上下文与逐行贡献 ─────────────────────────────────────────────────
//
// 推导拆成两层：
// - 逐行贡献：一个事件 / 一条事实各自推出哪些参与者、关系候选、状态流水、知情行、出场章与称呼计数。
//   一行的贡献只取决于这一行本身、本书实体字典（指纹）以及（事实的）来源事件是否已应用。
// - 汇总：按 SQL 的排序把贡献拼起来——关系边同键先到先得、实体首末章取全部出场章的最小 / 最大值、
//   未归并样例取前 12 个。
// 整本推导与增量推导共用同一套逐行贡献，区别只在「重算哪些行」。

interface Counters {
  total: number;
  resolved: number;
  foreshadow: number;
  nonEntity: number;
}

interface DerivationContext {
  readonly bookId: string;
  readonly dictionary: EntityDictionary;
  readonly fingerprint: string;
  readonly memo: ResolutionMemo;
  readonly foreshadowKeys: ReadonlySet<string>;
  readonly entityByEntryId: ReadonlyMap<string, EntityDictionaryEntry>;
  readonly duplicateEntryIds: readonly string[];
}

/** 一行贡献的称呼统计：计数 + 按出现顺序的未归并称呼。 */
interface MentionSink {
  readonly counters: Counters;
  readonly unresolved: string[];
}

interface EventContribution {
  readonly id: string;
  /** narrative_event.chapter_number 原值（排序键）。 */
  readonly order: number;
  readonly participants: readonly ParticipantRow[];
  readonly touches: readonly (readonly [string, number])[];
  readonly sink: MentionSink;
}

interface FactContribution {
  readonly id: string;
  /** COALESCE(source_chapter, valid_from_chapter, 0) 原值（排序键）。 */
  readonly order: number;
  /** 本事实内部已按关系键去重的关系候选（跨事实同键时由排序靠前的事实胜出）。 */
  readonly relations: readonly { readonly key: string; readonly row: RelationRow }[];
  readonly stateChanges: readonly StateChangeRow[];
  readonly knowledge: readonly KnowledgeRow[];
  readonly touches: readonly (readonly [string, number])[];
  readonly sink: MentionSink;
}

interface EventSourceRow {
  readonly id: string;
  readonly chapter_number: number;
  readonly event_type: string;
  readonly subject: string;
  readonly object: string;
  readonly subject_entry_id: string | null;
  readonly object_entry_id: string | null;
}

interface FactSourceRow {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: string;
  readonly source_type: string;
  readonly source_id: string | null;
  readonly source_chapter: number | null;
  readonly valid_from_chapter: number | null;
  readonly valid_until_chapter: number | null;
  readonly subject_entry_id: string | null;
  readonly object_entry_id: string | null;
  readonly evidence_text: string | null;
  readonly confidence: number | null;
  readonly sort_key: unknown;
}

const EVENT_COLUMNS = "id, chapter_number, event_type, subject, object, subject_entry_id, object_entry_id";
const FACT_COLUMNS = `id, subject, predicate, object, category, source_type, source_id,
             source_chapter, valid_from_chapter, valid_until_chapter,
             subject_entry_id, object_entry_id, evidence_text, confidence,
             COALESCE(source_chapter, valid_from_chapter, 0) AS sort_key`;

function emptyCounters(): Counters {
  return { total: 0, resolved: 0, foreshadow: 0, nonEntity: 0 };
}

function addCounters(target: Counters, source: Counters, sign: 1 | -1): void {
  target.total += sign * source.total;
  target.resolved += sign * source.resolved;
  target.foreshadow += sign * source.foreshadow;
  target.nonEntity += sign * source.nonEntity;
}

function buildDerivationContext(storage: StorageDatabase, bookId: string, prebuilt?: { dictionary: EntityDictionary; fingerprint: string }): DerivationContext {
  const dictionary: EntityDictionary = prebuilt?.dictionary ?? buildEntityDictionary(storage, bookId);
  const fingerprint = prebuilt?.fingerprint ?? dictionaryFingerprint(dictionary);
  const memo = resolutionMemoFor(storage, bookId, fingerprint);
  const foreshadowKeys = new Set<string>();
  const entityByEntryId = new Map<string, EntityDictionaryEntry>();
  const duplicateEntryIds: string[] = [];
  const usedCanonical = new Set<string>();
  for (const entry of dictionary.entries) {
    if (entry.category === "foreshadowing") {
      for (const key of entry.lookupKeys) foreshadowKeys.add(normalizeKey(key));
      continue;
    }
    if (!ENTITY_TYPE_BY_CATEGORY[entry.category]) continue;
    const canonicalKey = normalizeKey(entry.canonicalName);
    // 规范名在同书内唯一（0032 的唯一索引）；撞名的后一个条目如实报告，不静默合并两个人。
    if (usedCanonical.has(canonicalKey)) {
      duplicateEntryIds.push(entry.entryId);
      continue;
    }
    usedCanonical.add(canonicalKey);
    entityByEntryId.set(entry.entryId, entry);
  }
  return { bookId, dictionary, fingerprint, memo, foreshadowKeys, entityByEntryId, duplicateEntryIds };
}

/** 一个称呼的归并判定（只取决于称呼与字典，可备忘）。 */
function outcomeOf(ctx: DerivationContext, rawName: string): NameOutcome {
  const cached = ctx.memo.outcomes.get(rawName);
  if (cached) return cached;
  let outcome: NameOutcome;
  if (!looksLikeEntityName(rawName)) outcome = { kind: "ignored" };
  else if (looksLikeEventPhrase(rawName)) outcome = { kind: "event-phrase" };
  else if (ctx.foreshadowKeys.has(normalizeKey(rawName)) || ctx.foreshadowKeys.has(normalizeKey(stripParentheticalSuffix(rawName)))) outcome = { kind: "foreshadow" };
  else {
    const hit = resolveEntity(ctx.dictionary, rawName)?.entry ?? null;
    outcome = hit && ctx.entityByEntryId.has(hit.entryId) ? { kind: "resolved", entryId: hit.entryId } : { kind: "unresolved" };
  }
  ctx.memo.outcomes.set(rawName, outcome);
  return outcome;
}

function splitOf(ctx: DerivationContext, raw: unknown): { names: string[]; composite: boolean } {
  const text = String(raw ?? "");
  const cached = ctx.memo.splits.get(text);
  if (cached) return cached;
  const split = splitCompositeSubject(text);
  ctx.memo.splits.set(text, split);
  return split;
}

/** 把一个原始称呼归到经纬条目；伏笔称呼、事件短语、非实体短语只计数。 */
function classify(ctx: DerivationContext, sink: MentionSink, rawName: string): EntityDictionaryEntry | null {
  const outcome = outcomeOf(ctx, rawName);
  switch (outcome.kind) {
    case "ignored":
      return null;
    case "event-phrase":
      sink.counters.nonEntity += 1;
      return null;
    case "foreshadow":
      sink.counters.foreshadow += 1;
      return null;
    case "resolved":
      sink.counters.total += 1;
      sink.counters.resolved += 1;
      return ctx.entityByEntryId.get(outcome.entryId)!;
    case "unresolved":
      sink.counters.total += 1;
      sink.unresolved.push(rawName);
      return null;
  }
}

/** 结算已写入的 entry_id 优先；没有时再按称呼拆分归并。 */
function resolveSide(ctx: DerivationContext, sink: MentionSink, raw: unknown, entryId: unknown): { hits: EntityDictionaryEntry[]; composite: boolean } {
  if (typeof entryId === "string" && ctx.entityByEntryId.has(entryId)) {
    sink.counters.resolved += 1;
    sink.counters.total += 1;
    return { hits: [ctx.entityByEntryId.get(entryId)!], composite: false };
  }
  const split = splitOf(ctx, raw);
  const hits: EntityDictionaryEntry[] = [];
  for (const name of split.names) {
    const hit = classify(ctx, sink, name);
    if (hit && !hits.some((existing) => existing.entryId === hit.entryId)) hits.push(hit);
  }
  return { hits, composite: split.composite };
}

/**
 * 知情账专用的静默归并：与 classify 同一套判定（实体字典 + 伏笔/事件短语排除），
 * 但不计入称呼链接率的分子分母——知情对象的归并不该改写实体归并统计口径。
 */
function resolveSideQuiet(ctx: DerivationContext, raw: unknown, entryId: unknown): EntityDictionaryEntry[] {
  if (typeof entryId === "string" && ctx.entityByEntryId.has(entryId)) return [ctx.entityByEntryId.get(entryId)!];
  const split = splitOf(ctx, raw);
  const hits: EntityDictionaryEntry[] = [];
  for (const name of split.names) {
    const outcome = outcomeOf(ctx, name);
    if (outcome.kind !== "resolved") continue;
    if (!hits.some((existing) => existing.entryId === outcome.entryId)) hits.push(ctx.entityByEntryId.get(outcome.entryId)!);
  }
  return hits;
}

/** ① 事件 → 参与者。 */
function deriveEvent(ctx: DerivationContext, event: EventSourceRow): EventContribution {
  const sink: MentionSink = { counters: emptyCounters(), unresolved: [] };
  const participants: ParticipantRow[] = [];
  const touches: (readonly [string, number])[] = [];
  const keys = new Set<string>();
  // 只有关系变化与位置变化的对象是实体；其余事件的对象是状态值（「重伤」「被未庄排斥」），
  // 拿去当称呼归并会把归并率压低，还会误导作者去经纬里给状态值建条目（2026-09-30 真模型基准）。
  const sides: Array<readonly ["agent" | "patient", string, string | null]> = [["agent", event.subject, event.subject_entry_id]];
  if (OBJECT_IS_ENTITY_EVENT_TYPES.has(event.event_type)) sides.push(["patient", event.object, event.object_entry_id]);
  const chapter = toChapter(event.chapter_number);
  for (const [role, raw, entryId] of sides) {
    for (const hit of resolveSide(ctx, sink, raw, entryId).hits) {
      const key = `${hit.entryId}\u0000${role}`;
      if (keys.has(key)) continue;
      keys.add(key);
      participants.push({ eventId: event.id, entityId: entityIdFor(ctx.bookId, hit.entryId), role });
      if (chapter !== null) touches.push([hit.entryId, chapter]);
    }
  }
  return { id: event.id, order: event.chapter_number, participants, touches, sink };
}

/** ② 事实 → 关系边候选 / 状态流水 / 知情账。 */
function deriveFact(ctx: DerivationContext, fact: FactSourceRow, appliedEventIds: ReadonlySet<string>): FactContribution {
  const bookId = ctx.bookId;
  const sink: MentionSink = { counters: emptyCounters(), unresolved: [] };
  const relations: { key: string; row: RelationRow }[] = [];
  const stateChanges: StateChangeRow[] = [];
  const knowledge: KnowledgeRow[] = [];
  const touches: (readonly [string, number])[] = [];
  const chapter = toChapter(fact.source_chapter) ?? toChapter(fact.valid_from_chapter);
  const confidence = typeof fact.confidence === "number" ? fact.confidence : 1;
  const evidence = fact.evidence_text?.slice(0, 400) || null;
  const subject = resolveSide(ctx, sink, fact.subject, fact.subject_entry_id);
  const done = (): FactContribution => ({ id: fact.id, order: fact.sort_key as number, relations, stateChanges, knowledge, touches, sink });

  if (isKnowledgeConfirmed(fact.source_type, fact.source_id, appliedEventIds)) {
    // 知情账：subject 归并到的实体知道；relationship / location 的 object 也是实体（关系事实双方都知道）。
    const knowers = new Set<string>();
    for (const hit of subject.hits) knowers.add(entityIdFor(bookId, hit.entryId));
    if (OBJECT_IS_ENTITY_FACT_CATEGORIES.has(fact.category)) {
      for (const hit of resolveSideQuiet(ctx, fact.object, fact.object_entry_id)) knowers.add(entityIdFor(bookId, hit.entryId));
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
    const object = resolveSide(ctx, sink, fact.object, fact.object_entry_id);
    const pairs: [EntityDictionaryEntry, EntityDictionaryEntry][] = [];
    if (subject.composite && subject.hits.length > 1) {
      for (let i = 0; i < subject.hits.length; i += 1) {
        for (let j = i + 1; j < subject.hits.length; j += 1) pairs.push([subject.hits[i]!, subject.hits[j]!]);
      }
    }
    for (const source of subject.hits) for (const target of object.hits) pairs.push([source, target]);
    const validFrom = toChapter(fact.valid_from_chapter) ?? chapter;
    const predicate = (fact.predicate || "关联").slice(0, 80);
    const localKeys = new Set<string>();
    for (const [source, target] of pairs) {
      if (source.entryId === target.entryId) continue;
      const subjectId = entityIdFor(bookId, source.entryId);
      const objectId = entityIdFor(bookId, target.entryId);
      const key = `${subjectId}\u0000${predicate}\u0000${objectId}\u0000${validFrom ?? ""}`;
      if (localKeys.has(key)) continue;
      localKeys.add(key);
      relations.push({
        key,
        row: {
          id: derivedRowId(`rel:${fact.id}:${source.entryId}:${target.entryId}`),
          subjectId, predicate, objectId, validFrom,
          validTo: toChapter(fact.valid_until_chapter),
          sourceEventId: null, evidence, confidence,
        },
      });
    }
    return done();
  }

  if ((fact.category === "character_state" || fact.category === "location") && chapter !== null) {
    // 生死 / 去向 / 所在 三类硬状态按同义表归一到固定方面与取值（只取决于这一行，整本与增量推导一致）。
    const normalized = normalizeStateFact(fact);
    for (const hit of subject.hits) {
      stateChanges.push({
        id: derivedRowId(`st:${fact.id}:${hit.entryId}`),
        entityId: entityIdFor(bookId, hit.entryId),
        fluent: (normalized?.slot ?? (fact.predicate || "状态")).slice(0, 80),
        newValue: (normalized?.value ?? String(fact.object ?? "")).slice(0, 400),
        chapter, evidence, confidence,
      });
      touches.push([hit.entryId, chapter]);
    }
  }
  return done();
}

// ─── 推导状态（整本推导产出，增量推导在其上合并） ────────────────────────────

/** 计数多重集：键 → 出现次数。 */
type Multiset<K> = Map<K, number>;

function nestedAdd<A, B>(outer: Map<A, Multiset<B>>, a: A, b: B, delta: number): void {
  let inner = outer.get(a);
  if (!inner) {
    if (delta <= 0) return;
    outer.set(a, (inner = new Map()));
  }
  const next = (inner.get(b) ?? 0) + delta;
  if (next <= 0) inner.delete(b);
  else inner.set(b, next);
  if (inner.size === 0) outer.delete(a);
}

interface DerivedState {
  readonly ctx: DerivationContext;
  readonly events: Map<string, EventContribution>;
  readonly facts: Map<string, FactContribution>;
  /** 出场名单（entry_id 非空的行）：章 → 条目 → 行数；条目 → 章 → 行数。 */
  readonly mentionsByChapter: Map<number, Multiset<string>>;
  readonly mentionChapters: Map<string, Multiset<number>>;
  /** 事件参与者与状态流水带来的出场章：条目 → 章 → 次数。 */
  readonly touchChapters: Map<string, Multiset<number>>;
  /** 关系键 → 候选事实 id → 行；胜出者 = 排序最靠前的事实（与整本推导的先到先得一致）。 */
  readonly relationGroups: Map<string, Map<string, RelationRow>>;
  readonly relationWinner: Map<string, string>;
  readonly totals: Counters;
  /** 带未归并称呼的行（"e" 事件 / "f" 事实 + id），用于重算样例。 */
  readonly unresolvedRows: Set<string>;
  /** 六张表的目标行（= 写完后库里的索引）。 */
  readonly desired: DesiredIndex;
}

function entitySpan(state: Pick<DerivedState, "mentionChapters" | "touchChapters">, entryId: string): { first: number; last: number } | null {
  let first: number | null = null;
  let last: number | null = null;
  const touch = (chapter: number | null) => {
    if (chapter === null) return;
    first = first === null ? chapter : Math.min(first, chapter);
    last = last === null ? chapter : Math.max(last, chapter);
  };
  const mentions = state.mentionChapters.get(entryId);
  if (mentions && mentions.size > 0) {
    // 与 SQL 的 MIN / MAX(chapter_number) 再 toChapter 一致：原始最值不是正整数时不取它
    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const chapter of mentions.keys()) {
      if (chapter < rawMin) rawMin = chapter;
      if (chapter > rawMax) rawMax = chapter;
    }
    touch(toChapter(rawMin));
    touch(toChapter(rawMax));
  }
  for (const chapter of state.touchChapters.get(entryId)?.keys() ?? []) touch(chapter);
  return first === null || last === null ? null : { first, last };
}

function entityRowFor(ctx: DerivationContext, state: Pick<DerivedState, "mentionChapters" | "touchChapters">, entry: EntityDictionaryEntry): EntityRow {
  const span = entitySpan(state, entry.entryId);
  return {
    id: entityIdFor(ctx.bookId, entry.entryId),
    entryId: entry.entryId,
    canonicalName: entry.canonicalName,
    entityType: ENTITY_TYPE_BY_CATEGORY[entry.category]!,
    aliases: entry.lookupKeys.filter((key) => normalizeKey(key) !== normalizeKey(entry.canonicalName)),
    firstChapter: span?.first ?? null,
    lastChapter: span?.last ?? null,
  };
}

const SURROGATE = /[\uD800-\uDFFF]/u;

/**
 * SQLite BINARY 排序（UTF-8 字节序）。UTF-8 字节序等同于 Unicode 码点序；
 * JS 字符串比较按 UTF-16 码元，只在含增补平面字符（代理对）时与码点序不同，那时逐码点比较。
 */
function compareBinary(a: string, b: string): number {
  if (a === b) return 0;
  if (!SURROGATE.test(a) && !SURROGATE.test(b)) return a < b ? -1 : 1;
  const left = [...a];
  const right = [...b];
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function compareRowOrder(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order !== b.order ? a.order - b.order : compareBinary(a.id, b.id);
}

/** 未归并样例：与整本推导同样的遍历顺序（先事件后事实，各按 SQL 排序），去重后取前 12 个。 */
function unresolvedSamplesOf(state: DerivedState): string[] {
  const eventRows: EventContribution[] = [];
  const factRows: FactContribution[] = [];
  for (const tag of state.unresolvedRows) {
    if (tag.startsWith("e")) eventRows.push(state.events.get(tag.slice(1))!);
    else factRows.push(state.facts.get(tag.slice(1))!);
  }
  eventRows.sort(compareRowOrder);
  factRows.sort(compareRowOrder);
  const samples: string[] = [];
  for (const row of [...eventRows, ...factRows]) {
    for (const name of row.sink.unresolved) {
      if (samples.length >= 12) return samples;
      if (!samples.includes(name)) samples.push(name);
    }
  }
  return samples;
}

function statsOf(state: DerivedState): EntityIndexStats {
  const desired = state.desired;
  let aliasCount = 0;
  for (const { row } of desired.entities.values()) aliasCount += row.aliases.length + 1;
  return {
    entities: desired.entities.size,
    aliases: aliasCount,
    participants: desired.participants.size,
    relations: desired.relations.size,
    stateChanges: desired.stateChanges.size,
    knowledge: desired.knowledge.size,
    totalMentions: state.totals.total,
    resolvedMentions: state.totals.resolved,
    foreshadowMentions: state.totals.foreshadow,
    nonEntityMentions: state.totals.nonEntity,
    unresolvedSamples: unresolvedSamplesOf(state),
    duplicateEntryIds: state.ctx.duplicateEntryIds,
  };
}

/**
 * 整本推导：读全书事件、事实、出场名单，逐行求贡献再汇总。
 * plan 与改造前逐项相同（数组顺序也相同）；state 供之后的增量推导复用。
 * 遇到增量无法保证与整本逐行一致的数据（排序键不是数字、行键撞车）时 incrementable = false，
 * 调用方不保存 state，下一次仍整本推导。
 */
function deriveFull(
  storage: StorageDatabase,
  bookId: string,
  prebuilt?: { dictionary: EntityDictionary; fingerprint: string },
): { plan: EntityIndexPlan; state: DerivedState; incrementable: boolean } {
  const ctx = buildDerivationContext(storage, bookId, prebuilt);
  let incrementable = true;

  // 章节首末出场：优先本章全量出场名单（0033），没有时由事件章号补
  const mentionsByChapter = new Map<number, Multiset<string>>();
  const mentionChapters = new Map<string, Multiset<number>>();
  let mentionAggregate: Map<string, { first: number | null; last: number | null }> | null = null;
  if (tableExists(storage, "narrative_chapter_mention")) {
    const rows = storage.sqlite
      .prepare<{ chapter_number: unknown; entry_id: string }>(
        "SELECT chapter_number, entry_id FROM narrative_chapter_mention WHERE book_id = ? AND entry_id IS NOT NULL",
      )
      .all(bookId);
    if (rows.every((row) => typeof row.chapter_number === "number")) {
      for (const row of rows) {
        nestedAdd(mentionsByChapter, row.chapter_number as number, row.entry_id, 1);
        nestedAdd(mentionChapters, row.entry_id, row.chapter_number as number, 1);
      }
    } else {
      // 章号不是数字（脏数据）：首末章交给 SQL 聚合，与改造前完全一致；这本书不做增量
      incrementable = false;
      mentionAggregate = new Map();
      for (const row of storage.sqlite
        .prepare<{ entry_id: string; first: unknown; last: unknown }>(`
          SELECT entry_id, MIN(chapter_number) AS first, MAX(chapter_number) AS last
          FROM narrative_chapter_mention
          WHERE book_id = ? AND entry_id IS NOT NULL
          GROUP BY entry_id
        `)
        .all(bookId)) {
        mentionAggregate.set(row.entry_id, { first: toChapter(row.first), last: toChapter(row.last) });
      }
    }
  }

  const touchChapters = new Map<string, Multiset<number>>();
  const totals = emptyCounters();
  const unresolvedRows = new Set<string>();
  const unresolvedSamples: string[] = [];
  const absorb = (tag: string, contribution: EventContribution | FactContribution) => {
    for (const [entryId, chapter] of contribution.touches) nestedAdd(touchChapters, entryId, chapter, 1);
    addCounters(totals, contribution.sink.counters, 1);
    if (contribution.sink.unresolved.length > 0) unresolvedRows.add(tag);
    for (const name of contribution.sink.unresolved) {
      if (unresolvedSamples.length < 12 && !unresolvedSamples.includes(name)) unresolvedSamples.push(name);
    }
  };

  // ① 事件 → 参与者
  const events = new Map<string, EventContribution>();
  const participants: ParticipantRow[] = [];
  for (const row of storage.sqlite
    .prepare<EventSourceRow>(`
      SELECT ${EVENT_COLUMNS}
      FROM narrative_event
      WHERE book_id = ? AND status != 'rejected'
      ORDER BY chapter_number ASC, id ASC
    `)
    .all(bookId)) {
    if (typeof row.chapter_number !== "number") incrementable = false;
    const contribution = deriveEvent(ctx, row);
    events.set(row.id, contribution);
    participants.push(...contribution.participants);
    absorb(`e${row.id}`, contribution);
  }

  // ② 事实 → 关系边 / 状态流水 / 知情账
  // 知情来源只取已确认事实：event 来源要求其来源事件已应用（待审 / 驳回不算）。
  const appliedEventIds = new Set(
    storage.sqlite.prepare<{ id: string }>(
      "SELECT id FROM narrative_event WHERE book_id = ? AND status = 'applied'",
    ).all(bookId).map((row) => row.id),
  );
  const facts = new Map<string, FactContribution>();
  const relations: RelationRow[] = [];
  const relationGroups = new Map<string, Map<string, RelationRow>>();
  const relationWinner = new Map<string, string>();
  const stateChanges: StateChangeRow[] = [];
  const knowledge: KnowledgeRow[] = [];
  for (const row of storage.sqlite
    .prepare<FactSourceRow>(`
      SELECT ${FACT_COLUMNS}
      FROM narrative_fact
      WHERE book_id = ?
      ORDER BY COALESCE(source_chapter, valid_from_chapter, 0) ASC, id ASC
    `)
    .all(bookId)) {
    if (typeof row.sort_key !== "number") incrementable = false;
    const contribution = deriveFact(ctx, row, appliedEventIds);
    facts.set(row.id, contribution);
    knowledge.push(...contribution.knowledge);
    for (const { key, row: relation } of contribution.relations) {
      let group = relationGroups.get(key);
      if (!group) relationGroups.set(key, (group = new Map()));
      group.set(row.id, relation);
      if (!relationWinner.has(key)) {
        relationWinner.set(key, row.id);
        relations.push(relation);
      }
    }
    stateChanges.push(...contribution.stateChanges);
    absorb(`f${row.id}`, contribution);
  }

  const entities: EntityRow[] = [];
  for (const entry of ctx.entityByEntryId.values()) {
    const row = entityRowFor(ctx, { mentionChapters, touchChapters }, entry);
    if (!mentionAggregate) {
      entities.push(row);
      continue;
    }
    const aggregate = mentionAggregate.get(entry.entryId);
    const chapters = [aggregate?.first ?? null, aggregate?.last ?? null, row.firstChapter, row.lastChapter].filter((value): value is number => value !== null);
    entities.push(chapters.length > 0 ? { ...row, firstChapter: Math.min(...chapters), lastChapter: Math.max(...chapters) } : row);
  }

  const aliasRows = entities.reduce((sum, entity) => sum + entity.aliases.length + 1, 0);
  const plan: EntityIndexPlan = {
    entities,
    relations,
    stateChanges,
    participants,
    knowledge,
    stats: {
      entities: entities.length,
      aliases: aliasRows,
      participants: participants.length,
      relations: relations.length,
      stateChanges: stateChanges.length,
      knowledge: knowledge.length,
      totalMentions: totals.total,
      resolvedMentions: totals.resolved,
      foreshadowMentions: totals.foreshadow,
      nonEntityMentions: totals.nonEntity,
      unresolvedSamples,
      duplicateEntryIds: ctx.duplicateEntryIds,
    },
  };
  const desired = desiredIndexFromPlan(plan);
  // 派生行键撞车（派生行 id 拼接巧合）时整本靠先到先得消解；增量复现不了这个顺序。
  // 实体与别名只取决于实体字典，增量从不改动它们（字典一变就整本），所以别名撞名不影响增量。
  if (desired.participants.size !== participants.length || desired.relations.size !== relations.length
    || desired.stateChanges.size !== stateChanges.length || desired.knowledge.size !== knowledge.length) {
    incrementable = false;
  }
  const state: DerivedState = {
    ctx, events, facts, mentionsByChapter, mentionChapters, touchChapters, relationGroups, relationWinner,
    totals, unresolvedRows, desired,
  };
  return { plan, state, incrementable };
}

/**
 * 只读推导：不写库。rebuild 在它之上写入本书索引；dry-run（回填脚本）直接看 stats。
 */
export function planNarrativeEntityIndex(storage: StorageDatabase, bookId: string): EntityIndexPlan {
  return deriveFull(storage, bookId).plan;
}

// ─── 增量推导 ──────────────────────────────────────────────────────────────
//
// 输入：上次刷新留下的推导状态 + 之后被写过的事件 / 事实 / 出场章（entity-index-changes.ts 的变更记录）。
// 重算范围：
// - 写过的事件；写过的事实；来源事件被写过的事实（事件审批会改变事实是否「已确认」，进而改变知情账）；
// - 写过的出场章的全部出场名单行。
// 合并：先撤掉这些行的旧贡献，再加上新贡献；关系边同键重新按 (排序键, id) 选先到者；
// 受牵连实体重算首末章；称呼计数加减；未归并样例按整本的顺序重排。
//
// 回退整本推导的条件（每条都对应一个 fallback 原因，见 IncrementalFallbackReason）：
// - 没有可用的推导状态（进程刚启动、上次是 dry-run、上次推导标记了不可增量）；
// - 变更捕获不可用或换了 epoch（触发器被删、TEMP 表被清、日志超限）；
// - 上次写完后的同步标记不在了（刷新发生在外层事务里且外层回滚了）；
// - 索引表指纹或 data_version 变了（别的连接写过库，或有人绕过本模块动了索引表）；
// - 实体字典指纹变了（经纬条目 / 别名 / 伏笔改动）；
// - 本书变更记录过多（批量写入）；
// - 调用方要求整本（显式重建、改写重结算）；
// - 数据形态不确定：排序键或章号不是数字、派生行键与别的行撞车。

export type IncrementalFallbackReason =
  | "requested"
  | "no-state"
  | "tracking-unavailable"
  | "epoch-changed"
  | "sync-marker-missing"
  | "index-changed"
  | "dictionary-changed"
  | "too-many-changes"
  | "non-numeric-order"
  | "row-key-collision";

class IncrementalFallback extends Error {
  constructor(readonly reason: IncrementalFallbackReason) {
    super(reason);
  }
}

/** 单次增量最多接受本书多少条变更记录；超过说明是批量写入，整本推导更稳。 */
const MAX_INCREMENTAL_CHANGES = 5_000;
const ID_CHUNK = 400;

function selectInChunks<T>(storage: StorageDatabase, sql: (placeholders: string) => string, bookId: string, ids: readonly unknown[]): T[] {
  const out: T[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    out.push(...storage.sqlite.prepare<T>(sql(chunk.map(() => "?").join(", "))).all(bookId, ...chunk));
  }
  return out;
}

type TableName = keyof DesiredIndex;
const TABLE_NAMES: readonly TableName[] = ["entities", "aliases", "participants", "relations", "stateChanges", "knowledge"];

/** 记下增量过程中每个被动过的行键在改动前的签名，最后与改动后比出差量。 */
class DeltaRecorder {
  private readonly before = Object.fromEntries(TABLE_NAMES.map((name) => [name, new Map<string, string | undefined>()])) as Record<TableName, Map<string, string | undefined>>;

  constructor(private readonly desired: DesiredIndex) {}

  remove(table: TableName, key: string): void {
    this.mark(table, key);
    (this.desired[table] as Map<string, unknown>).delete(key);
  }

  add<T>(table: TableName, key: string, value: DesiredRow<T>): void {
    this.mark(table, key);
    const map = this.desired[table] as Map<string, DesiredRow<T>>;
    if (map.has(key)) throw new IncrementalFallback("row-key-collision");
    map.set(key, value);
  }

  replace<T>(table: TableName, key: string, value: DesiredRow<T>): void {
    this.mark(table, key);
    (this.desired[table] as Map<string, DesiredRow<T>>).set(key, value);
  }

  delta(): IndexDelta {
    const out = {} as Record<TableName, TableDelta>;
    for (const name of TABLE_NAMES) {
      const table: TableDelta = { removed: [], added: [], changed: [] };
      const map = this.desired[name] as Map<string, DesiredRow<unknown>>;
      for (const [key, previous] of this.before[name]) {
        const next = map.get(key)?.signature;
        if (previous === undefined && next !== undefined) table.added.push(key);
        else if (previous !== undefined && next === undefined) table.removed.push(key);
        else if (previous !== undefined && next !== undefined && previous !== next) table.changed.push(key);
      }
      out[name] = table;
    }
    return out;
  }

  private mark(table: TableName, key: string): void {
    const before = this.before[table];
    if (!before.has(key)) before.set(key, (this.desired[table] as Map<string, DesiredRow<unknown>>).get(key)?.signature);
  }
}

/**
 * 把变更合并进推导状态（就地修改 state），返回写回用的差量。
 * 读库与重算新贡献全部在动 state 之前完成；之后的合并阶段若抛出，state 已不完整，调用方必须丢弃它。
 */
function deriveIncremental(
  storage: StorageDatabase,
  state: DerivedState,
  changes: EntityIndexChanges,
  onMutationStart: () => void,
): IndexDelta {
  const { ctx } = state;
  const bookId = ctx.bookId;

  // ── 读取并重算（不动 state）
  const eventIds = [...changes.eventIds];
  const newEvents = selectInChunks<EventSourceRow>(storage, (in_) => `
    SELECT ${EVENT_COLUMNS} FROM narrative_event
    WHERE book_id = ? AND status != 'rejected' AND id IN (${in_})
  `, bookId, eventIds);
  if (newEvents.some((row) => typeof row.chapter_number !== "number")) throw new IncrementalFallback("non-numeric-order");

  const factRows = new Map<string, FactSourceRow>();
  for (const row of selectInChunks<FactSourceRow>(storage, (in_) => `SELECT ${FACT_COLUMNS} FROM narrative_fact WHERE book_id = ? AND id IN (${in_})`, bookId, [...changes.factIds])) {
    factRows.set(row.id, row);
  }
  // 来源事件被写过（审批、驳回、删除、进出回收站）的事实也要重算：事件是否已应用决定知情账。
  // 这些事实本身没被写过，按 source_id 从库里找；事实被删或改了 source_id 时本身就在变更记录里。
  const factIds = new Set(changes.factIds);
  for (const row of selectInChunks<FactSourceRow>(storage, (in_) => `SELECT ${FACT_COLUMNS} FROM narrative_fact WHERE book_id = ? AND source_id IN (${in_})`, bookId, eventIds)) {
    factRows.set(row.id, row);
    factIds.add(row.id);
  }
  if ([...factRows.values()].some((row) => typeof row.sort_key !== "number")) throw new IncrementalFallback("non-numeric-order");
  const sourceIds = [...new Set([...factRows.values()].filter((row) => row.source_type === "event" && row.source_id !== null).map((row) => row.source_id!))];
  const appliedEventIds = new Set(selectInChunks<{ id: string }>(storage, (in_) => `
    SELECT id FROM narrative_event WHERE book_id = ? AND status = 'applied' AND id IN (${in_})
  `, bookId, sourceIds).map((row) => row.id));

  const mentionReads = new Map<number, string[]>();
  for (const raw of changes.mentionChapters) {
    if (typeof raw !== "number") throw new IncrementalFallback("non-numeric-order");
    const rows = storage.sqlite
      .prepare<{ chapter_number: unknown; entry_id: string }>(
        "SELECT chapter_number, entry_id FROM narrative_chapter_mention WHERE book_id = ? AND chapter_number = ? AND entry_id IS NOT NULL",
      )
      .all(bookId, raw);
    if (rows.some((row) => typeof row.chapter_number !== "number")) throw new IncrementalFallback("non-numeric-order");
    mentionReads.set(raw, rows.map((row) => row.entry_id));
  }

  const nextEvents = newEvents.map((row) => deriveEvent(ctx, row));
  const nextFacts = [...factRows.values()].map((row) => deriveFact(ctx, row, appliedEventIds));

  // ── 合并（动 state）
  onMutationStart();
  const recorder = new DeltaRecorder(state.desired);
  const affectedEntries = new Set<string>();
  const affectedRelationKeys = new Set<string>();
  const oldWinnerRowIds = new Map<string, string>();
  const noteRelationKey = (key: string) => {
    if (affectedRelationKeys.has(key)) return;
    affectedRelationKeys.add(key);
    const winner = state.relationWinner.get(key);
    if (winner !== undefined) oldWinnerRowIds.set(key, state.relationGroups.get(key)!.get(winner)!.id);
  };
  for (const id of factIds) for (const { key } of state.facts.get(id)?.relations ?? []) noteRelationKey(key);
  for (const contribution of nextFacts) for (const { key } of contribution.relations) noteRelationKey(key);

  const unabsorb = (tag: string, contribution: EventContribution | FactContribution) => {
    for (const [entryId, chapter] of contribution.touches) {
      nestedAdd(state.touchChapters, entryId, chapter, -1);
      affectedEntries.add(entryId);
    }
    addCounters(state.totals, contribution.sink.counters, -1);
    state.unresolvedRows.delete(tag);
  };
  const absorb = (tag: string, contribution: EventContribution | FactContribution) => {
    for (const [entryId, chapter] of contribution.touches) {
      nestedAdd(state.touchChapters, entryId, chapter, 1);
      affectedEntries.add(entryId);
    }
    addCounters(state.totals, contribution.sink.counters, 1);
    if (contribution.sink.unresolved.length > 0) state.unresolvedRows.add(tag);
  };

  // 撤旧
  for (const id of eventIds) {
    const old = state.events.get(id);
    if (!old) continue;
    for (const participant of old.participants) recorder.remove("participants", participantKey(participant.eventId, participant.entityId, participant.role));
    unabsorb(`e${id}`, old);
    state.events.delete(id);
  }
  for (const id of factIds) {
    const old = state.facts.get(id);
    if (!old) continue;
    for (const row of old.knowledge) recorder.remove("knowledge", row.id);
    for (const row of old.stateChanges) recorder.remove("stateChanges", row.id);
    for (const { key } of old.relations) {
      const group = state.relationGroups.get(key)!;
      group.delete(id);
    }
    unabsorb(`f${id}`, old);
    state.facts.delete(id);
  }
  for (const rowId of oldWinnerRowIds.values()) recorder.remove("relations", rowId);
  for (const chapter of mentionReads.keys()) {
    const old = state.mentionsByChapter.get(chapter);
    if (!old) continue;
    for (const [entryId, count] of old) {
      nestedAdd(state.mentionChapters, entryId, chapter, -count);
      affectedEntries.add(entryId);
    }
    state.mentionsByChapter.delete(chapter);
  }

  // 加新
  for (const contribution of nextEvents) {
    for (const participant of contribution.participants) {
      recorder.add("participants", participantKey(participant.eventId, participant.entityId, participant.role), { row: participant, signature: "" });
    }
    state.events.set(contribution.id, contribution);
    absorb(`e${contribution.id}`, contribution);
  }
  for (const contribution of nextFacts) {
    for (const row of contribution.knowledge) recorder.add("knowledge", row.id, { row, signature: knowledgeSignature(row) });
    for (const row of contribution.stateChanges) recorder.add("stateChanges", row.id, { row, signature: stateChangeSignature(row) });
    for (const { key, row } of contribution.relations) {
      let group = state.relationGroups.get(key);
      if (!group) state.relationGroups.set(key, (group = new Map()));
      group.set(contribution.id, row);
    }
    state.facts.set(contribution.id, contribution);
    absorb(`f${contribution.id}`, contribution);
  }
  for (const key of affectedRelationKeys) {
    const group = state.relationGroups.get(key);
    let winner: string | null = null;
    for (const factId of group?.keys() ?? []) {
      if (winner === null || compareRowOrder(state.facts.get(factId)!, state.facts.get(winner)!) < 0) winner = factId;
    }
    if (winner === null) {
      state.relationGroups.delete(key);
      state.relationWinner.delete(key);
      continue;
    }
    state.relationWinner.set(key, winner);
    const row = group!.get(winner)!;
    recorder.add("relations", row.id, { row, signature: relationSignature(row) });
  }
  for (const [chapter, entryIds] of mentionReads) {
    for (const entryId of entryIds) {
      nestedAdd(state.mentionsByChapter, chapter, entryId, 1);
      nestedAdd(state.mentionChapters, entryId, chapter, 1);
      affectedEntries.add(entryId);
    }
  }

  // 受牵连实体重算首末章（实体集合与别名只取决于字典，字典没变）
  for (const entryId of affectedEntries) {
    const entry = ctx.entityByEntryId.get(entryId);
    if (!entry) continue;
    const row = entityRowFor(ctx, state, entry);
    recorder.replace("entities", row.id, { row, signature: entitySignatureOf(row) });
  }
  return recorder.delta();
}

// ─── 写入：整本重写与差量写回 ──────────────────────────────────────────────
//
// 两种写法写出来的行逐项相同，区别只在写多少：
// - rebuild：清空本书六张表再全量插入（显式重建、导入、删章这些批量入口）。
// - refresh：只删 / 改 / 插变化的行（每章结算）。增量推导时差量直接由推导给出；
//   整本推导时与「库里现有的索引行」逐行比对（现有行优先取进程内快照，快照不可信时从库里读回）。
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

interface TableDelta {
  readonly removed: string[];
  readonly added: string[];
  readonly changed: string[];
}

type IndexDelta = { readonly [K in keyof DesiredIndex]: TableDelta };

const entitySignature = (values: readonly unknown[]) => JSON.stringify(values);
const participantKey = (eventId: string, entityId: string, role: string) => `${eventId}\u0000${entityId}\u0000${role}`;
const entitySignatureOf = (entity: EntityRow) =>
  entitySignature([entity.canonicalName, entity.entityType, JSON.stringify(entity.aliases), "{}", entity.entryId, entity.firstChapter, entity.lastChapter, "active", "settlement", 1]);
const relationSignature = (relation: RelationRow) =>
  entitySignature([relation.subjectId, relation.predicate, relation.objectId, "relationship", null, relation.validFrom, relation.validTo, relation.sourceEventId, relation.evidence, relation.confidence, null]);
const stateChangeSignature = (change: StateChangeRow) =>
  entitySignature([change.entityId, change.fluent, null, change.newValue, change.chapter, null, change.evidence, change.confidence]);
const knowledgeSignature = (row: KnowledgeRow) =>
  entitySignature([row.entityId, "fact", row.factRef, row.knowsFrom, null, "knows", row.evidence]);

function desiredIndexFromPlan(plan: EntityIndexPlan): DesiredIndex {
  const entities = new Map<string, DesiredRow<EntityRow>>();
  const aliases = new Map<string, DesiredRow<AliasRow>>();
  for (const entity of plan.entities) {
    if (entities.has(entity.id)) continue;
    entities.set(entity.id, { row: entity, signature: entitySignatureOf(entity) });
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
    relations.set(relation.id, { row: relation, signature: relationSignature(relation) });
  }
  const stateChanges = new Map<string, DesiredRow<StateChangeRow>>();
  for (const change of plan.stateChanges) {
    if (stateChanges.has(change.id)) continue;
    stateChanges.set(change.id, { row: change, signature: stateChangeSignature(change) });
  }
  const knowledge = new Map<string, DesiredRow<KnowledgeRow>>();
  for (const row of plan.knowledge) {
    if (knowledge.has(row.id)) continue;
    knowledge.set(row.id, { row, signature: knowledgeSignature(row) });
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
// 记下上次写完时本书的目标行（= 库里的索引），以及一个廉价的「库指纹」：每张表本书的行数与最大 rowid，
// 加上 PRAGMA data_version（别的连接提交过写入就会变）。下次写回前先比指纹，
// 对不上（进程重启、删书后同 id 重建、别处动过这几张表）就从库里读回，绝不拿过期快照去比对。
// 快照可以附带增量推导状态：附带时 desired 与 state.desired 是同一个对象，增量推导会就地改它，
// 所以增量合并中途失败时必须连快照一起丢掉。

interface IndexSnapshot {
  readonly fingerprint: string;
  readonly desired: DesiredIndex;
  readonly incremental: { readonly state: DerivedState; readonly epoch: number; readonly token: string } | null;
}

const MAX_SNAPSHOT_BOOKS = 8;
/** 带增量推导状态（占内存较多）的书最多几本；超出的书只保留签名快照。 */
const MAX_INCREMENTAL_BOOKS = 4;
const indexSnapshots = new WeakMap<StorageDatabase, Map<string, IndexSnapshot>>();

function dataVersion(storage: StorageDatabase): unknown {
  return storage.sqlite.pragma("data_version", { simple: true });
}

/**
 * dataVersionAtRead：推导开始读库之前取的 data_version。写完后再取会漏掉
 * 「推导读库之后、写回之前别的连接提交的写入」；用读之前的值，那种情况下次比对必然不一致、改走整本。
 */
function indexFingerprint(storage: StorageDatabase, bookId: string, dataVersionAtRead: unknown = dataVersion(storage)): string {
  const parts: unknown[] = [dataVersionAtRead];
  for (const table of INDEX_TABLES) {
    const row = storage.sqlite
      .prepare<{ n: number; maxRowid: number | null }>(`SELECT COUNT(*) AS n, MAX(rowid) AS maxRowid FROM ${table} WHERE book_id = ?`)
      .get(bookId);
    parts.push(row?.n ?? 0, row?.maxRowid ?? null);
  }
  return JSON.stringify(parts);
}

function rememberSnapshot(storage: StorageDatabase, bookId: string, desired: DesiredIndex, incremental: IndexSnapshot["incremental"], dataVersionAtRead: unknown): void {
  let books = indexSnapshots.get(storage);
  if (!books) {
    books = new Map();
    indexSnapshots.set(storage, books);
  }
  books.delete(bookId);
  books.set(bookId, { fingerprint: indexFingerprint(storage, bookId, dataVersionAtRead), desired, incremental });
  while (books.size > MAX_SNAPSHOT_BOOKS) books.delete(books.keys().next().value!);
  // 最近使用的书排在后面；从前往后把多出来的增量状态降级为纯快照
  let withState = [...books.values()].filter((snapshot) => snapshot.incremental !== null).length;
  for (const [key, snapshot] of books) {
    if (withState <= MAX_INCREMENTAL_BOOKS) break;
    if (snapshot.incremental === null) continue;
    books.set(key, { ...snapshot, incremental: null });
    withState -= 1;
  }
}

function forgetSnapshot(storage: StorageDatabase, bookId: string): void {
  indexSnapshots.get(storage)?.delete(bookId);
}

export interface EntityIndexWriteStats {
  /** full = 清空重写；diff = 只写变化的行。 */
  readonly mode: "full" | "diff";
  /** diff 模式下比对基准的来源：进程内快照（含增量推导直接给出的差量），或从库里读回。 */
  readonly baseline?: "snapshot" | "database";
  readonly inserted: number;
  readonly updated: number;
  readonly deleted: number;
}

/** 本次推导走了哪条路径；整本时附带为什么没能增量。 */
export interface EntityIndexDerivation {
  readonly mode: "full" | "incremental";
  readonly fallbackReason?: IncrementalFallbackReason;
}

function schemaMissing(bookId: string): EntityIndexRebuildResult {
  return {
    ok: false,
    bookId,
    reason: "schema-missing",
    explanation: "这个数据库还没有实体索引相关的表（迁移 0032 未执行），本次跳过实体归并；正文、事实与事件不受影响。",
  };
}

const lastRefreshes = new WeakMap<StorageDatabase, Map<string, { readonly derivation: EntityIndexDerivation; readonly stats: EntityIndexStats }>>();

/** 本连接上某本书最近一次 refresh 走了哪条推导路径与得出的统计（诊断与测试用；结算不返回它）。 */
export function lastEntityIndexRefresh(storage: StorageDatabase, bookId: string): { readonly derivation: EntityIndexDerivation; readonly stats: EntityIndexStats } | null {
  return lastRefreshes.get(storage)?.get(bookId) ?? null;
}

function noteRefresh(storage: StorageDatabase, bookId: string, derivation: EntityIndexDerivation, stats: EntityIndexStats): void {
  let books = lastRefreshes.get(storage);
  if (!books) lastRefreshes.set(storage, (books = new Map()));
  books.delete(bookId);
  books.set(bookId, { derivation, stats });
  while (books.size > MAX_SNAPSHOT_BOOKS) books.delete(books.keys().next().value!);
}

export interface RefreshNarrativeEntityIndexOptions {
  readonly now?: number;
  /** false = 本次必须整本推导（改写重结算等）；默认能增量就增量。 */
  readonly incremental?: boolean;
}

/**
 * 差量刷新（每章结算用）：结果与整本重建逐项一致（时间戳列除外），只把变化的行写回。
 * 能增量时只重算上次刷新之后写过的事件 / 事实 / 出场章；否则整本推导（条件见「增量推导」一节）。
 * 写回在一个事务内完成，失败整体回滚、旧索引原样保留。
 */
export function refreshNarrativeEntityIndex(
  storage: StorageDatabase,
  bookId: string,
  options: RefreshNarrativeEntityIndexOptions = {},
): EntityIndexRebuildResult & { readonly write?: EntityIndexWriteStats; readonly derivation?: EntityIndexDerivation } {
  ensureNarrativeMemorySchema(storage);
  if (!INDEX_TABLES.every((table) => tableExists(storage, table))) return schemaMissing(bookId);
  const now = options.now ?? Date.now();
  const db = storage.sqlite;
  const epoch = ensureEntityIndexChangeTracking(storage);
  const dataVersionAtRead = dataVersion(storage);
  const dictionary = buildEntityDictionary(storage, bookId);
  const fingerprint = dictionaryFingerprint(dictionary);

  const cached = indexSnapshots.get(storage)?.get(bookId);
  const snapshot = cached && cached.fingerprint === indexFingerprint(storage, bookId, dataVersionAtRead) ? cached : null;
  let snapshotUsable = snapshot !== null;
  let fallbackReason: IncrementalFallbackReason;

  // ── 增量
  const attempt = (): { state: DerivedState; delta: IndexDelta } => {
    if (options.incremental === false) throw new IncrementalFallback("requested");
    if (epoch === null) throw new IncrementalFallback("tracking-unavailable");
    if (!cached?.incremental) throw new IncrementalFallback("no-state");
    if (!snapshot) throw new IncrementalFallback("index-changed");
    const incremental = snapshot.incremental!;
    if (incremental.epoch !== epoch) throw new IncrementalFallback("epoch-changed");
    if (incremental.state.ctx.fingerprint !== fingerprint) throw new IncrementalFallback("dictionary-changed");
    const changes = readEntityIndexChanges(storage, bookId, incremental.token, MAX_INCREMENTAL_CHANGES);
    if (!changes) {
      // 上次写回所在的外层事务回滚了：库里的索引未必是快照记的样子，快照也不再可信
      snapshotUsable = false;
      throw new IncrementalFallback("sync-marker-missing");
    }
    if (changes.overflow) throw new IncrementalFallback("too-many-changes");
    const delta = deriveIncremental(storage, incremental.state, changes, () => {
      // 从这里起 state（以及与它共用 desired 的快照）会被就地修改
      snapshotUsable = false;
    });
    return { state: incremental.state, delta };
  };
  try {
    const { state, delta } = attempt();
    let write: EntityIndexWriteStats;
    let token: string;
    try {
      ({ write, token } = db.transaction(() => {
        const counts = applyIndexDelta(storage, bookId, delta, state.desired, now);
        return { write: { mode: "diff" as const, baseline: "snapshot" as const, ...counts }, token: markEntityIndexSynced(storage, bookId) };
      })());
    } catch (error) {
      forgetSnapshot(storage, bookId);
      throw error;
    }
    rememberSnapshot(storage, bookId, state.desired, { state, epoch: epoch!, token }, dataVersionAtRead);
    const stats = statsOf(state);
    const derivation: EntityIndexDerivation = { mode: "incremental" };
    noteRefresh(storage, bookId, derivation, stats);
    return { ok: true, bookId, applied: true, ...stats, write, derivation };
  } catch (error) {
    // 合并已开始（state 被就地改过）时无论因何失败都丢掉快照，不让半套状态留到下次
    if (!snapshotUsable) forgetSnapshot(storage, bookId);
    if (!(error instanceof IncrementalFallback)) throw error;
    fallbackReason = error.reason;
  }

  // ── 整本
  const { plan, state, incrementable } = deriveFull(storage, bookId, { dictionary, fingerprint });
  const desired = state.desired;
  let write: EntityIndexWriteStats;
  let token: string;
  try {
    ({ write, token } = db.transaction(() => {
      const baseline = snapshotUsable && snapshot ? "snapshot" as const : "database" as const;
      const current = baseline === "snapshot" ? signaturesOf(snapshot!.desired) : readIndexSignatures(storage, bookId);
      const counts = applyIndexDelta(storage, bookId, diffIndex(current, desired), desired, now);
      return { write: { mode: "diff" as const, baseline, ...counts }, token: markEntityIndexSynced(storage, bookId) };
    })());
  } catch (error) {
    // 回滚后库里是旧索引，快照可能已不对应；下次从库里读回
    forgetSnapshot(storage, bookId);
    throw error;
  }
  rememberSnapshot(storage, bookId, desired, incrementable && epoch !== null ? { state, epoch, token } : null, dataVersionAtRead);
  const derivation: EntityIndexDerivation = { mode: "full", fallbackReason };
  noteRefresh(storage, bookId, derivation, plan.stats);
  return { ok: true, bookId, applied: true, ...plan.stats, write, derivation };
}

function diffIndex(current: SignatureIndex, desired: DesiredIndex): IndexDelta {
  /** 分出：要删的旧键、要新插的键、签名变了的键。 */
  const split = <T>(currentRows: Map<string, string>, desiredRows: Map<string, DesiredRow<T>>): TableDelta => {
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
  return {
    entities: split(current.entities, desired.entities),
    aliases: split(current.aliases, desired.aliases),
    participants: split(current.participants, desired.participants),
    relations: split(current.relations, desired.relations),
    stateChanges: split(current.stateChanges, desired.stateChanges),
    knowledge: split(current.knowledge, desired.knowledge),
  };
}

function applyIndexDelta(
  storage: StorageDatabase,
  bookId: string,
  delta: IndexDelta,
  desired: DesiredIndex,
  now: number,
): { inserted: number; updated: number; deleted: number } {
  const db = storage.sqlite;
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  const { entities: entityDiff, aliases: aliasDiff, participants: participantDiff, relations: relationDiff, stateChanges: stateDiff, knowledge: knowledgeDiff } = delta;

  // ① 子表：删掉不再需要的行；签名变了的行也先删（后面重插），避免唯一键在逐行更新时互相顶撞
  const deleteParticipant = db.prepare("DELETE FROM narrative_event_participant WHERE book_id = ? AND event_id = ? AND entity_id = ? AND role = ?");
  for (const key of participantDiff.removed) {
    const [eventId, entityId, role] = key.split("\u0000");
    deleted += Number(deleteParticipant.run(bookId, eventId, entityId, role).changes);
  }
  const deleteById = (table: string, ids: readonly string[]) => {
    if (ids.length === 0) return;
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
  if (options.dryRun) return { ok: true, bookId, applied: false, ...planNarrativeEntityIndex(storage, bookId).stats };

  // 先装好变更捕获再推导：推导之后的写入都会被记下，下次结算才能增量
  const epoch = ensureEntityIndexChangeTracking(storage);
  const dataVersionAtRead = dataVersion(storage);
  const { plan, state, incrementable } = deriveFull(storage, bookId);
  const now = options.now ?? Date.now();
  const db = storage.sqlite;
  const desired = state.desired;
  const statements = insertStatements(storage);
  const insertEntity = statements.entity;
  const insertAlias = statements.alias;
  const insertParticipant = statements.participant;
  const insertRelation = statements.relation;
  const insertState = statements.state;
  const insertKnowledge = statements.knowledge;

  let token: string;
  try {
    token = db.transaction(() => {
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
      return markEntityIndexSynced(storage, bookId);
    })();
  } catch (error) {
    forgetSnapshot(storage, bookId);
    throw error;
  }
  rememberSnapshot(storage, bookId, desired, incrementable && epoch !== null ? { state, epoch, token } : null, dataVersionAtRead);
  const rowCount = (map: Map<string, unknown>) => map.size;
  const write: EntityIndexWriteStats = {
    mode: "full",
    inserted: rowCount(desired.entities) + rowCount(desired.aliases) + rowCount(desired.participants) + rowCount(desired.relations) + rowCount(desired.stateChanges) + rowCount(desired.knowledge),
    updated: 0,
    deleted: 0,
  };
  return { ok: true, bookId, applied: true, ...plan.stats, write };
}
