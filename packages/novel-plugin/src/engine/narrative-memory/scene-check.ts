/**
 * 轻量场景校验 S1：两类确定性的硬矛盾检测。
 *
 * 1. 死亡后又行动（scene-dead-acts）——同时满足才报：
 *    - 截至上一章该实体仍处于死亡：最后一条「生死 = 死亡」之后没有「生死 = 复活」。
 *      「存活」不解除死亡——死后被记为存活，本身就是矛盾（多半是正文让死人重新登场、模型照实记了存活）；
 *      只有「复活」才算交代过，以取值为准，不靠正文关键词猜。
 *    - 本章有矛盾证据（证据都须是本章正文原文，并含该实体的称呼）：
 *      a) 该实体作为行动方（参与者 role = agent）的已应用「行动类」事件（ACTION_EVENT_TYPES，
 *         且谓词不含 NON_ACTION_PREDICATE_MARKERS）；以它为主体的生死、死因、状态类事件不算行动；
 *      b) 或本章该实体的「生死 = 存活」记录。
 *    - 本章没有该实体的「生死 = 复活」。
 *    只在正文里被提及、没有作为行动方出现的（回忆、梦境、灵位）不报。
 *    「去向 = 离场」不触发：日常离开现场（回宅、出门）太常见，作为硬矛盾判据误报率太高。
 * 2. 章与章之间地点跳变无过渡（scene-location-jump）——同时满足才报：
 *    - 人物 A 截至上一章「所在 = X」，本章出现在 Y：
 *      · 本章有带出场人物的蓝图场景（narrative_scene）时，Y = A 所在场景的地点；
 *      · A 不在这类场景里（导入或纯结算的书没有带人物的场景）时，Y = 本章 A 的首个「所在」记录
 *        （按证据在正文中的位置），且 A 在本章出场名单（结算记下的全量出场 + 事件参与者）里；
 *    - X 与 Y 用实体索引归并后是两个不同的地点实体（任一侧归并不到就不报）；
 *    - A 所在地变化附近没有旅途或时间过渡标记（TRAVEL_TRANSITION_MARKERS / 「N 日后」类时间跨度）：
 *      看本章 A 的「所在」记录与 location_changed 事件的证据原文及其在正文中的前后文；没有记录时看 A 在正文里的首句前后。
 *      有位置记录不等于有过渡——那条记录往往就是跳变本身。
 *    只做确定性判定，不调用模型。拿不到正文或正文里找不到 A 时不报。
 *
 * 数据只读：状态取实体索引刷新后的状态流水（narrative_state_change，谓词已按 state-predicate 归一），
 * 行动方取事件参与者（narrative_event_participant），只认已应用的事件与事实。
 * 检测结果不落盘；作者「忽略此条」的裁决记在 narrative_consistency_ignore（迁移 0041），
 * 键 = 检测类型 + 实体 id + 章号 + 记忆事实 id。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { DiagnosticExplanation } from "../../handlers/diagnostic-explanation.js";
import { derivedRowId } from "../narrative-entity/knowledge-index.js";
import { listScenesByChapter } from "./scene-store.js";
import {
  LIFE_ALIVE,
  LIFE_DEAD,
  LIFE_REVIVED,
  LIFE_SLOT,
  LOCATION_SLOT,
} from "./state-predicate.js";

/**
 * 算「行动」的事件类型：实体作为一方主动对他人做了什么。
 * character_state_changed（生死、死因、伤势等状态）不算；location_changed 也不算——
 * 「尸身运回义庄」「葬于城外」这类位置记录主体是死者，却不是他在行动。
 */
export const ACTION_EVENT_TYPES: readonly string[] = ["relationship_changed"];

/** 谓词里出现这些字样的关系事件不算行动：被动、死亡、丧葬、追忆、梦境、生前关系。 */
export const NON_ACTION_PREDICATE_MARKERS: readonly string[] = [
  "被", "死", "亡", "遇害", "尸", "葬", "祭", "悼", "怀念", "想起", "回忆", "梦", "生前", "遗",
];

/**
 * 旅途或时间过渡标记：A 所在地变化附近出现任一个，就算交代了怎么过去的。
 * 另有「N 日 / 天 / 月 / 年 后」类时间跨度，见 TIME_SPAN_PATTERN。
 */
export const TRAVEL_TRANSITION_MARKERS: readonly string[] = [
  "启程", "动身", "上路", "出发", "赶路", "赶到", "赶来", "赶往", "奔赴", "前往", "抵达", "到达", "来到",
  "一路", "沿途", "途经", "途中", "路上", "出城", "进城", "入城", "跋涉", "辗转", "风尘仆仆",
  "日夜兼程", "马不停蹄", "快马", "策马", "乘船", "连夜", "数日", "几日", "多日", "次日", "翌日", "半月",
];
const TIME_SPAN_PATTERN = /[一二三四五六七八九十两几数半\d]+[日天月年旬]([之以]?后|过去)/u;
/** 位置记录在正文里的前后文窗口（字数，忽略空白）：过渡通常写在到达之前。 */
const TRANSITION_WINDOW_BEFORE = 80;
const TRANSITION_WINDOW_AFTER = 40;

export function hasTransitionMarker(text: string): boolean {
  return TRAVEL_TRANSITION_MARKERS.some((marker) => text.includes(marker)) || TIME_SPAN_PATTERN.test(text);
}

/** 片段本身，或它在正文中（忽略空白）前后窗口内，有过渡标记。 */
export function transitionNear(chapterText: string, snippet: string): boolean {
  if (hasTransitionMarker(snippet)) return true;
  const body = compact(chapterText);
  const key = compact(snippet);
  if (!key) return false;
  const at = body.indexOf(key);
  if (at < 0) return false;
  return hasTransitionMarker(body.slice(Math.max(0, at - TRANSITION_WINDOW_BEFORE), at + key.length + TRANSITION_WINDOW_AFTER));
}

function isActionPredicate(predicate: string): boolean {
  return !NON_ACTION_PREDICATE_MARKERS.some((marker) => predicate.includes(marker));
}

export const SCENE_DEAD_ACTS = "scene-dead-acts";
export const SCENE_LOCATION_JUMP = "scene-location-jump";
export type SceneCheckKind = typeof SCENE_DEAD_ACTS | typeof SCENE_LOCATION_JUMP;

export interface SceneCheckFinding {
  readonly kind: SceneCheckKind;
  readonly severity: "warning";
  readonly title: string;
  readonly detail: string;
  /** 实体规范名（展示用）。 */
  readonly entity: string;
  /** 实体索引 id（ent:<bookId>:<经纬条目 id>），忽略键的一部分。 */
  readonly entityId: string;
  /** 经纬条目 id，供「看条目」跳转。 */
  readonly jingweiEntryId?: string;
  /** 被检查的章（矛盾出现的那一章）。 */
  readonly chapterNumber: number;
  /** 正文原文句子：行动事件的证据 / 人物在本章的首句。 */
  readonly evidenceText: string;
  /** 记忆侧依据：截至上一章的那条状态事实。 */
  readonly factId: string;
  readonly memoryChapter: number;
  readonly memoryPredicate: string;
  readonly memoryValue: string;
  /** 地点跳变：本章的地点（蓝图场景的地点，或没有场景时本章首个「所在」）。 */
  readonly sceneLocation?: string;
  /** 死亡后行动：本章那条行动事件。 */
  readonly eventId?: string;
  readonly explanation: DiagnosticExplanation;
}

export interface SceneCheckInput {
  readonly bookId: string;
  /** 只检查这些章；缺省检查截至 asOfChapter（或全书）的全部有记录的章。 */
  readonly chapters?: readonly number[];
  readonly asOfChapter?: number;
  /** 读取某章正文。缺省时：行动证据只要求非空，地点跳变因看不到正文（首句、过渡标记）而不报。 */
  readonly loadChapterText?: (chapterNumber: number) => Promise<string | undefined> | string | undefined;
}

interface StateRow {
  readonly id: string;
  readonly entityId: string;
  readonly entryId: string | null;
  readonly name: string;
  readonly fluent: string;
  readonly value: string;
  readonly chapter: number;
  /** 产生这条状态的事实证据（正文原文摘录）。 */
  readonly evidence: string;
}

interface StateFact {
  readonly factId: string;
  readonly predicate: string;
  readonly validUntil: number | null;
  readonly applied: boolean;
}

interface ResolvedState extends StateRow {
  readonly factId: string;
  readonly predicate: string;
  readonly validUntil: number | null;
}

const CHECK_FLUENTS = [LIFE_SLOT, LOCATION_SLOT] as const;

function tableExists(storage: StorageDatabase, name: string): boolean {
  return Boolean(storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name));
}

function compact(text: string): string {
  return text.replace(/\s+/gu, "");
}

/**
 * 读三类硬状态的状态流水，并把每一行对回产生它的已应用事实。
 * 状态流水行 id = derivedRowId(`st:<事实 id>:<经纬条目 id>`)，据此反查事实；对不上的行（来源不明）丢弃。
 * 被作者作废的事实（已关闭、且同实体同方面没有接替它的后续记录）也丢弃。
 */
function loadResolvedStates(storage: StorageDatabase, bookId: string, upToChapter: number): ResolvedState[] {
  const rows = storage.sqlite.prepare<{ id: string; entity_id: string; entry_id: string | null; canonical_name: string; fluent: string; new_value: string; chapter_number: number; evidence_text: string | null }>(`
    SELECT s.id, s.entity_id, e.entry_id, e.canonical_name, s.fluent, s.new_value, s.chapter_number, s.evidence_text
    FROM narrative_state_change s
    JOIN narrative_entity e ON e.id = s.entity_id
    WHERE s.book_id = ? AND s.fluent IN (${CHECK_FLUENTS.map(() => "?").join(", ")}) AND s.chapter_number <= ?
    ORDER BY s.chapter_number ASC, s.id ASC
  `).all(bookId, ...CHECK_FLUENTS, upToChapter).map((row): StateRow => ({
    id: row.id,
    entityId: row.entity_id,
    entryId: row.entry_id,
    name: row.canonical_name,
    fluent: row.fluent,
    value: String(row.new_value ?? "").trim(),
    chapter: row.chapter_number,
    evidence: String(row.evidence_text ?? "").trim(),
  }));
  if (rows.length === 0) return [];

  const chapters = [...new Set(rows.map((row) => row.chapter))];
  const entryIdsByChapter = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!row.entryId) continue;
    let set = entryIdsByChapter.get(row.chapter);
    if (!set) entryIdsByChapter.set(row.chapter, (set = new Set()));
    set.add(row.entryId);
  }
  const facts = storage.sqlite.prepare<{ id: string; predicate: string; chapter: number; valid_until_chapter: number | null; source_type: string; event_status: string | null }>(`
    SELECT f.id, f.predicate, COALESCE(f.source_chapter, f.valid_from_chapter) AS chapter, f.valid_until_chapter,
           f.source_type, ev.status AS event_status
    FROM narrative_fact f
    LEFT JOIN narrative_event ev ON ev.id = f.source_id AND ev.book_id = f.book_id
    WHERE f.book_id = ? AND f.category IN ('character_state', 'location')
      AND COALESCE(f.source_chapter, f.valid_from_chapter) IN (${chapters.map(() => "?").join(", ")})
  `).all(bookId, ...chapters);
  const byRowId = new Map<string, StateFact>();
  for (const fact of facts) {
    for (const entryId of entryIdsByChapter.get(fact.chapter) ?? []) {
      byRowId.set(derivedRowId(`st:${fact.id}:${entryId}`), {
        factId: fact.id,
        predicate: fact.predicate,
        validUntil: fact.valid_until_chapter,
        applied: fact.source_type !== "event" || fact.event_status === "applied",
      });
    }
  }

  const resolved: ResolvedState[] = [];
  for (const row of rows) {
    const fact = byRowId.get(row.id);
    if (!fact || !fact.applied || !row.value) continue;
    resolved.push({ ...row, factId: fact.factId, predicate: fact.predicate, validUntil: fact.validUntil });
  }
  // 已关闭但没有接替者 = 作者作废（或改写后作废），不再代表当时的状态。
  return resolved.filter((row) => row.validUntil === null || resolved.some((other) =>
    other !== row
    && other.factId !== row.factId
    && other.entityId === row.entityId
    && other.fluent === row.fluent
    && other.chapter >= row.chapter
    && other.chapter <= row.validUntil!));
}

/** 截至某章（含）每个实体每个方面的最后一条状态。 */
function latestStates(states: readonly ResolvedState[], upToChapter: number): Map<string, ResolvedState> {
  const latest = new Map<string, ResolvedState>();
  for (const state of states) {
    if (state.chapter > upToChapter) continue;
    latest.set(`${state.entityId}\u0000${state.fluent}`, state);
  }
  return latest;
}

interface EntityNames {
  readonly byName: Map<string, string>;
  readonly namesById: Map<string, string[]>;
  readonly entities: Map<string, { name: string; entryId: string | null; type: string }>;
}

function loadEntityNames(storage: StorageDatabase, bookId: string): EntityNames {
  const entities = new Map<string, { name: string; entryId: string | null; type: string }>();
  const byName = new Map<string, string>();
  const namesById = new Map<string, string[]>();
  const push = (name: string, entityId: string) => {
    const key = name.trim();
    if (!key) return;
    if (!byName.has(key)) byName.set(key, entityId);
    const list = namesById.get(entityId) ?? [];
    if (!list.includes(key)) list.push(key);
    namesById.set(entityId, list);
  };
  for (const row of storage.sqlite.prepare<{ id: string; canonical_name: string; entry_id: string | null; entity_type: string }>(
    "SELECT id, canonical_name, entry_id, entity_type FROM narrative_entity WHERE book_id = ?",
  ).all(bookId)) {
    entities.set(row.id, { name: row.canonical_name, entryId: row.entry_id, type: row.entity_type });
    push(row.canonical_name, row.id);
  }
  for (const row of storage.sqlite.prepare<{ alias: string; entity_id: string }>(
    "SELECT alias, entity_id FROM narrative_entity_alias WHERE book_id = ?",
  ).all(bookId)) {
    push(row.alias, row.entity_id);
  }
  return { byName, namesById, entities };
}

function resolveName(names: EntityNames, raw: string | undefined, type?: string): string | null {
  const key = raw?.trim();
  if (!key) return null;
  const hit = names.byName.get(key) ?? names.byName.get(key.replace(/\s*[（(][^()（）]+[)）]\s*$/u, "").trim());
  if (!hit) return null;
  if (type && names.entities.get(hit)?.type !== type) return null;
  return hit;
}

/** A 在本章正文里的首句（含 A 的任一称呼）；按 。！？!?… 与换行断句。 */
export function firstSentenceMentioning(text: string, names: readonly string[]): string | null {
  const keys = names.map((name) => name.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return null;
  const sentences = text.split(/(?<=[。！？!?…])|\n+/u);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed && keys.some((key) => trimmed.includes(key))) return trimmed.slice(0, 200);
  }
  return null;
}

/** 蓝图场景的地点：已归并的 locationEntityId 优先，否则读 summary 里的「[地点: …]」前缀。 */
function sceneLocationName(scene: { readonly locationEntityId?: string; readonly summary: string }, names: EntityNames): { entityId: string | null; label: string } | null {
  if (scene.locationEntityId) {
    const entity = names.entities.get(scene.locationEntityId);
    return { entityId: entity ? scene.locationEntityId : null, label: entity?.name ?? scene.locationEntityId };
  }
  const match = scene.summary.match(/^\[地点:\s*([^\]]+)\]/u);
  const label = match?.[1]?.trim();
  if (!label) return null;
  return { entityId: resolveName(names, label, "location"), label };
}

/**
 * 本章出场名单（实体 id）：结算记下的全量出场（narrative_chapter_mention）归并到实体，
 * 加本章已应用事件的参与者。名单表缺失（旧库）时只用参与者。
 */
function chapterCast(storage: StorageDatabase, bookId: string, chapter: number, names: EntityNames): Set<string> {
  const cast = new Set<string>();
  const byEntry = new Map<string, string>();
  for (const [id, entity] of names.entities) if (entity.entryId) byEntry.set(entity.entryId, id);
  if (tableExists(storage, "narrative_chapter_mention")) {
    for (const row of storage.sqlite.prepare<{ entity_name: string; entry_id: string | null }>(
      "SELECT entity_name, entry_id FROM narrative_chapter_mention WHERE book_id = ? AND chapter_number = ?",
    ).all(bookId, chapter)) {
      const hit = (row.entry_id ? byEntry.get(row.entry_id) : undefined) ?? resolveName(names, row.entity_name);
      if (hit) cast.add(hit);
    }
  }
  for (const row of storage.sqlite.prepare<{ entity_id: string }>(`
    SELECT DISTINCT p.entity_id FROM narrative_event_participant p
    JOIN narrative_event ev ON ev.id = p.event_id
    WHERE p.book_id = ? AND ev.book_id = ? AND ev.chapter_number = ? AND ev.status = 'applied'
  `).all(bookId, bookId, chapter)) cast.add(row.entity_id);
  return cast;
}

function chaptersToCheck(storage: StorageDatabase, input: SceneCheckInput): number[] {
  if (input.chapters) return [...new Set(input.chapters.filter((chapter) => Number.isInteger(chapter) && chapter > 1))].sort((a, b) => a - b);
  const cap = input.asOfChapter ?? Number.MAX_SAFE_INTEGER;
  const rows = storage.sqlite.prepare<{ chapter: number }>(`
    SELECT chapter_number AS chapter FROM narrative_event WHERE book_id = ? AND status = 'applied' AND chapter_number <= ?
    UNION
    SELECT chapter_number AS chapter FROM narrative_scene WHERE book_id = ? AND chapter_number <= ?
  `).all(input.bookId, cap, input.bookId, cap);
  return rows.map((row) => row.chapter).filter((chapter) => Number.isInteger(chapter) && chapter > 1).sort((a, b) => a - b);
}

/**
 * 运行两个场景检测器。表缺失（旧库尚未迁移到 0032 / 0035）时返回空，不抛错。
 * 只读；不改正文、不写待确认、不经过高风险闸门。
 */
export async function runSceneChecks(storage: StorageDatabase, input: SceneCheckInput): Promise<SceneCheckFinding[]> {
  const required = ["narrative_state_change", "narrative_entity", "narrative_entity_alias", "narrative_event_participant", "narrative_event", "narrative_fact", "narrative_scene"];
  if (!required.every((table) => tableExists(storage, table))) return [];
  const chapters = chaptersToCheck(storage, input);
  if (chapters.length === 0) return [];
  const maxChapter = chapters[chapters.length - 1]!;
  const states = loadResolvedStates(storage, input.bookId, maxChapter);
  if (states.length === 0) return [];
  const names = loadEntityNames(storage, input.bookId);

  const textCache = new Map<number, string | undefined>();
  const textOf = async (chapter: number): Promise<string | undefined> => {
    if (!input.loadChapterText) return undefined;
    if (!textCache.has(chapter)) textCache.set(chapter, (await input.loadChapterText(chapter)) || undefined);
    return textCache.get(chapter);
  };

  const lifeHistory = states.filter((state) => state.fluent === LIFE_SLOT);
  const findings: SceneCheckFinding[] = [];
  for (const chapter of chapters) {
    const before = latestStates(states, chapter - 1);
    const thisChapter = states.filter((state) => state.chapter === chapter);
    findings.push(...await detectDeadActs(storage, input.bookId, chapter, lifeHistory, names, textOf));
    findings.push(...await detectLocationJumps(storage, input.bookId, chapter, before, thisChapter, names, textOf));
  }
  return findings;
}

async function detectDeadActs(
  storage: StorageDatabase,
  bookId: string,
  chapter: number,
  /** 全书生死槽状态，按章号升序。 */
  lifeHistory: readonly ResolvedState[],
  names: EntityNames,
  textOf: (chapter: number) => Promise<string | undefined>,
): Promise<SceneCheckFinding[]> {
  const text = await textOf(chapter);
  const findings: SceneCheckFinding[] = [];
  // 截至上一章仍死亡：生死槽的最后一条取值是「死亡」，或者「死亡」之后只有「存活」（存活不解除死亡）。
  const deadPriors = new Map<string, ResolvedState>();
  for (const state of lifeHistory) {
    if (state.chapter >= chapter) continue;
    if (state.value === LIFE_DEAD) deadPriors.set(state.entityId, state);
    else if (state.value === LIFE_REVIVED) deadPriors.delete(state.entityId);
  }
  if (deadPriors.size === 0) return [];
  const revivedNow = new Set(lifeHistory
    .filter((state) => state.chapter === chapter && state.value === LIFE_REVIVED)
    .map((state) => state.entityId));

  const placeholders = ACTION_EVENT_TYPES.map(() => "?").join(", ");
  const actors = storage.sqlite.prepare<{ entity_id: string; event_id: string; evidence_text: string; predicate: string }>(`
    SELECT p.entity_id, ev.id AS event_id, ev.evidence_text, ev.predicate
    FROM narrative_event_participant p
    JOIN narrative_event ev ON ev.id = p.event_id
    WHERE p.book_id = ? AND p.role = 'agent' AND ev.book_id = ? AND ev.chapter_number = ? AND ev.status = 'applied'
      AND ev.event_type IN (${placeholders})
    ORDER BY ev.id ASC
  `).all(bookId, bookId, chapter, ...ACTION_EVENT_TYPES);

  // 证据候选：先行动类事件，再「死后被记为存活」的状态记录。
  const candidates: Array<{ entityId: string; evidence: string; eventId?: string; how: "acts" | "alive" }> = [];
  for (const actor of actors) {
    if (!isActionPredicate(String(actor.predicate ?? ""))) continue;
    candidates.push({ entityId: actor.entity_id, evidence: actor.evidence_text?.trim() ?? "", eventId: actor.event_id, how: "acts" });
  }
  for (const state of lifeHistory) {
    if (state.chapter !== chapter || state.value !== LIFE_ALIVE) continue;
    candidates.push({ entityId: state.entityId, evidence: state.evidence, how: "alive" });
  }

  const reported = new Set<string>();
  for (const candidate of candidates) {
    if (reported.has(candidate.entityId)) continue;
    const prior = deadPriors.get(candidate.entityId);
    if (!prior || revivedNow.has(candidate.entityId)) continue;
    const evidence = candidate.evidence;
    if (!evidence) continue;
    // 证据必须是正文原文；拿得到正文时逐字核对（忽略空白），对不上就不确定、不报。
    if (text !== undefined && !compact(text).includes(compact(evidence))) continue;
    // 证据里得有这个人：他不在句子里，就不是「他在行动」的证据。
    const ownNames = names.namesById.get(candidate.entityId) ?? [prior.name];
    if (!ownNames.some((alias) => evidence.includes(alias))) continue;
    reported.add(candidate.entityId);
    const entity = names.entities.get(candidate.entityId);
    const name = entity?.name ?? prior.name;
    const how = candidate.how === "acts"
      ? `${name} 却是动手的一方`
      : `${name} 又被当作活人记了一笔（叙事记忆记成「${LIFE_SLOT} = ${LIFE_ALIVE}」）`;
    findings.push({
      kind: SCENE_DEAD_ACTS,
      severity: "warning",
      title: `${name} 已死亡，第 ${chapter} 章又在行动`,
      detail: `第 ${prior.chapter} 章记下 ${name}「${prior.fluent} = ${prior.value}」，第 ${chapter} 章正文里 ${name} ${candidate.how === "acts" ? "作为行动方出现" : "被记为存活"}，本章没有复活的交代。`,
      entity: name,
      entityId: candidate.entityId,
      ...(entity?.entryId ? { jingweiEntryId: entity.entryId } : {}),
      chapterNumber: chapter,
      evidenceText: evidence,
      factId: prior.factId,
      memoryChapter: prior.chapter,
      memoryPredicate: prior.predicate,
      memoryValue: prior.value,
      ...(candidate.eventId ? { eventId: candidate.eventId } : {}),
      explanation: {
        whatHappened: `第 ${prior.chapter} 章的叙事记忆记着 ${name}已死亡；第 ${chapter} 章正文「${evidence.slice(0, 60)}」里，${how}，本章没有写复活。`,
        whyItMatters: `读者记得 ${name}已死亡。没有交代就让人重新出手，会被当成作者忘了前文；续写也会在「人还在不在」上越写越乱。`,
        suggestedAction: `核对第 ${chapter} 章：若是回忆、梦境或别人冒名，在正文里写清楚；若 ${name} 真的复活了，补一句交代后重新结算（记忆里要记成「${LIFE_SLOT} = ${LIFE_REVIVED}」）；若第 ${prior.chapter} 章那条「${prior.value}」是抽错的，去叙事记忆里作废它。确认没问题可点「忽略此条」。`,
      },
    });
  }
  return findings;
}

async function detectLocationJumps(
  storage: StorageDatabase,
  bookId: string,
  chapter: number,
  before: ReadonlyMap<string, ResolvedState>,
  thisChapter: readonly ResolvedState[],
  names: EntityNames,
  textOf: (chapter: number) => Promise<string | undefined>,
): Promise<SceneCheckFinding[]> {
  const text = await textOf(chapter);
  if (!text) return [];
  const scenes = listScenesByChapter(storage, bookId, chapter).filter((scene) => scene.characters.length > 0);
  type Candidate = { entityId: string; place: { entityId: string; label: string }; prior: ResolvedState; priorPlace: string; basis: "scene" | "state" };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const consider = (entityId: string, place: { entityId: string; label: string }, basis: Candidate["basis"]) => {
    if (seen.has(entityId)) return;
    seen.add(entityId);
    const prior = before.get(`${entityId}\u0000${LOCATION_SLOT}`);
    if (!prior) return;
    const priorPlace = resolveName(names, prior.value, "location");
    // 地点用实体索引归并后再比；上一章的地点归并不到实体时无法判定是否同一处，不报。
    if (!priorPlace || priorPlace === place.entityId) return;
    candidates.push({ entityId, place, prior, priorPlace, basis });
  };

  for (const scene of scenes) {
    const place = sceneLocationName(scene, names);
    if (!place?.entityId) continue;
    for (const character of scene.characters) {
      // 场景人物按写入口径存名字；作者接口也可能存实体 id，两种都认。
      const entityId = names.entities.has(character) ? character : resolveName(names, character, "character");
      if (entityId && names.entities.get(entityId)?.type === "character") consider(entityId, { entityId: place.entityId, label: place.label }, "scene");
    }
  }
  {
    // 没有落在「带人物且地点可归并」的场景里的人物（导入或纯结算的书没有这种场景）：
    // 本章出场名单里的人物，取本章首个「所在」作为本章地点。
    const cast = chapterCast(storage, bookId, chapter, names);
    const body = compact(text);
    // 「首个」按证据在正文里的位置排；证据对不上正文的排在最后。
    const positionOf = (state: ResolvedState) => {
      const at = state.evidence ? body.indexOf(compact(state.evidence)) : -1;
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const firstPlace = new Map<string, ResolvedState>();
    for (const state of thisChapter) {
      if (state.fluent !== LOCATION_SLOT || !cast.has(state.entityId)) continue;
      if (names.entities.get(state.entityId)?.type !== "character") continue;
      const current = firstPlace.get(state.entityId);
      if (!current || positionOf(state) < positionOf(current)) firstPlace.set(state.entityId, state);
    }
    for (const [entityId, state] of firstPlace) {
      const placeId = resolveName(names, state.value, "location");
      // 本章地点归并不到实体：无法判定是否换了地方，不报。
      if (placeId) consider(entityId, { entityId: placeId, label: state.value }, "state");
    }
  }
  if (candidates.length === 0) return [];

  // 本章 A 的位置记录（状态流水 + 未驳回的 location_changed 事件）的证据原文；记录本身不算过渡，要看证据前后有没有过渡标记。
  const moveEvidence = new Map<string, string[]>();
  const pushEvidence = (entityId: string, evidence: string | null | undefined) => {
    const value = String(evidence ?? "").trim();
    if (!value) return;
    const list = moveEvidence.get(entityId) ?? [];
    list.push(value);
    moveEvidence.set(entityId, list);
  };
  for (const state of thisChapter) if (state.fluent === LOCATION_SLOT) pushEvidence(state.entityId, state.evidence);
  for (const event of storage.sqlite.prepare<{ subject: string; subject_entry_id: string | null; evidence_text: string | null }>(`
    SELECT subject, subject_entry_id, evidence_text FROM narrative_event
    WHERE book_id = ? AND chapter_number = ? AND event_type = 'location_changed' AND status != 'rejected'
  `).all(bookId, chapter)) {
    const hit = (event.subject_entry_id && [...names.entities].find(([, value]) => value.entryId === event.subject_entry_id)?.[0])
      || resolveName(names, event.subject);
    if (hit) pushEvidence(hit, event.evidence_text);
  }

  const findings: SceneCheckFinding[] = [];
  for (const candidate of candidates) {
    const ownNames = names.namesById.get(candidate.entityId) ?? [];
    const sentence = firstSentenceMentioning(text, ownNames);
    if (!sentence) continue;
    const evidences = moveEvidence.get(candidate.entityId) ?? [];
    // 过渡判据：位置记录的证据或它在正文中的前后文有旅途 / 时间过渡标记；没有位置记录时看 A 首句前后。
    const transitioned = [...evidences, sentence].some((snippet) => transitionNear(text, snippet));
    if (transitioned) continue;
    const entity = names.entities.get(candidate.entityId);
    const name = entity?.name ?? candidate.prior.name;
    const from = names.entities.get(candidate.priorPlace)?.name ?? candidate.prior.value;
    const to = names.entities.get(candidate.place.entityId)?.name ?? candidate.place.label;
    const whereNow = candidate.basis === "scene" ? `第 ${chapter} 章蓝图场景在「${to}」` : `第 ${chapter} 章记下 ${name} 在「${to}」`;
    findings.push({
      kind: SCENE_LOCATION_JUMP,
      severity: "warning",
      title: `${name} 从「${from}」直接到了「${to}」`,
      detail: `截至第 ${chapter - 1} 章 ${name} 在「${from}」，${whereNow}，本章没有写 ${name} 怎么过去的（找不到赶路或时间过渡）。`,
      entity: name,
      entityId: candidate.entityId,
      ...(entity?.entryId ? { jingweiEntryId: entity.entryId } : {}),
      chapterNumber: chapter,
      evidenceText: sentence,
      factId: candidate.prior.factId,
      memoryChapter: candidate.prior.chapter,
      memoryPredicate: candidate.prior.predicate,
      memoryValue: candidate.prior.value,
      sceneLocation: to,
      explanation: {
        whatHappened: `第 ${candidate.prior.chapter} 章记下 ${name} 在「${from}」；第 ${chapter} 章 ${name} 一出场「${sentence.slice(0, 60)}」就已经在「${to}」，正文里找不到赶路、启程或「几日后」这类过渡。`,
        whyItMatters: "两地之间没有过渡，读者会觉得人物瞬移；路程、时间线和同行的人也会跟着对不上。",
        suggestedAction: `在第 ${chapter} 章开头补一句赶路或时间跳跃（如「三日后抵达${to}」）再重新结算；若 ${name} 其实早就动身，补上中间章节的交代；若第 ${candidate.prior.chapter} 章的「${from}」是抽错的，去叙事记忆里纠正它。确认没问题可点「忽略此条」。`,
      },
    });
  }
  return findings;
}

// ─── 作者裁决：忽略此条 ─────────────────────────────────────────────────────

export interface ConsistencyIgnoreKey {
  readonly kind: string;
  readonly entityId: string;
  readonly chapterNumber: number;
  readonly factId: string;
}

export interface ConsistencyIgnoreRow extends ConsistencyIgnoreKey {
  readonly createdAt: number;
}

function cleanKey(key: ConsistencyIgnoreKey): ConsistencyIgnoreKey {
  return {
    kind: String(key.kind ?? "").trim(),
    entityId: String(key.entityId ?? "").trim(),
    chapterNumber: Number.isSafeInteger(key.chapterNumber) && key.chapterNumber > 0 ? key.chapterNumber : 0,
    factId: String(key.factId ?? "").trim(),
  };
}

export function ignoreKeyString(key: ConsistencyIgnoreKey): string {
  const cleaned = cleanKey(key);
  return [cleaned.kind, cleaned.entityId, cleaned.chapterNumber, cleaned.factId].join("\u0000");
}

export function listConsistencyIgnores(storage: StorageDatabase, bookId: string): ConsistencyIgnoreRow[] {
  if (!tableExists(storage, "narrative_consistency_ignore")) return [];
  return storage.sqlite.prepare<{ kind: string; entity_id: string; chapter_number: number; fact_id: string; created_at: number }>(`
    SELECT kind, entity_id, chapter_number, fact_id, created_at
    FROM narrative_consistency_ignore WHERE book_id = ?
    ORDER BY created_at DESC
  `).all(bookId).map((row) => ({
    kind: row.kind,
    entityId: row.entity_id,
    chapterNumber: row.chapter_number,
    factId: row.fact_id,
    createdAt: row.created_at,
  }));
}

export function addConsistencyIgnore(storage: StorageDatabase, bookId: string, key: ConsistencyIgnoreKey, now: number = Date.now()): ConsistencyIgnoreKey {
  const cleaned = cleanKey(key);
  if (!cleaned.kind) throw new Error("忽略项缺少检测类型 kind。");
  storage.sqlite.prepare(`
    INSERT INTO narrative_consistency_ignore (book_id, kind, entity_id, chapter_number, fact_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, kind, entity_id, chapter_number, fact_id) DO NOTHING
  `).run(bookId, cleaned.kind, cleaned.entityId, cleaned.chapterNumber, cleaned.factId, now);
  return cleaned;
}

export function removeConsistencyIgnore(storage: StorageDatabase, bookId: string, key: ConsistencyIgnoreKey): boolean {
  const cleaned = cleanKey(key);
  const result = storage.sqlite.prepare(`
    DELETE FROM narrative_consistency_ignore
    WHERE book_id = ? AND kind = ? AND entity_id = ? AND chapter_number = ? AND fact_id = ?
  `).run(bookId, cleaned.kind, cleaned.entityId, cleaned.chapterNumber, cleaned.factId);
  return Number(result.changes) > 0;
}
