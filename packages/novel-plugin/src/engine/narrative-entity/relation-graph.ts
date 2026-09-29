/**
 * 关系图谱查询层（T4.4）—— 只读实体索引（entity-index.ts 的产物），按实体 id 回答关系问题。
 *
 * 数据来源：
 *   narrative_entity           —— 节点（id = `ent:<bookId>:<经纬条目 id>`，经纬条目是身份唯一权威）
 *   narrative_relation         —— 有向边，带故事内有效期 [valid_from, valid_to)
 *   narrative_event_participant + narrative_event —— 共同事件数（边权重）
 *
 * 这里不写库、不推导实体，也不按名字匹配：一切按实体 id。
 * 查询分两步：loadRelationGraphData 一次读出本书数据，其余都是纯函数，便于单测与复用。
 *
 * 时间切片规则（第 N 章时的关系）：valid_from ≤ N 且（valid_to 为空或 valid_to > N）。
 * 没有给 N 时取「至今」：valid_to 为空的关系。valid_from 为空视为从开篇就成立。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

export interface GraphEntity {
  readonly id: string;
  readonly entryId: string | null;
  readonly name: string;
  readonly type: string;
  readonly firstChapter: number | null;
  readonly lastChapter: number | null;
}

export interface GraphRelation {
  readonly id: string;
  readonly subjectId: string;
  readonly objectId: string;
  readonly predicate: string;
  readonly relationKind: string;
  readonly sentiment: string | null;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly sourceEventId: string | null;
  readonly evidence: string | null;
  readonly confidence: number;
}

export interface GraphParticipation {
  readonly eventId: string;
  readonly entityId: string;
  readonly chapter: number | null;
}

export interface RelationGraphData {
  readonly bookId: string;
  /** 0032 的实体表不存在（迁移未执行）。 */
  readonly schemaMissing: boolean;
  readonly entities: readonly GraphEntity[];
  readonly relations: readonly GraphRelation[];
  readonly participations: readonly GraphParticipation[];
}

export interface GraphExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

// ─── 读取 ────────────────────────────────────────────────────────────────

function tableExists(storage: StorageDatabase, name: string): boolean {
  return Boolean(storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name));
}

function toChapter(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return value !== null && value !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function emptyRelationGraphData(bookId: string, schemaMissing = false): RelationGraphData {
  return { bookId, schemaMissing, entities: [], relations: [], participations: [] };
}

export function loadRelationGraphData(storage: StorageDatabase, bookId: string): RelationGraphData {
  if (!["narrative_entity", "narrative_relation", "narrative_event_participant"].every((table) => tableExists(storage, table))) {
    return emptyRelationGraphData(bookId, true);
  }
  const db = storage.sqlite;
  const entities = db
    .prepare<{ id: string; entry_id: string | null; canonical_name: string; entity_type: string; first_chapter: number | null; last_chapter: number | null }>(`
      SELECT id, entry_id, canonical_name, entity_type, first_chapter, last_chapter
      FROM narrative_entity WHERE book_id = ? ORDER BY canonical_name ASC, id ASC
    `)
    .all(bookId)
    .map((row): GraphEntity => ({
      id: row.id,
      entryId: row.entry_id,
      name: row.canonical_name,
      type: row.entity_type,
      firstChapter: toChapter(row.first_chapter),
      lastChapter: toChapter(row.last_chapter),
    }));
  const relations = db
    .prepare<{
      id: string; subject_id: string; object_id: string; predicate: string; relation_kind: string; sentiment: string | null;
      valid_from: number | null; valid_to: number | null; source_event_id: string | null; evidence_text: string | null; confidence: number | null;
    }>(`
      SELECT id, subject_id, object_id, predicate, relation_kind, sentiment, valid_from, valid_to, source_event_id, evidence_text, confidence
      FROM narrative_relation
      WHERE book_id = ? AND invalidated_at IS NULL
      ORDER BY COALESCE(valid_from, 0) ASC, id ASC
    `)
    .all(bookId)
    .map((row): GraphRelation => ({
      id: row.id,
      subjectId: row.subject_id,
      objectId: row.object_id,
      predicate: row.predicate,
      relationKind: row.relation_kind,
      sentiment: row.sentiment,
      validFrom: toChapter(row.valid_from),
      validTo: toChapter(row.valid_to),
      sourceEventId: row.source_event_id,
      evidence: row.evidence_text,
      confidence: typeof row.confidence === "number" ? row.confidence : 1,
    }));
  const hasEvents = tableExists(storage, "narrative_event");
  const participations = db
    .prepare<{ event_id: string; entity_id: string; chapter_number: number | null }>(hasEvents
      ? `
        SELECT p.event_id, p.entity_id, e.chapter_number
        FROM narrative_event_participant p
        LEFT JOIN narrative_event e ON e.id = p.event_id
        WHERE p.book_id = ?
        ORDER BY p.event_id ASC, p.entity_id ASC
      `
      : `SELECT event_id, entity_id, NULL AS chapter_number FROM narrative_event_participant WHERE book_id = ? ORDER BY event_id ASC, entity_id ASC`)
    .all(bookId)
    .map((row): GraphParticipation => ({ eventId: row.event_id, entityId: row.entity_id, chapter: toChapter(row.chapter_number) }));
  return { bookId, schemaMissing: false, entities, relations, participations };
}

// ─── 基础 ────────────────────────────────────────────────────────────────

/** 第 N 章时关系是否成立；N 缺省表示「至今」。 */
export function isRelationActiveAt(relation: GraphRelation, chapter?: number): boolean {
  if (chapter === undefined) return relation.validTo === null;
  const from = relation.validFrom ?? 0;
  return from <= chapter && (relation.validTo === null || relation.validTo > chapter);
}

/** 截至第 N 章已经发生过（不论是否仍成立）的关系，用于关系史——不剧透第 N 章之后。 */
function isRelationKnownBy(relation: GraphRelation, chapter?: number): boolean {
  return chapter === undefined || (relation.validFrom ?? 0) <= chapter;
}

export function relationsAtChapter(data: RelationGraphData, chapter?: number, entityId?: string): GraphRelation[] {
  return data.relations
    .filter((relation) => isRelationActiveAt(relation, chapter)
      && (entityId === undefined || relation.subjectId === entityId || relation.objectId === entityId))
    .sort(byChapterThenId);
}

function byChapterThenId(left: GraphRelation, right: GraphRelation): number {
  return (left.validFrom ?? 0) - (right.validFrom ?? 0) || left.id.localeCompare(right.id);
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function counterpartOf(relation: GraphRelation, entityId: string): string {
  return relation.subjectId === entityId ? relation.objectId : relation.subjectId;
}

function entityIndex(data: RelationGraphData): Map<string, GraphEntity> {
  return new Map(data.entities.map((entity) => [entity.id, entity]));
}

/** 最晚出现的章：关系起点与事件章号里的最大值，供界面「截至第 N 章」的范围。 */
export function latestGraphChapter(data: RelationGraphData): number | null {
  let max = 0;
  for (const relation of data.relations) max = Math.max(max, relation.validFrom ?? 0, relation.validTo ?? 0);
  for (const participation of data.participations) max = Math.max(max, participation.chapter ?? 0);
  return max > 0 ? max : null;
}

/** 两个实体截至第 N 章共同参与的事件数（同一事件里同为参与者）。 */
export function sharedEventCount(data: RelationGraphData, a: string, b: string, chapter?: number): number {
  const eventsOf = (entityId: string) => new Set(data.participations
    .filter((row) => row.entityId === entityId && (chapter === undefined || row.chapter === null || row.chapter <= chapter))
    .map((row) => row.eventId));
  const left = eventsOf(a);
  let count = 0;
  for (const eventId of eventsOf(b)) if (left.has(eventId)) count += 1;
  return count;
}

function sharedEventCounter(data: RelationGraphData, chapter?: number): (a: string, b: string) => number {
  const byEvent = new Map<string, Set<string>>();
  for (const row of data.participations) {
    if (chapter !== undefined && row.chapter !== null && row.chapter > chapter) continue;
    const set = byEvent.get(row.eventId) ?? new Set<string>();
    set.add(row.entityId);
    byEvent.set(row.eventId, set);
  }
  const counts = new Map<string, number>();
  for (const members of byEvent.values()) {
    const list = [...members].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = pairKey(list[i]!, list[j]!);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return (a, b) => counts.get(pairKey(a, b)) ?? 0;
}

// ─── 关系倾向（规则确定、可解释） ─────────────────────────────────────────

export type RelationPolarityLabel = "紧密" | "友好" | "中性" | "紧张" | "敌对";

export interface RelationPolarity {
  /** -2 敌对 · -1 紧张 · 0 中性 · 1 友好 · 2 紧密；null 表示看不出倾向。 */
  readonly score: -2 | -1 | 0 | 1 | 2 | null;
  readonly label: RelationPolarityLabel;
  /** 命中的关键词；看不出倾向时为空。 */
  readonly keyword: string | null;
}

/** 关键词按强度分档；同一谓词先查负向（「背叛盟友」是敌对，不是紧密）。 */
const POLARITY_RULES: readonly { readonly score: -2 | -1 | 1 | 2; readonly words: readonly string[] }[] = [
  { score: -2, words: ["敌对", "死敌", "宿敌", "仇敌", "仇恨", "结仇", "背叛", "出卖", "决裂", "反目", "追杀", "陷害", "憎恨", "厌恶", "敌意", "对立"] },
  { score: 2, words: ["同盟", "结盟", "盟友", "挚友", "至交", "信任", "托付", "生死之交", "恋人", "相爱", "爱慕", "结拜", "拜师", "师徒", "效忠", "作保", "担保", "背书", "亲密"] },
  { score: -1, words: ["质疑", "怀疑", "猜忌", "警告", "提防", "戒备", "疏远", "冷淡", "不满", "争执", "争吵", "摩擦", "矛盾", "嫌隙", "施压", "威胁", "要挟", "监视", "隐瞒", "欺骗", "利用", "冲突", "竞争"] },
  { score: 1, words: ["协作", "合作", "共识", "认可", "赏识", "欣赏", "帮助", "相助", "援手", "救下", "救助", "感激", "和解", "和好", "录用", "招揽", "支持", "保护", "照顾", "结识", "好感", "友好", "朋友", "联手", "同行", "见证", "披露"] },
];
/** 否定 / 终止词：与正向词同时出现时视为关系转冷（-1）。 */
const NEGATORS = ["不再", "失去", "破裂", "终止", "解除", "撕毁", "中断", "动摇", "拒绝"];

const LABEL_BY_SCORE: Record<string, RelationPolarityLabel> = { "-2": "敌对", "-1": "紧张", "0": "中性", "1": "友好", "2": "紧密" };
const SENTIMENT_SCORE: Record<string, -2 | -1 | 0 | 1 | 2> = {
  hostile: -2, negative: -1, tense: -1, neutral: 0, positive: 1, friendly: 1, close: 2,
};

export function scoreRelationPolarity(predicate: string, sentiment?: string | null): RelationPolarity {
  const preset = sentiment ? SENTIMENT_SCORE[sentiment.trim().toLowerCase()] : undefined;
  if (preset !== undefined) return { score: preset, label: LABEL_BY_SCORE[String(preset)]!, keyword: sentiment!.trim() };
  const text = predicate.replace(/\s+/gu, "");
  for (const rule of POLARITY_RULES) {
    const keyword = rule.words.find((word) => text.includes(word));
    if (!keyword) continue;
    if (rule.score > 0) {
      const negator = NEGATORS.find((word) => text.includes(word));
      if (negator) return { score: -1, label: "紧张", keyword: `${negator}…${keyword}` };
    }
    return { score: rule.score, label: LABEL_BY_SCORE[String(rule.score)]!, keyword };
  }
  return { score: null, label: "中性", keyword: null };
}

// ─── 关系史与趋势 ─────────────────────────────────────────────────────────

export interface RelationHistoryItem {
  readonly relationId: string;
  readonly subjectId: string;
  readonly objectId: string;
  readonly predicate: string;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  /** 在所问的章（或至今）是否仍成立。 */
  readonly active: boolean;
  readonly evidence: string | null;
  readonly confidence: number;
  readonly polarity: RelationPolarity;
}

/** 某对实体的关系史：两个方向都算，按起始章、id 排序；给了章号就只列截至该章已发生的。 */
export function relationHistory(data: RelationGraphData, a: string, b: string, chapter?: number): RelationHistoryItem[] {
  return data.relations
    .filter((relation) => ((relation.subjectId === a && relation.objectId === b) || (relation.subjectId === b && relation.objectId === a))
      && isRelationKnownBy(relation, chapter))
    .sort((left, right) => (left.validFrom ?? 0) - (right.validFrom ?? 0) || left.id.localeCompare(right.id))
    .map((relation) => ({
      relationId: relation.id,
      subjectId: relation.subjectId,
      objectId: relation.objectId,
      predicate: relation.predicate,
      validFrom: relation.validFrom,
      validTo: relation.validTo,
      active: isRelationActiveAt(relation, chapter),
      evidence: relation.evidence,
      confidence: relation.confidence,
      polarity: scoreRelationPolarity(relation.predicate, relation.sentiment),
    }));
}

export type RelationTrendKind = "warming" | "worsening" | "fluctuating" | "stable" | "insufficient";

export const RELATION_TREND_LABEL: Record<RelationTrendKind, string> = {
  warming: "升温",
  worsening: "恶化",
  fluctuating: "起伏",
  stable: "平稳",
  insufficient: "数据不足",
};

export interface RelationTrend {
  readonly kind: RelationTrendKind;
  readonly label: string;
  /** 为什么这样判断：用了哪几条、分值怎么变的。 */
  readonly explanation: string;
  /** 参与判断的有倾向记录（按章）。 */
  readonly points: readonly { readonly chapter: number | null; readonly predicate: string; readonly score: number; readonly label: RelationPolarityLabel }[];
}

function describePoint(point: RelationTrend["points"][number]): string {
  return `${point.chapter === null ? "开篇" : `第 ${point.chapter} 章`}「${point.predicate}」(${point.label})`;
}

/**
 * 关系趋势：只看能判断出倾向的记录（中性、看不出倾向的不参与）。
 *   少于 2 条 → 数据不足；
 *   分值始终不变 → 平稳；
 *   只朝一个方向变 → 升温 / 恶化；
 *   先升后降或先降后升 → 起伏。
 */
export function relationTrend(history: readonly RelationHistoryItem[]): RelationTrend {
  const points = history
    .filter((item) => item.polarity.score !== null && item.polarity.score !== 0)
    .map((item) => ({ chapter: item.validFrom, predicate: item.predicate, score: item.polarity.score!, label: item.polarity.label }));
  if (points.length < 2) {
    const neutral = history.length - points.length;
    return {
      kind: "insufficient",
      label: RELATION_TREND_LABEL.insufficient,
      explanation: history.length === 0
        ? "两人之间还没有关系记录，判断不了走向。"
        : `共 ${history.length} 条关系记录，其中能看出亲疏倾向的只有 ${points.length} 条${neutral > 0 ? `（${neutral} 条是中性或看不出倾向的描述）` : ""}，至少要两条才能判断走向。`,
      points,
    };
  }
  const directions: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const diff = points[i]!.score - points[i - 1]!.score;
    if (diff !== 0) directions.push(Math.sign(diff));
  }
  const chain = points.map(describePoint).join(" → ");
  if (directions.length === 0) {
    return { kind: "stable", label: RELATION_TREND_LABEL.stable, explanation: `${points.length} 条有倾向的记录都是「${points[0]!.label}」：${chain}。`, points };
  }
  let turns = 0;
  for (let i = 1; i < directions.length; i += 1) if (directions[i] !== directions[i - 1]) turns += 1;
  if (turns === 0) {
    const kind: RelationTrendKind = directions[0]! > 0 ? "warming" : "worsening";
    return { kind, label: RELATION_TREND_LABEL[kind], explanation: `亲疏一路${kind === "warming" ? "走近" : "走远"}：${chain}。`, points };
  }
  const net = points[points.length - 1]!.score - points[0]!.score;
  const netText = net > 0 ? "整体比开始时更近" : net < 0 ? "整体比开始时更远" : "最后回到起点的亲疏";
  return { kind: "fluctuating", label: RELATION_TREND_LABEL.fluctuating, explanation: `亲疏有升有降（转折 ${turns} 次），${netText}：${chain}。`, points };
}

// ─── 实体的关系汇总（实体抽屉） ─────────────────────────────────────────

export interface CounterpartRelations {
  readonly entity: GraphEntity;
  /** 所问章（或至今）仍成立的关系。 */
  readonly current: readonly RelationHistoryItem[];
  readonly history: readonly RelationHistoryItem[];
  readonly trend: RelationTrend;
  readonly sharedEvents: number;
}

export interface EntityRelationSummary {
  readonly entity: GraphEntity;
  readonly chapter: number | null;
  readonly counterparts: readonly CounterpartRelations[];
}

export function entityRelationSummary(data: RelationGraphData, entityId: string, chapter?: number): EntityRelationSummary | null {
  const entities = entityIndex(data);
  const entity = entities.get(entityId);
  if (!entity) return null;
  const others = new Set<string>();
  for (const relation of data.relations) {
    if ((relation.subjectId === entityId || relation.objectId === entityId) && isRelationKnownBy(relation, chapter)) {
      others.add(counterpartOf(relation, entityId));
    }
  }
  const shared = sharedEventCounter(data, chapter);
  const counterparts = [...others]
    .flatMap((otherId) => {
      const other = entities.get(otherId);
      if (!other) return [];
      const history = relationHistory(data, entityId, otherId, chapter);
      return [{
        entity: other,
        current: history.filter((item) => item.active),
        history,
        trend: relationTrend(history),
        sharedEvents: shared(entityId, otherId),
      }];
    })
    .sort((left, right) => right.current.length - left.current.length
      || right.history.length - left.history.length
      || right.sharedEvents - left.sharedEvents
      || left.entity.name.localeCompare(right.entity.name, "zh"));
  return { entity, chapter: chapter ?? null, counterparts };
}

// ─── 焦点人物网络 ─────────────────────────────────────────────────────────

export interface NetworkNode {
  readonly id: string;
  readonly entryId: string | null;
  readonly name: string;
  readonly type: string;
  /** 离焦点几跳：0 = 焦点。 */
  readonly hop: 0 | 1 | 2;
  /** 二跳节点经由哪个一跳节点连进来（排序靠前的那个），供布局就近摆放。 */
  readonly via: string | null;
  /** 在所问章全书范围内的有效关系度数。 */
  readonly degree: number;
}

export interface NetworkEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** 当前仍成立的关系谓词（按起始章从早到晚，去重）。 */
  readonly predicates: readonly string[];
  readonly relationCount: number;
  readonly latestPredicate: string;
  /** 最近一条看得出亲疏的关系的倾向（都看不出时为中性）；「人情债」这类中性描述不会盖掉之前的「同盟」。 */
  readonly latestPolarity: RelationPolarity;
  /** 截至所问章共同参与的事件数，作为边权重。 */
  readonly sharedEvents: number;
  readonly trend: RelationTrendKind;
}

export interface EgoNetwork {
  readonly focusId: string;
  readonly hops: 1 | 2;
  readonly chapter: number | null;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  /** 超过上限被省略的节点数。 */
  readonly omitted: number;
}

export interface EgoNetworkOptions {
  readonly hops?: 1 | 2;
  readonly chapter?: number;
  readonly maxFirstHop?: number;
  readonly maxSecondHop?: number;
}

function activeAdjacency(data: RelationGraphData, chapter?: number): Map<string, Map<string, GraphRelation[]>> {
  const adjacency = new Map<string, Map<string, GraphRelation[]>>();
  const add = (from: string, to: string, relation: GraphRelation) => {
    const row = adjacency.get(from) ?? new Map<string, GraphRelation[]>();
    row.set(to, [...(row.get(to) ?? []), relation]);
    adjacency.set(from, row);
  };
  for (const relation of relationsAtChapter(data, chapter)) {
    if (relation.subjectId === relation.objectId) continue;
    add(relation.subjectId, relation.objectId, relation);
    add(relation.objectId, relation.subjectId, relation);
  }
  return adjacency;
}

/** 按有效关系度数挑默认焦点：度数高者优先，其次参与事件多，最后按名字。没有任何关系时为 null。 */
export function defaultFocusEntity(data: RelationGraphData, chapter?: number): string | null {
  const adjacency = activeAdjacency(data, chapter);
  const entities = entityIndex(data);
  const participation = new Map<string, number>();
  for (const row of data.participations) participation.set(row.entityId, (participation.get(row.entityId) ?? 0) + 1);
  const ranked = [...adjacency.entries()]
    .filter(([id]) => entities.has(id))
    .sort((left, right) => right[1].size - left[1].size
      || (participation.get(right[0]) ?? 0) - (participation.get(left[0]) ?? 0)
      || entities.get(left[0])!.name.localeCompare(entities.get(right[0])!.name, "zh"));
  return ranked[0]?.[0] ?? null;
}

export function egoNetwork(data: RelationGraphData, focusId: string, options: EgoNetworkOptions = {}): EgoNetwork | null {
  const entities = entityIndex(data);
  const focus = entities.get(focusId);
  if (!focus) return null;
  const hops = options.hops ?? 1;
  const chapter = options.chapter;
  const maxFirst = options.maxFirstHop ?? 24;
  const maxSecond = options.maxSecondHop ?? 36;
  const adjacency = activeAdjacency(data, chapter);
  const shared = sharedEventCounter(data, chapter);

  const rank = (from: string) => (left: string, right: string) => shared(from, right) - shared(from, left)
    || (adjacency.get(from)?.get(right)?.length ?? 0) - (adjacency.get(from)?.get(left)?.length ?? 0)
    || (entities.get(left)?.name ?? left).localeCompare(entities.get(right)?.name ?? right, "zh");

  const firstAll = [...(adjacency.get(focusId)?.keys() ?? [])].filter((id) => entities.has(id)).sort(rank(focusId));
  const first = firstAll.slice(0, maxFirst);
  let omitted = firstAll.length - first.length;

  const via = new Map<string, string>();
  if (hops === 2) {
    const firstSet = new Set(first);
    const candidates: string[] = [];
    for (const hub of first) {
      for (const next of [...(adjacency.get(hub)?.keys() ?? [])].sort(rank(hub))) {
        if (next === focusId || firstSet.has(next) || via.has(next) || !entities.has(next)) continue;
        via.set(next, hub);
        candidates.push(next);
      }
    }
    // 二跳按「经由的一跳在前、同一枢纽内按权重」的顺序截断，保证结果稳定。
    const kept = candidates.slice(0, maxSecond);
    omitted += candidates.length - kept.length;
    for (const dropped of candidates.slice(maxSecond)) via.delete(dropped);
  }

  const nodes: NetworkNode[] = [
    { id: focus.id, entryId: focus.entryId, name: focus.name, type: focus.type, hop: 0, via: null, degree: adjacency.get(focus.id)?.size ?? 0 },
    ...first.map((id): NetworkNode => {
      const entity = entities.get(id)!;
      return { id, entryId: entity.entryId, name: entity.name, type: entity.type, hop: 1, via: null, degree: adjacency.get(id)?.size ?? 0 };
    }),
    ...[...via.entries()].map(([id, hub]): NetworkNode => {
      const entity = entities.get(id)!;
      return { id, entryId: entity.entryId, name: entity.name, type: entity.type, hop: 2, via: hub, degree: adjacency.get(id)?.size ?? 0 };
    }),
  ];

  const included = new Set(nodes.map((node) => node.id));
  const hopOf = new Map(nodes.map((node) => [node.id, node.hop]));
  const edges: NetworkEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const [otherId, relations] of adjacency.get(node.id) ?? []) {
      if (!included.has(otherId)) continue;
      const key = pairKey(node.id, otherId);
      if (seen.has(key)) continue;
      seen.add(key);
      // 靠近焦点的一侧作起点；同层按 id 排，方向稳定。
      const [source, target] = (hopOf.get(node.id)! < hopOf.get(otherId)! || (hopOf.get(node.id) === hopOf.get(otherId) && node.id < otherId))
        ? [node.id, otherId]
        : [otherId, node.id];
      const ordered = [...relations].sort((left, right) => (left.validFrom ?? 0) - (right.validFrom ?? 0) || left.id.localeCompare(right.id));
      const latest = ordered[ordered.length - 1]!;
      const polarities = ordered.map((relation) => scoreRelationPolarity(relation.predicate, relation.sentiment));
      const latestPolar = [...polarities].reverse().find((polarity) => polarity.score !== null && polarity.score !== 0)
        ?? { score: null, label: "中性" as const, keyword: null };
      edges.push({
        id: `edge:${source}->${target}`,
        source,
        target,
        predicates: [...new Set(ordered.map((relation) => relation.predicate))],
        relationCount: ordered.length,
        latestPredicate: latest.predicate,
        latestPolarity: latestPolar,
        sharedEvents: shared(source, target),
        trend: relationTrend(relationHistory(data, source, target, chapter)).kind,
      });
    }
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));
  return { focusId, hops, chapter: chapter ?? null, nodes, edges, omitted };
}

// ─── 共同关系人与路径 ─────────────────────────────────────────────────────

export interface CommonRelation {
  readonly entity: GraphEntity;
  readonly withA: readonly string[];
  readonly withB: readonly string[];
}

/** 第 N 章时同时与 a、b 有有效关系的实体。 */
export function commonRelations(data: RelationGraphData, a: string, b: string, chapter?: number): CommonRelation[] {
  const adjacency = activeAdjacency(data, chapter);
  const entities = entityIndex(data);
  const left = adjacency.get(a) ?? new Map<string, GraphRelation[]>();
  const right = adjacency.get(b) ?? new Map<string, GraphRelation[]>();
  return [...left.keys()]
    .filter((id) => id !== a && id !== b && right.has(id) && entities.has(id))
    .map((id) => ({
      entity: entities.get(id)!,
      withA: [...new Set(left.get(id)!.map((relation) => relation.predicate))],
      withB: [...new Set(right.get(id)!.map((relation) => relation.predicate))],
    }))
    .sort((x, y) => x.entity.name.localeCompare(y.entity.name, "zh"));
}

export interface RelationPathStep {
  readonly from: string;
  readonly to: string;
  readonly predicates: readonly string[];
}

/** 第 N 章时 a 到 b 的最短关系路径（广度优先，邻居按名字排，结果稳定）；超过 maxDepth 跳或不连通返回 null。 */
export function relationPath(data: RelationGraphData, from: string, to: string, options: { chapter?: number; maxDepth?: number } = {}): RelationPathStep[] | null {
  if (from === to) return [];
  const adjacency = activeAdjacency(data, options.chapter);
  const entities = entityIndex(data);
  const maxDepth = options.maxDepth ?? 4;
  const parent = new Map<string, string>([[from, from]]);
  let frontier = [from];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      const neighbors = [...(adjacency.get(current)?.keys() ?? [])]
        .sort((x, y) => (entities.get(x)?.name ?? x).localeCompare(entities.get(y)?.name ?? y, "zh") || x.localeCompare(y));
      for (const neighbor of neighbors) {
        if (parent.has(neighbor)) continue;
        parent.set(neighbor, current);
        if (neighbor === to) {
          const steps: RelationPathStep[] = [];
          let cursor = to;
          while (cursor !== from) {
            const previous = parent.get(cursor)!;
            steps.unshift({
              from: previous,
              to: cursor,
              predicates: [...new Set((adjacency.get(previous)?.get(cursor) ?? []).map((relation) => relation.predicate))],
            });
            cursor = previous;
          }
          return steps;
        }
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
}

// ─── 空状态说明 ───────────────────────────────────────────────────────────

export type GraphEmptyReason = "schema-missing" | "index-empty" | "no-relations" | "no-relations-at-chapter" | "entity-not-found" | "focus-isolated";

export function explainGraphEmpty(reason: GraphEmptyReason, context: { entityCount?: number; chapter?: number; name?: string } = {}): GraphExplanation {
  switch (reason) {
    case "schema-missing":
      return {
        whatHappened: "这个数据库还没有实体索引相关的表（迁移 0032 未执行）。",
        whyItMatters: "关系图只按实体 ID 连边，没有索引表就画不出来；正文、事实与事件不受影响。",
        suggestedAction: "重启 NovelFork 让数据库迁移执行完成后再打开。",
      };
    case "index-empty":
      return {
        whatHappened: "这本书的实体索引还是空的。",
        whyItMatters: "关系图只认经纬里的角色 / 地点 / 势力 / 道具条目；没有索引，就无法确认「薛小爷」和「薛行之」是同一个人，也就连不出关系。",
        suggestedAction: "先在经纬里建立角色条目，再结算章节（结算后会自动重建索引）；已有条目和结算记录的话，点「重建索引」立即重建。",
      };
    case "no-relations":
      return {
        whatHappened: `已索引 ${context.entityCount ?? 0} 个实体，但还没有一条关系边。`,
        whyItMatters: "关系边来自章后结算里的关系类事实，而且关系双方都要能归到经纬条目；只写进描述里的人名不会连边。",
        suggestedAction: "结算写到人物关系变化的章节；结算里出现的人物还没有经纬条目时，先建条目再点「重建索引」。",
      };
    case "no-relations-at-chapter":
      return {
        whatHappened: `截至第 ${context.chapter ?? "?"} 章还没有成立的关系。`,
        whyItMatters: "关系按故事内有效期切片：第一次出现关系的章节之前，图上自然是空的。",
        suggestedAction: "把「截至第 N 章」往后调，或选「至今」。",
      };
    case "entity-not-found":
      return {
        whatHappened: `实体索引里找不到${context.name ? `「${context.name}」` : "这个实体"}。`,
        whyItMatters: "只有经纬里的角色 / 地点 / 势力 / 道具条目会进入实体索引；条目刚建立或刚改名时，要重建后才有身份。",
        suggestedAction: "确认它在经纬里是角色 / 地点 / 势力 / 道具条目，且没有与另一条目同名，然后点「重建索引」。",
      };
    case "focus-isolated":
      return {
        whatHappened: `${context.name ? `「${context.name}」` : "这个实体"}${context.chapter ? `截至第 ${context.chapter} 章` : "目前"}没有成立的关系。`,
        whyItMatters: "关系边来自结算出的关系类事实；只是同场出现不算关系。",
        suggestedAction: "换一个焦点人物，或把「截至第 N 章」往后调；写到这个人物的关系变化后再结算一次。",
      };
  }
}
