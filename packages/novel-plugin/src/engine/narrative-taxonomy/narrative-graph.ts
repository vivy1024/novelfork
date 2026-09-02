/**
 * 统一叙事图查询层（纯函数）。
 *
 * 一份数据两个出口：
 *   · UI  → 四张图（关系树 / 世界观层级 / 因果链 / 双轴时间线 / 伏笔网络）
 *   · 工具 → 结构化子图 JSON，让 LLM **读结论而不是自己推断关系**
 *
 * 为什么工具也要吃图（减少幻觉）：
 *   现在 `memory.graph` 返回 340 条散事实，AI 得自己拼「谁跟谁什么关系」，
 *   还要靠字符串判断「薛行之与方工」是一个实体还是两个 —— 这是幻觉的来源。
 *   GraphRAG (2404.16130) / HippoRAG 2 (2502.14802) / Zep (2501.13956) 三篇
 *   都测出：返回结构化子图 > 返回摘要 > 返回原文块，多跳推理差距最明显。
 *
 * 实体归并策略（关键）：
 *   库里 89% 的 fact/event 没有 entry_id，只能按名字匹配。复合主体
 *   「薛行之与方工」实测占 24/326，必须拆成两个实体 + 一条边，
 *   否则会凭空造出一个不存在的角色。见 splitCompositeName。
 */

import { inferHookCausalLinks, parseCausedBy } from "../narrative-memory/causal-resolve.js";
import { resolveEntity, stripParentheticalSuffix, type EntityDictionary } from "../narrative-memory/entity-dictionary.js";
import { looksLikeEntity, looksLikeEventPhrase, splitCompositeName } from "./entity-name-heuristics.js";

export { looksLikeEntity, looksLikeEventPhrase, splitCompositeName } from "./entity-name-heuristics.js";

// ─── 输入（对齐现有表结构，不要求先完成 migration 0032 回填） ──────────────

export interface GraphFactInput {
  readonly id?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly category?: string;
  readonly sourceChapter?: number;
  readonly validFromChapter?: number;
  readonly validUntilChapter?: number;
  readonly evidenceText?: string;
  readonly confidence?: number;
  readonly subjectEntryId?: string;
  readonly objectEntryId?: string;
}

export interface GraphEventInput {
  readonly id?: string;
  readonly chapterNumber?: number;
  readonly eventType?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly evidenceText?: string;
  readonly riskLevel?: string;
  readonly status?: string;
  readonly subjectEntryId?: string;
  /** 显式前驱事件 id；有值时因果链优先用它，不再靠同参与者启发式。 */
  readonly causedBy?: readonly string[];
}

export interface GraphEntryInput {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly summaryMd?: string | null;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
  readonly lifecycle?: string;
  readonly status?: string;
}

export interface GraphForeshadowRecord {
  readonly id?: string;
  readonly entryId?: string;
  readonly label?: string;
  readonly status?: string;
  readonly setupChapter?: number;
  readonly triggerChapter?: number;
  readonly triggerCondition?: string;
  readonly payoffChapter?: number;
}

export interface BuildNarrativeGraphInput {
  readonly entries?: readonly GraphEntryInput[];
  readonly facts?: readonly GraphFactInput[];
  readonly events?: readonly GraphEventInput[];
  readonly foreshadowRecords?: readonly GraphForeshadowRecord[];
  readonly currentChapter?: number;
  /**
   * 实体字典。命中时用 canonical 名合并「薛行之（主角·权威版）」与「薛行之」。
   * 伏笔类目不进实体表（有自己的伏笔网络）。
   */
  readonly dictionary?: EntityDictionary;
}

// ─── 输出 ─────────────────────────────────────────────────────────────────

export type GraphEntityKind =
  | "character" | "location" | "faction" | "item" | "power" | "concept" | "unknown";

export interface GraphEntity {
  readonly id: string;
  readonly name: string;
  readonly kind: GraphEntityKind;
  readonly entryId?: string;
  readonly aliases: readonly string[];
  readonly firstChapter?: number;
  readonly lastChapter?: number;
  /** 当前状态（取 <= currentChapter 的最后一次变更）。 */
  readonly currentState?: string;
  readonly degree: number;
  /** 名字来自复合主体拆分（可靠性较低，UI 上应标注）。 */
  readonly derivedFromComposite?: boolean;
}

export interface GraphRelation {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly label: string;
  readonly kind: "relationship" | "cooccurrence" | "membership";
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly evidenceText?: string;
  readonly confidence: number;
}

/** 因果链节点：事件 + 它的因果前驱。 */
export interface CausalNode {
  readonly id: string;
  readonly chapterNumber: number;
  readonly summary: string;
  readonly eventType: string;
  readonly participants: readonly string[];
  readonly riskLevel?: string;
  /** 上游事件 id。explicit 来自 causedBy / 伏笔三态；heuristic 仅作回落。 */
  readonly causes: readonly string[];
  readonly causeSource: "explicit" | "heuristic" | "none";
}

export type ForeshadowPhase = "planted" | "reinforced" | "triggered" | "paid_off" | "abandoned" | "unknown";

export interface ForeshadowNode {
  readonly id: string;
  readonly entryId?: string;
  readonly label: string;
  readonly phase: ForeshadowPhase;
  readonly setupChapter?: number;
  readonly triggerChapter?: number;
  readonly triggerCondition?: string;
  readonly payoffChapter?: number;
  readonly chaptersPending?: number;
  /** 断头债：埋了很久、没触发也没回收。 */
  readonly dangling: boolean;
}

export interface KnowledgeEdge {
  readonly knowerId: string;
  readonly knowerName: string;
  readonly factRef: string;
  readonly summary: string;
  readonly knowsFrom: number;
  readonly certainty: "knows" | "suspects";
}

export interface TimelineEntry {
  /** 叙述顺序：第几章讲的。 */
  readonly narrativeChapter: number;
  /** 故事时间标记（若能解析出来）；缺失表示与叙述同序。 */
  readonly storyTime?: string;
  readonly summary: string;
  /** 与叙述顺序不一致 = 倒叙/闪回/预叙。 */
  readonly anachronic: boolean;
}

export interface NarrativeGraph {
  readonly entities: readonly GraphEntity[];
  readonly relations: readonly GraphRelation[];
  readonly causal: readonly CausalNode[];
  readonly foreshadows: readonly ForeshadowNode[];
  readonly knowledge: readonly KnowledgeEdge[];
  readonly timeline: readonly TimelineEntry[];
  readonly currentChapter: number;
  /** 数据质量：让 UI 和工具都能诚实说明可靠性。 */
  readonly quality: GraphQuality;
}

export interface GraphQuality {
  readonly totalFacts: number;
  readonly totalEvents: number;
  /** 有 entry_id 的比例（0-1）。低意味着关系靠名字匹配，可靠性有限。 */
  readonly entityLinkRate: number;
  readonly compositeSubjects: number;
  /** 没有任何显式因果边时为 true —— 启发式不算接通。 */
  readonly missingCausality: boolean;
  readonly explicitCausalEdges: number;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function entityId(name: string): string {
  return `entity:${encodeURIComponent(name)}`;
}

const CATEGORY_KIND: Record<string, GraphEntityKind> = {
  characters: "character",
  people: "character",
  locations: "location",
  factions: "faction",
  props: "item",
  "power-system": "power",
  "world-model": "concept",
  rules: "concept",
};

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// ─── 主装配 ───────────────────────────────────────────────────────────────

export function buildNarrativeGraph(input: BuildNarrativeGraphInput): NarrativeGraph {
  const entries = input.entries ?? [];
  const facts = input.facts ?? [];
  const events = input.events ?? [];

  const entityByName = new Map<string, {
    name: string;
    kind: GraphEntityKind;
    entryId?: string;
    aliases: Set<string>;
    firstChapter?: number;
    lastChapter?: number;
    currentState?: string;
    stateChapter?: number;
    degree: number;
    composite: boolean;
  }>();

  const touchEntity = (
    rawName: string,
    options: { kind?: GraphEntityKind; entryId?: string; chapter?: number; composite?: boolean } = {},
  ): string | null => {
    const cleaned = clean(rawName);
    if (!cleaned) return null;
    const hit = resolveEntity(input.dictionary, cleaned);
    if (hit?.entry.category === "foreshadowing") return null;
    const name = hit?.entry.canonicalName ?? cleaned;
    // 字典命中的权威名跳过启发式（长标题/功法名仍是实体）；未命中才过滤事件短语
    if (!hit && (!looksLikeEntity(name) || looksLikeEventPhrase(name))) return null;
    const existing = entityByName.get(name);
    if (!existing) {
      const entryId = options.entryId ?? hit?.entry.entryId;
      const kindFromDict = hit ? CATEGORY_KIND[hit.entry.category] : undefined;
      entityByName.set(name, {
        name,
        kind: options.kind ?? kindFromDict ?? "unknown",
        ...(entryId ? { entryId } : {}),
        aliases: new Set(),
        ...(options.chapter !== undefined ? { firstChapter: options.chapter, lastChapter: options.chapter } : {}),
        degree: 0,
        composite: options.composite ?? false,
      });
      return entityId(name);
    }
    if (options.kind && existing.kind === "unknown") existing.kind = options.kind;
    const resolvedEntryId = options.entryId ?? hit?.entry.entryId;
    if (resolvedEntryId && !existing.entryId) existing.entryId = resolvedEntryId;
    const kindFromHit = hit ? CATEGORY_KIND[hit.entry.category] : undefined;
    if (kindFromHit && existing.kind === "unknown") existing.kind = kindFromHit;
    if (options.chapter !== undefined) {
      existing.firstChapter = existing.firstChapter === undefined
        ? options.chapter
        : Math.min(existing.firstChapter, options.chapter);
      existing.lastChapter = existing.lastChapter === undefined
        ? options.chapter
        : Math.max(existing.lastChapter, options.chapter);
    }
    // 经纬条目确认过的实体不再标记为「拆分推导」
    if (options.composite === false) existing.composite = false;
    return entityId(name);
  };

  // ① 经纬条目 → 权威实体（有 entry_id，可靠）
  for (const entry of entries) {
    const kind = CATEGORY_KIND[entry.category ?? ""];
    if (!kind) continue;
    const name = stripParentheticalSuffix(clean(entry.fields?.name) || clean(entry.title));
    const id = touchEntity(name, { kind, entryId: entry.id, composite: false });
    if (!id) continue;
    const storedName = decodeURIComponent(id.replace(/^entity:/u, ""));
    const record = entityByName.get(storedName)!;
    for (const alias of Array.isArray(entry.fields?.aliases) ? entry.fields.aliases : []) {
      const aliasName = clean(alias);
      if (aliasName && aliasName !== name) record.aliases.add(aliasName);
    }
    const state = clean(entry.fields?.currentState);
    if (state) record.currentState = state;
  }

  const currentChapter = toChapter(input.currentChapter)
    ?? Math.max(0, ...events.map((event) => toChapter(event.chapterNumber) ?? 0));

  // ② 事实 → 关系边 + 状态
  const relations: GraphRelation[] = [];
  let compositeCount = 0;
  let linkedCount = 0;

  for (const [index, fact] of facts.entries()) {
    if (fact.subjectEntryId) linkedCount += 1;
    const chapter = toChapter(fact.sourceChapter) ?? toChapter(fact.validFromChapter);
    const subjectSplit = splitCompositeName(fact.subject ?? "");
    if (subjectSplit.composite) compositeCount += 1;

    const subjectIds = subjectSplit.names
      .map((name) => touchEntity(name, {
        chapter,
        ...(fact.subjectEntryId ? { entryId: fact.subjectEntryId } : {}),
        composite: subjectSplit.composite,
      }))
      .filter((id): id is string => id !== null);

    // 复合主体内部互连：「薛行之与方工」本身就说明这两人有关系
    if (subjectSplit.composite && subjectIds.length > 1) {
      for (let left = 0; left < subjectIds.length; left += 1) {
        for (let right = left + 1; right < subjectIds.length; right += 1) {
          relations.push({
            id: `rel:composite:${index}:${left}:${right}`,
            sourceId: subjectIds[left]!,
            targetId: subjectIds[right]!,
            label: clean(fact.predicate) || "共同出现",
            kind: "cooccurrence",
            ...(chapter !== undefined ? { validFrom: chapter } : {}),
            confidence: 0.5,
          });
        }
      }
    }

    if (fact.category === "relationship") {
      const objectSplit = splitCompositeName(fact.object ?? "");
      const objectIds = objectSplit.names
        .map((name) => touchEntity(name, { chapter, composite: objectSplit.composite }))
        .filter((id): id is string => id !== null);
      for (const sourceId of subjectIds) {
        for (const targetId of objectIds) {
          if (sourceId === targetId) continue;
          relations.push({
            id: `rel:fact:${fact.id ?? index}:${sourceId}:${targetId}`,
            sourceId,
            targetId,
            label: clean(fact.predicate) || "关联",
            kind: "relationship",
            ...(toChapter(fact.validFromChapter) !== undefined ? { validFrom: toChapter(fact.validFromChapter)! } : chapter !== undefined ? { validFrom: chapter } : {}),
            ...(toChapter(fact.validUntilChapter) !== undefined ? { validTo: toChapter(fact.validUntilChapter)! } : {}),
            ...(fact.evidenceText ? { evidenceText: clean(fact.evidenceText).slice(0, 200) } : {}),
            confidence: typeof fact.confidence === "number" ? fact.confidence : 1,
          });
        }
      }
      continue;
    }

    // 状态类事实 → 当前状态（Event Calculus 回放：取 <= currentChapter 的最后一次）
    if (fact.category === "character_state" || fact.category === "location") {
      for (const name of subjectSplit.names) {
        const record = entityByName.get(clean(name));
        if (!record) continue;
        if (chapter !== undefined && chapter > currentChapter) continue;
        if (record.stateChapter !== undefined && chapter !== undefined && chapter < record.stateChapter) continue;
        const description = [clean(fact.predicate), clean(fact.object)].filter(Boolean).join("：");
        if (!description) continue;
        record.currentState = description.slice(0, 120);
        if (chapter !== undefined) record.stateChapter = chapter;
      }
    }
  }

  for (const event of events) {
    if (event.subjectEntryId) linkedCount += 1;
  }

  // ③ 因果链：显式 causedBy / 伏笔三态优先，同参与者最近事件只作回落
  const causal = buildCausalChain(events, touchEntity);

  // ④ 伏笔网络：经纬条目 ∪ narrative_foreshadow 三态机
  const foreshadows = buildForeshadowNetwork(entries, currentChapter, input.foreshadowRecords ?? []);

  // ⑤ 知识边界：事件参与者从该事件起知道这件事
  const knowledge = buildKnowledgeEdges(events, entityByName);

  // ⑥ 双轴时间线
  const timeline = buildTimeline(entries, events);

  // 度数统计
  for (const relation of relations) {
    for (const id of [relation.sourceId, relation.targetId]) {
      const name = decodeURIComponent(id.replace(/^entity:/, ""));
      const record = entityByName.get(name);
      if (record) record.degree += 1;
    }
  }

  const entities: GraphEntity[] = [...entityByName.values()]
    .map((record) => ({
      id: entityId(record.name),
      name: record.name,
      kind: record.kind,
      ...(record.entryId ? { entryId: record.entryId } : {}),
      aliases: [...record.aliases],
      ...(record.firstChapter !== undefined ? { firstChapter: record.firstChapter } : {}),
      ...(record.lastChapter !== undefined ? { lastChapter: record.lastChapter } : {}),
      ...(record.currentState ? { currentState: record.currentState } : {}),
      degree: record.degree,
      ...(record.composite ? { derivedFromComposite: true } : {}),
    }))
    .sort((left, right) => right.degree - left.degree || left.name.localeCompare(right.name, "zh"));

  const totalMentions = facts.length + events.length;
  return {
    entities,
    relations,
    causal,
    foreshadows,
    knowledge,
    timeline,
    currentChapter,
    quality: {
      totalFacts: facts.length,
      totalEvents: events.length,
      entityLinkRate: totalMentions > 0 ? linkedCount / totalMentions : 0,
      compositeSubjects: compositeCount,
      missingCausality: causal.every((node) => node.causeSource !== "explicit"),
      explicitCausalEdges: causal.reduce((sum, node) => sum + (node.causeSource === "explicit" ? node.causes.length : 0), 0),
    },
  };
}

// ─── 因果链 ───────────────────────────────────────────────────────────────

function buildCausalChain(
  events: readonly GraphEventInput[],
  touchEntity: (name: string, options?: { chapter?: number }) => string | null,
): CausalNode[] {
  const nodes: CausalNode[] = [];
  const lastEventByParticipant = new Map<string, string>();
  const knownIds = new Set(events.map((event, index) => event.id ?? `event:${index}`));
  const hookLinks = inferHookCausalLinks(events.map((event, index) => ({
    id: event.id ?? `event:${index}`,
    chapterNumber: toChapter(event.chapterNumber) ?? 0,
    eventType: event.eventType ?? "event",
    subject: event.subject ?? "",
    predicate: event.predicate,
    object: event.object,
    evidenceText: event.evidenceText,
    causedBy: event.causedBy,
  })).filter((event) => event.chapterNumber > 0));

  const ordered = [...events]
    .filter((event) => toChapter(event.chapterNumber) !== undefined)
    .sort((left, right) => (toChapter(left.chapterNumber)! - toChapter(right.chapterNumber)!));

  for (const [index, event] of ordered.entries()) {
    const chapter = toChapter(event.chapterNumber)!;
    const id = event.id ?? `event:${index}`;
    const split = splitCompositeName(event.subject ?? "");
    const participants = split.names.filter((name) => looksLikeEntity(name));
    for (const name of participants) touchEntity(name, { chapter });

    const explicit = [...new Set([
      ...parseCausedBy(event.causedBy),
      ...(hookLinks.get(id) ?? []),
    ])].filter((causeId) => causeId !== id && knownIds.has(causeId));

    // 同参与者最近事件只作回落，不算接通显式因果。
    const heuristic = [...new Set(
      participants
        .map((name) => lastEventByParticipant.get(name))
        .filter((value): value is string => value !== undefined && value !== id),
    )];
    const causes = explicit.length > 0 ? explicit : heuristic;

    nodes.push({
      id,
      chapterNumber: chapter,
      summary: clean(event.evidenceText)
        || [clean(event.subject), clean(event.predicate), clean(event.object)].filter(Boolean).join(" · ")
        || "未描述事件",
      eventType: clean(event.eventType) || "event",
      participants,
      ...(event.riskLevel ? { riskLevel: clean(event.riskLevel) } : {}),
      causes,
      causeSource: explicit.length > 0 ? "explicit" : causes.length > 0 ? "heuristic" : "none",
    });

    for (const name of participants) lastEventByParticipant.set(name, id);
  }
  return nodes;
}

// ─── 伏笔网络 ─────────────────────────────────────────────────────────────

const DEBT_DANGLING_CHAPTERS = 12;

function resolvePhase(fields: Record<string, unknown>): ForeshadowPhase {
  const raw = clean(fields.status).toLowerCase();
  if (raw === "paid_off" || raw === "paid-off" || raw === "resolved") return "paid_off";
  if (raw === "triggered" || raw === "paying_off") return "triggered";
  if (raw === "reinforced" || raw === "progressing" || raw === "partial") return "reinforced";
  if (raw === "abandoned") return "abandoned";
  if (raw === "planted" || raw === "open" || raw === "pending") return "planted";
  // 脏值/缺失 → 用章号推断，推不出记 unknown（不猜）
  if (toChapter(fields.payoffChapter) !== undefined) return "paid_off";
  if (toChapter(fields.triggerChapter) !== undefined) return "triggered";
  if (toChapter(fields.plantedChapter) !== undefined) return "planted";
  return "unknown";
}

function mapRecordStatus(status: string | undefined): ForeshadowPhase {
  const raw = clean(status).toLowerCase();
  if (raw === "paid_off" || raw === "resolved") return "paid_off";
  if (raw === "triggered" || raw === "paying_off") return "triggered";
  if (raw === "reinforced" || raw === "progressing") return "reinforced";
  if (raw === "abandoned" || raw === "contradicted") return "abandoned";
  if (raw === "planted" || raw === "open") return "planted";
  return "unknown";
}

function buildForeshadowNetwork(
  entries: readonly GraphEntryInput[],
  currentChapter: number,
  records: readonly GraphForeshadowRecord[],
): ForeshadowNode[] {
  const nodes = new Map<string, ForeshadowNode>();
  const push = (node: ForeshadowNode) => {
    const key = node.entryId || node.label;
    const existing = nodes.get(key);
    if (!existing) {
      nodes.set(key, node);
      return;
    }
    const rank = (phase: ForeshadowPhase) => ({ paid_off: 5, triggered: 4, reinforced: 3, planted: 2, abandoned: 1, unknown: 0 })[phase] ?? 0;
    if (rank(node.phase) >= rank(existing.phase)) nodes.set(key, { ...existing, ...node, id: existing.id });
  };

  for (const entry of entries) {
    if (entry.category !== "foreshadowing") continue;
    if (entry.lifecycle === "archived" || entry.lifecycle === "retired") continue;
    const fields = entry.fields ?? {};
    const phase = resolvePhase(fields);
    const setupChapter = toChapter(fields.plantedChapter);
    const triggerChapter = toChapter(fields.triggerChapter);
    const triggerCondition = clean(fields.triggerCondition) || undefined;
    const payoffChapter = toChapter(fields.payoffChapter);
    const chaptersPending = phase !== "paid_off" && setupChapter !== undefined
      ? Math.max(0, currentChapter - setupChapter)
      : undefined;
    push({
      id: `foreshadow:${entry.id}`,
      entryId: entry.id,
      label: (clean(entry.title) || "未命名伏笔").slice(0, 40),
      phase,
      ...(setupChapter !== undefined ? { setupChapter } : {}),
      ...(triggerChapter !== undefined ? { triggerChapter } : {}),
      ...(triggerCondition ? { triggerCondition } : {}),
      ...(payoffChapter !== undefined ? { payoffChapter } : {}),
      ...(chaptersPending !== undefined ? { chaptersPending } : {}),
      dangling: phase !== "paid_off" && (chaptersPending ?? 0) >= DEBT_DANGLING_CHAPTERS,
    });
  }

  for (const record of records) {
    const phase = mapRecordStatus(record.status);
    const setupChapter = toChapter(record.setupChapter);
    const triggerChapter = toChapter(record.triggerChapter);
    const triggerCondition = clean(record.triggerCondition) || undefined;
    const payoffChapter = toChapter(record.payoffChapter);
    const chaptersPending = phase !== "paid_off" && setupChapter !== undefined
      ? Math.max(0, currentChapter - setupChapter)
      : undefined;
    push({
      id: record.id ? `foreshadow:${record.id}` : `foreshadow:${clean(record.label) || "unnamed"}`,
      ...(record.entryId ? { entryId: record.entryId } : {}),
      label: (clean(record.label) || "未命名伏笔").slice(0, 40),
      phase,
      ...(setupChapter !== undefined ? { setupChapter } : {}),
      ...(triggerChapter !== undefined ? { triggerChapter } : {}),
      ...(triggerCondition ? { triggerCondition } : {}),
      ...(payoffChapter !== undefined ? { payoffChapter } : {}),
      ...(chaptersPending !== undefined ? { chaptersPending } : {}),
      dangling: phase !== "paid_off" && (chaptersPending ?? 0) >= DEBT_DANGLING_CHAPTERS,
    });
  }

  return [...nodes.values()].sort((left, right) => (right.chaptersPending ?? -1) - (left.chaptersPending ?? -1));
}

// ─── 知识边界 ─────────────────────────────────────────────────────────────

function buildKnowledgeEdges(
  events: readonly GraphEventInput[],
  entityByName: ReadonlyMap<string, { name: string }>,
): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  for (const [index, event] of events.entries()) {
    const chapter = toChapter(event.chapterNumber);
    if (chapter === undefined) continue;
    const split = splitCompositeName(event.subject ?? "");
    for (const name of split.names) {
      if (!looksLikeEntity(name) || !entityByName.has(name)) continue;
      edges.push({
        knowerId: entityId(name),
        knowerName: name,
        factRef: event.id ?? `event:${index}`,
        summary: (clean(event.evidenceText) || clean(event.predicate) || "参与事件").slice(0, 120),
        knowsFrom: chapter,
        // 事件参与者直接知情；旁观/传闻需要显式标注，这里不猜
        certainty: "knows",
      });
    }
  }
  return edges;
}

// ─── 双轴时间线 ───────────────────────────────────────────────────────────

/** 从摘要文本里找故事时间标记（网文常见「两年前」「同一时间」这类相对表述）。 */
const STORY_TIME_HINTS = /(\d{4}年[\d一二三四五六七八九十]{0,3}月?|[两三四五六七八九十]?[年月日]前|同一时间|与此同时|多年后|次日|翌日)/u;

function buildTimeline(
  entries: readonly GraphEntryInput[],
  events: readonly GraphEventInput[],
): TimelineEntry[] {
  const byChapter = new Map<number, TimelineEntry>();
  for (const entry of entries) {
    if (entry.category !== "chapter-summaries") continue;
    const fields = entry.fields ?? {};
    const chapter = toChapter(fields.chapterNumber) ?? toChapter(fields.chapter_number);
    if (chapter === undefined) continue;
    const summary = clean(entry.summaryMd ?? "") || clean(entry.contentMd ?? "") || clean(entry.title);
    const hint = STORY_TIME_HINTS.exec(summary);
    const storyTime = clean(fields.storyTime) || (hint ? hint[1]! : "");
    byChapter.set(chapter, {
      narrativeChapter: chapter,
      ...(storyTime ? { storyTime } : {}),
      summary: summary.slice(0, 160),
      // 出现「…前」「多年后」这类标记即视为可能的时序错置，交由作者确认
      anachronic: Boolean(storyTime) && /前|后/u.test(storyTime),
    });
  }
  for (const event of events) {
    const chapter = toChapter(event.chapterNumber);
    if (chapter === undefined || byChapter.has(chapter)) continue;
    byChapter.set(chapter, {
      narrativeChapter: chapter,
      summary: (clean(event.evidenceText) || clean(event.predicate) || "").slice(0, 160),
      anachronic: false,
    });
  }
  return [...byChapter.values()].sort((left, right) => left.narrativeChapter - right.narrativeChapter);
}

// ─── 工具出口：查询子图（供 LLM 直接读，不自己推断） ───────────────────────

export interface EntitySubgraph {
  readonly center: GraphEntity;
  readonly neighbors: readonly { entity: GraphEntity; relation: GraphRelation }[];
  readonly recentEvents: readonly CausalNode[];
  readonly knownFacts: readonly KnowledgeEdge[];
}

/**
 * 取某实体的 N 跳子图。这是给工具用的主查询：
 * LLM 拿到的是「已经连好的关系」，不需要自己从散事实里推断谁跟谁有关。
 */
export function queryEntitySubgraph(
  graph: NarrativeGraph,
  entityName: string,
  options: { readonly hops?: number; readonly atChapter?: number; readonly maxNeighbors?: number } = {},
): EntitySubgraph | null {
  const name = clean(entityName);
  const center = graph.entities.find(
    (entity) => entity.name === name || entity.aliases.includes(name),
  );
  if (!center) return null;

  const atChapter = options.atChapter ?? graph.currentChapter;
  const maxNeighbors = options.maxNeighbors ?? 12;

  // valid-time 过滤：只取在该章仍成立的关系
  const activeRelations = graph.relations.filter((relation) => {
    if (relation.validFrom !== undefined && relation.validFrom > atChapter) return false;
    if (relation.validTo !== undefined && relation.validTo <= atChapter) return false;
    return relation.sourceId === center.id || relation.targetId === center.id;
  });

  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const neighbors = activeRelations
    .flatMap((relation) => {
      const otherId = relation.sourceId === center.id ? relation.targetId : relation.sourceId;
      const entity = entityById.get(otherId);
      return entity ? [{ entity, relation }] : [];
    })
    .sort((left, right) => right.entity.degree - left.entity.degree)
    .slice(0, maxNeighbors);

  const recentEvents = graph.causal
    .filter((node) => node.chapterNumber <= atChapter && node.participants.includes(center.name))
    .slice(-8);

  const knownFacts = graph.knowledge
    .filter((edge) => edge.knowerId === center.id && edge.knowsFrom <= atChapter)
    .slice(-12);

  return { center, neighbors, recentEvents, knownFacts };
}

/** 第 N 章时的世界快照：存活实体 + 有效关系 + 当时状态。 */
export function worldStateAtChapter(graph: NarrativeGraph, chapter: number): {
  readonly entities: readonly GraphEntity[];
  readonly relations: readonly GraphRelation[];
  readonly openForeshadows: readonly ForeshadowNode[];
} {
  return {
    entities: graph.entities.filter(
      (entity) => entity.firstChapter === undefined || entity.firstChapter <= chapter,
    ),
    relations: graph.relations.filter((relation) => {
      if (relation.validFrom !== undefined && relation.validFrom > chapter) return false;
      if (relation.validTo !== undefined && relation.validTo <= chapter) return false;
      return true;
    }),
    openForeshadows: graph.foreshadows.filter(
      (node) => node.phase !== "paid_off"
        && (node.setupChapter === undefined || node.setupChapter <= chapter),
    ),
  };
}
