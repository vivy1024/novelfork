import {
  getStorageDatabase,
  loadChapterStateProjection,
  type ChapterStateProjection,
} from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { findHardOverflowWarning, hardOverflowExplanation } from "../engine/narrative-memory/overflow-guard.js";
import { preserveLatestWritingInjection } from "../engine/narrative-memory/writing-injection-preserve.js";
import { createSiliconFlowEmbeddingProvider, loadEntityVectorsFromStore, similarityFromVectors } from "../engine/narrative-memory/embedding-provider.js";
import { loadEmbeddingConfig } from "../engine/narrative-memory/embedding-settings.js";
import { loadNarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { resolveWritingLayers } from "../engine/writing-layers/layer-store.js";
import { loadSceneVoiceConstraints } from "../engine/writing-layers/character-voice-context.js";
import { applyNarrativeEvents } from "../engine/narrative-memory/reducer.js";
import { createNarrativeEvent, persistNarrativeEvents } from "../engine/narrative-memory/events.js";
import { buildEntityDictionary } from "../engine/narrative-memory/entity-dictionary.js";
import { parseCausedBy } from "../engine/narrative-memory/causal-resolve.js";
import { ensureNarrativeMemorySchema, getNarrativeEventById, listPendingNarrativeEvents, loadMentionsByChapter, queryNarrativeFacts, updateNarrativeEvent, updateNarrativeEventStatus } from "../engine/narrative-memory/storage.js";
import { buildCooccurrenceFromEvents } from "../engine/narrative-memory/wave/narrative-cooccurrence-source.js";
import { buildNarrativeGraph } from "../engine/narrative-taxonomy/narrative-graph.js";
import { loadForeshadowEntries } from "../engine/narrative-taxonomy/foreshadow-states.js";
import { NarrativeContextChannelSchema, type NarrativeEvent, type NarrativeEventType, type NarrativeFactLayer, type NarrativeRetrievalPurpose } from "../engine/narrative-memory/types.js";
import { handleJingweiRead, type JingweiReadInput, type JingweiReadResult } from "./jingwei-read-unified.js";
import { handleJingweiWrite, type JingweiWriteInput, type JingweiWriteResult } from "./jingwei-write-handler.js";

export type LoreReadInput = JingweiReadInput;
export type LoreWriteInput = JingweiWriteInput;

export function handleLoreRead(input: LoreReadInput): Promise<JingweiReadResult> {
  return handleJingweiRead(input);
}

export function handleLoreWrite(input: LoreWriteInput): Promise<JingweiWriteResult> {
  return handleJingweiWrite(input);
}

export interface MemoryReadInput {
  bookId: string;
  purpose: "write" | "revise" | "audit" | "outline" | "diagnose";
  chapterNumber?: number;
  entities?: string[];
  /** 点名实体：write profile 超 6/8/3 上限时仍保留。 */
  namedEntities?: string[];
  sceneText?: string;
  budgetTokens?: number;
  channels?: string[];
  /** Trusted absolute book root for loading book.json narrativeMemory config. */
  bookRoot?: string;
}

export interface MemoryGraphInput {
  bookId: string;
  view: "relationship" | "timeline" | "character_arc" | "foreshadowing" | "conflict" | "event_chain" | "wave";
  focusEntity?: string;
  /** 经纬条目 id。有值时按身份链过滤，不扫名字或别名。 */
  focusEntryId?: string;
  chapterRange?: readonly [number | undefined, number | undefined] | readonly number[];
  /** 默认返回前 200 条；传 0 返回当前筛选下的全部数据。 */
  limit?: number;
  /** 分页偏移，和 limit 一起使用。 */
  offset?: number;
}

export interface MemoryEventsInput {
  bookId: string;
  action: "list" | "create" | "approve" | "reject";
  eventId?: string;
  chapterNumber?: number;
  eventType?: NarrativeEventType;
  subject?: string;
  predicate?: string;
  object?: string;
  evidenceText?: string;
  confidence?: number;
  layer?: NarrativeFactLayer;
  /**
   * create 时的草案来源。缺省 "manual"（作者手建，保持历史语义：一律 pending）。
   * 传 "agent" 时按 classifyNarrativeEventRisk 分流：低风险自动生效并写入 fact，
   * 高风险仍进待确认等作者裁决（T-29）。
   */
  source?: "manual" | "agent";
  reason?: string;
  limit?: number;
  /** approve 时覆盖原草案字段（edit-approve：机器抽错一个字不用整章重结）。 */
  editSubject?: string;
  editPredicate?: string;
  editObject?: string;
  editEvidenceText?: string;
  /** Trusted absolute book root injected by the Runtime/product router. */
  bookRoot?: string;
  /**
   * 一次创建多条 Pending 事件。传入后忽略顶层单条 subject/predicate/object。
   * source 不看这里：批次内逐条写法会分叉行为，统一以顶层 source 为准。
   */
  events?: readonly Omit<MemoryEventsInput, "bookId" | "action" | "events" | "eventId" | "limit" | "reason" | "bookRoot" | "source">[];
}

type ToolResult =
  | { ok: true; summary: string; data: Record<string, unknown> }
  | { ok: false; error: string; summary: string };

function mapPurpose(purpose: MemoryReadInput["purpose"]): NarrativeRetrievalPurpose {
  switch (purpose) {
    case "write":
      return "write_chapter";
    case "diagnose":
      return "audit";
    default:
      return purpose;
  }
}

function channelBudgetPolicy(input: MemoryReadInput): { maxTokens?: number; channelBudgets?: Record<string, number> } | undefined {
  const policy: { maxTokens?: number; channelBudgets?: Record<string, number> } = {};
  if (input.budgetTokens) policy.maxTokens = input.budgetTokens;
  if (input.channels && input.channels.length > 0 && input.budgetTokens) {
    const perChannel = Math.max(1, Math.floor(input.budgetTokens / input.channels.length));
    policy.channelBudgets = Object.fromEntries(input.channels.map((channel) => [channel, perChannel]));
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
}

/** 显式圈定了通道、且没有覆盖全部召回通道：这是一次部分重取，不是完整写作注入。 */
function isPartialChannelScope(channels: readonly string[] | undefined): boolean {
  if (!Array.isArray(channels) || channels.length === 0) return false;
  return !NarrativeContextChannelSchema.options.every((channel) => channels.includes(channel));
}

export async function handleMemoryRead(input: MemoryReadInput): Promise<ToolResult> {
  const bookId = String(input.bookId || "").trim();
  if (!bookId) return { ok: false, error: "invalid-input", summary: "bookId 必填。" };
  if (!["write", "revise", "audit", "outline", "diagnose"].includes(input.purpose)) {
    return { ok: false, error: "invalid-purpose", summary: "purpose 必须是 write | revise | audit | outline | diagnose。" };
  }

  const storage = getStorageDatabase();
  const bookRoot = input.bookRoot?.trim() || undefined;
  const memoryConfig = bookRoot
    ? await loadNarrativeMemoryConfig(bookId, bookRoot).catch(() => null)
    : null;
  const writingLayers = bookRoot
    ? await resolveWritingLayers({ bookRoot }).catch(() => null)
    : null;
  const maxTokens = input.budgetTokens ?? memoryConfig?.retrieval.maxTokens;
  const namedEntities = [...(input.namedEntities ?? []), ...(input.entities ?? [])];
  // 写作与修改时注入点名角色的已确认声线；按名字精确匹配，只会命中角色条目。
  const sceneVoices = input.purpose === "write" || input.purpose === "revise"
    ? await loadSceneVoiceConstraints({ storage, bookId, characterNames: namedEntities }).catch(() => null)
    : null;
  const result = await buildNarrativeContext({
    storage,
    bookId,
    purpose: mapPurpose(input.purpose),
    chapterNumber: input.chapterNumber,
    sceneText: input.sceneText,
    entities: input.entities ?? [],
    namedEntities,
    maxTokens,
    budgetPolicy: channelBudgetPolicy({ ...input, budgetTokens: maxTokens }),
    enabledChannels: memoryConfig?.retrieval.channels,
    waveConfig: { enabled: memoryConfig?.retrieval.waveEnabled ?? false },
    semanticConfig: { enabled: memoryConfig?.retrieval.semanticEnabled ?? false },
    ...(memoryConfig?.retrieval.semanticEnabled
      ? await (async () => {
        const embeddingConfig = await loadEmbeddingConfig(storage);
        return embeddingConfig ? { semanticProvider: createSiliconFlowEmbeddingProvider(embeddingConfig) } : {};
      })()
      : {}),
    ...(writingLayers?.bookRulesText ? { bookRulesText: writingLayers.bookRulesText } : {}),
    ...(writingLayers?.styleGuideText ? { styleGuideText: writingLayers.styleGuideText } : {}),
    ...(writingLayers?.stylePreset ? { stylePreset: writingLayers.stylePreset } : {}),
    ...(sceneVoices?.text ? { voiceConstraints: sceneVoices.text } : {}),
    ...(writingLayers?.bookDesignText ? { bookDesignText: writingLayers.bookDesignText } : {}),
    // 角色内核：config.characterKernel.enabled=false（默认）时通道内部直接跳过。
    ...(memoryConfig?.characterKernel ? { characterKernelConfig: memoryConfig.characterKernel } : {}),
    ...(memoryConfig?.retrieval.writeProfile ? { writeProfileCaps: memoryConfig.retrieval.writeProfile } : {}),
  });

  // T4.7：写作向召回的保护预算溢出，改「静默降级继续」为「显式报错」。
  // 一般浏览用途不拦，保留 ok:true + warnings（研究类调用不该被预算卡死）。
  // 显式圈定 channels 且未要 hard 时，hard 不在本次范围（预算额度也被分到圈定通道），
  // 此时 hard 的零预算告警是数学必然而不是保护违约，不拦。
  const hardScopeExcluded = Array.isArray(input.channels) && !input.channels.includes("hard");
  const hardOverflow = findHardOverflowWarning(result.diagnostics.warnings);
  if (hardOverflow && !hardScopeExcluded && (input.purpose === "write" || input.purpose === "revise")) {
    return {
      ok: false,
      error: "memory-budget-overflow",
      summary: hardOverflowExplanation(hardOverflow),
    };
  }

  const profile = result.writeProfile as {
    coreCharacters?: { items?: unknown[]; cap?: number };
    activeHooks?: { items?: unknown[]; cap?: number };
    recentSummaries?: { items?: unknown[]; cap?: number };
  } | undefined;
  const characterCap = profile?.coreCharacters?.cap ?? 6;
  const hookCap = profile?.activeHooks?.cap ?? 8;
  const summaryCap = profile?.recentSummaries?.cap ?? 3;
  const profileSummary = profile
    ? ` 七栏 write profile：角色 ${profile.coreCharacters?.items?.length ?? 0}/${characterCap}，伏笔 ${profile.activeHooks?.items?.length ?? 0}/${hookCap}，近章 ${profile.recentSummaries?.items?.length ?? 0}/${summaryCap}。`
    : "";
  // T4.7 尾巴：写作注入（write/revise）把当次进上下文的原文保留一份快照，会话压缩后模型
  // 仍能在系统提示里看到原件。写盘失败不阻断召回，但在 warnings 里如实说明。
  // T-05c：只有完整写作注入才覆盖保留件；显式圈定部分通道的重取（channels 子集）只是补看某几栏，
  // 若也覆盖，保留件会被换成只含一两栏的窄快照，压缩后丢掉其余原文。
  const preserveWarnings: string[] = [];
  if ((input.purpose === "write" || input.purpose === "revise") && bookRoot && !isPartialChannelScope(input.channels)) {
    try {
      await preserveLatestWritingInjection(bookRoot, result);
    } catch (cause) {
      preserveWarnings.push(`写作注入保留件写盘失败（${cause instanceof Error ? cause.message : String(cause)}）；本次召回正常，但会话压缩后需按资料索引卡重取原文。`);
    }
  }
  return {
    ok: true,
    summary: `已召回动态叙事记忆：${result.cards.length} 张 ContextCard，约 ${result.diagnostics.totalEstimatedTokens} tokens。${profileSummary}`,
    data: {
      package: result,
      diagnostics: result.diagnostics,
      sections: result.sections,
      cards: result.cards,
      warnings: [...result.diagnostics.warnings, ...preserveWarnings],
      writeProfile: result.writeProfile,
      trimReasons: result.diagnostics.trimReasons ?? [],
    },
  };
}

function graphEventTypes(view: MemoryGraphInput["view"]): Set<string> | undefined {
  switch (view) {
    case "relationship": return new Set(["relationship_changed"]);
    case "timeline": return new Set(["timeline_advanced", "location_changed", "world_fact_introduced"]);
    case "character_arc": return new Set(["character_state_changed"]);
    case "foreshadowing": return new Set(["hook_planted", "hook_progressed", "hook_triggered", "hook_resolved"]);
    case "conflict": return new Set(["relationship_changed", "world_fact_introduced"]);
    case "event_chain": return undefined;
    case "wave": return undefined;
  }
}

function graphFactCategories(view: MemoryGraphInput["view"]): Set<string> | undefined {
  switch (view) {
    case "relationship": return new Set(["relationship"]);
    case "timeline": return new Set(["timeline", "location", "world_fact"]);
    case "character_arc": return new Set(["character_state"]);
    case "foreshadowing": return new Set(["hook"]);
    case "conflict": return new Set(["relationship", "world_fact"]);
    case "event_chain": return undefined;
    case "wave": return undefined;
  }
}

function withinChapterRange(
  chapterNumber: unknown,
  range?: readonly (number | undefined)[],
): boolean {
  if (!range) return true;
  const from = typeof range[0] === "number" && Number.isFinite(range[0]) ? range[0] : undefined;
  const to = typeof range[1] === "number" && Number.isFinite(range[1]) ? range[1] : undefined;
  if (from === undefined && to === undefined) return true;
  const value = typeof chapterNumber === "number" ? chapterNumber : Number(chapterNumber);
  return Number.isFinite(value)
    && (from === undefined || value >= from)
    && (to === undefined || value <= to);
}

function matchesFocusEvent(
  event: Record<string, unknown>,
  focusEntity?: string,
  focusEntryId?: string,
): boolean {
  const entryId = focusEntryId?.trim();
  if (entryId) {
    return event.subjectEntryId === entryId || event.objectEntryId === entryId;
  }
  if (!focusEntity) return true;
  return [event.subject, event.object].some((value) => typeof value === "string" && value.includes(focusEntity));
}

function matchesFocusFact(
  fact: { subject: string; object: string; subjectEntryId?: string; objectEntryId?: string; sourceId?: string },
  focusEntity?: string,
  focusEntryId?: string,
): boolean {
  const entryId = focusEntryId?.trim();
  if (entryId) {
    return fact.subjectEntryId === entryId || fact.objectEntryId === entryId || fact.sourceId === entryId;
  }
  if (!focusEntity) return true;
  return [fact.subject, fact.object].some((value) => value.includes(focusEntity));
}

const DEFAULT_GRAPH_LIMIT = 200;
const MAX_GRAPH_LIMIT = 500;

type GraphPageMetadata = {
  readonly total: number;
  readonly returned: number;
  readonly offset: number;
  readonly limit: number | null;
  readonly truncated: boolean;
};

type GraphPage<T> = {
  readonly items: T[];
  readonly pagination: GraphPageMetadata;
};

function graphPage<T>(items: T[], limit: unknown, offset: unknown): GraphPage<T> {
  const parsedLimit = Number(limit);
  const pageLimit = limit === undefined
    ? DEFAULT_GRAPH_LIMIT
    : Number.isFinite(parsedLimit) && parsedLimit >= 0
      ? Math.min(Math.trunc(parsedLimit), MAX_GRAPH_LIMIT)
      : DEFAULT_GRAPH_LIMIT;
  const parsedOffset = Number(offset);
  const pageOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.trunc(parsedOffset) : 0;
  const pageItems = pageLimit === 0 ? items.slice(pageOffset) : items.slice(pageOffset, pageOffset + pageLimit);
  return {
    items: pageItems,
    pagination: {
      total: items.length,
      returned: pageItems.length,
      offset: pageOffset,
      limit: pageLimit === 0 ? null : pageLimit,
      truncated: pageOffset > 0 || pageItems.length < items.length - pageOffset,
    },
  };
}

export async function handleMemoryGraph(
  input: MemoryGraphInput,
  storageOverride?: StorageDatabase,
  projectionOverride?: ChapterStateProjection,
): Promise<ToolResult> {
  const bookId = String(input.bookId || "").trim();
  if (!bookId) return { ok: false, error: "invalid-input", summary: "bookId 必填。" };
  if (!["relationship", "timeline", "character_arc", "foreshadowing", "conflict", "event_chain", "wave"].includes(input.view)) {
    return { ok: false, error: "invalid-view", summary: "view 必须是 relationship | timeline | character_arc | foreshadowing | conflict | event_chain | wave。" };
  }

  const storage = storageOverride ?? getStorageDatabase();
  ensureNarrativeMemorySchema(storage);
  const focusEntryId = input.focusEntryId?.trim() || undefined;
  const entities = !focusEntryId && input.focusEntity ? [input.focusEntity] : undefined;
  const eventTypeFilter = graphEventTypes(input.view);
  const factCategoryFilter = graphFactCategories(input.view);
  const projection = projectionOverride ?? loadChapterStateProjection(storage, bookId);
  const derivedFacts = derivedFactsFromProjection(bookId, projection);

  // 先全量读取再过滤。不能把 limit 放在 SQL/存储查询之前，否则大书中排在
  // 前 200/500 条之外的目标实体或章节会被静默丢掉。
  const allFacts = [...derivedFacts, ...queryNarrativeFacts(storage, {
    bookId,
    entities,
    ...(focusEntryId ? { entryIds: [focusEntryId] } : {}),
    limit: 0,
  })];
  const filteredFacts = allFacts
    .filter((fact) => !factCategoryFilter || factCategoryFilter.has(fact.category))
    .filter((fact) => withinChapterRange(fact.sourceChapter ?? fact.validFromChapter, input.chapterRange))
    .filter((fact) => matchesFocusFact(fact, input.focusEntity, focusEntryId));
  let allEvents: Record<string, unknown>[] = [];
  try {
    allEvents = storage.sqlite.prepare(`
      SELECT id, chapter_number AS chapterNumber, event_type AS eventType, subject, predicate, object,
             subject_entry_id AS subjectEntryId, object_entry_id AS objectEntryId,
             caused_by_json AS causedByJson,
             evidence_text AS evidenceText, confidence, source, status, risk_level AS riskLevel, created_at AS createdAt, applied_at AS appliedAt
      FROM narrative_event
      WHERE book_id = ?
      ORDER BY chapter_number DESC, created_at DESC
    `).all(bookId) as Record<string, unknown>[];
  } catch {
    allEvents = storage.sqlite.prepare(`
      SELECT id, chapter_number AS chapterNumber, event_type AS eventType, subject, predicate, object,
             subject_entry_id AS subjectEntryId, object_entry_id AS objectEntryId,
             evidence_text AS evidenceText, confidence, source, status, risk_level AS riskLevel, created_at AS createdAt, applied_at AS appliedAt
      FROM narrative_event
      WHERE book_id = ?
      ORDER BY chapter_number DESC, created_at DESC
    `).all(bookId) as Record<string, unknown>[];
  }
  const eventsWithCauses = allEvents.map((event) => {
    const causedBy = parseCausedBy(event.causedByJson);
    return causedBy.length > 0 ? { ...event, causedBy } : event;
  });
  const filteredEvents = eventsWithCauses
    .filter((event) => !eventTypeFilter || eventTypeFilter.has(String(event.eventType)))
    .filter((event) => withinChapterRange(event.chapterNumber, input.chapterRange))
    .filter((event) => matchesFocusEvent(event, input.focusEntity, focusEntryId));
  const factPage = graphPage(filteredFacts, input.limit, input.offset);
  const eventPage = graphPage(filteredEvents, input.limit, input.offset);
  const truncationSummary = factPage.pagination.truncated || eventPage.pagination.truncated
    ? ` 当前结果已分页（事实 ${factPage.pagination.total} 条、事件 ${eventPage.pagination.total} 条），可传 limit=0 获取全部数据。`
    : "";

  const dictionary = buildEntityDictionary(storage, bookId);
  const mentionsByChapter = loadMentionsByChapter(storage, bookId);
  const embeddingConfig = await loadEmbeddingConfig(storage);
  const entityVectors = embeddingConfig
    ? loadEntityVectorsFromStore(storage, bookId, embeddingConfig.model, embeddingConfig.dim)
    : new Map<string, readonly number[]>();
  const similarity = entityVectors.size > 0 ? similarityFromVectors(entityVectors) : undefined;
  const cooccurrence = buildCooccurrenceFromEvents({
    dictionary,
    events: eventsWithCauses.map((event) => ({
      id: String(event.id ?? ""),
      chapterNumber: typeof event.chapterNumber === "number" ? event.chapterNumber : Number(event.chapterNumber),
      subject: typeof event.subject === "string" ? event.subject : "",
      object: typeof event.object === "string" ? event.object : "",
    })),
    mentionsByChapter,
    ...(similarity ? { similarity, useNovelGain: true } : {}),
  });
  const narrativeGraph = buildNarrativeGraph({
    dictionary,
    facts: filteredFacts,
    // 伏笔网络只认经纬伏笔条目；事件只作推进证据（见 foreshadow-states）
    entries: loadForeshadowEntries(storage, bookId).map((entry) => ({ ...entry, category: "foreshadowing" })),
    events: eventsWithCauses.map((event) => ({
      id: String(event.id ?? ""),
      chapterNumber: typeof event.chapterNumber === "number" ? event.chapterNumber : Number(event.chapterNumber),
      eventType: String(event.eventType ?? ""),
      subject: typeof event.subject === "string" ? event.subject : "",
      predicate: typeof event.predicate === "string" ? event.predicate : "",
      object: typeof event.object === "string" ? event.object : "",
      evidenceText: typeof event.evidenceText === "string" ? event.evidenceText : "",
      riskLevel: typeof event.riskLevel === "string" ? event.riskLevel : undefined,
      status: typeof event.status === "string" ? event.status : undefined,
      subjectEntryId: typeof event.subjectEntryId === "string" ? event.subjectEntryId : undefined,
      causedBy: Array.isArray(event.causedBy) ? event.causedBy as string[] : undefined,
    })),
    currentChapter: projection.lastChapter,
  });

  return {
    ok: true,
    summary: `已读取 ${input.view} 记忆图谱：${factPage.items.length} 条事实，${eventPage.items.length} 个事件，共现 ${cooccurrence.graph.nodeCount} 节点/${cooccurrence.graph.edges.length} 边，显式因果 ${narrativeGraph.quality.explicitCausalEdges}。${truncationSummary}`,
    data: {
      view: input.view,
      focusEntity: input.focusEntity,
      focusEntryId,
      chapterRange: input.chapterRange,
      facts: factPage.items,
      events: eventPage.items,
      pagination: {
        facts: factPage.pagination,
        events: eventPage.pagination,
      },
      cooccurrence: {
        nodeCount: cooccurrence.graph.nodeCount,
        edgeCount: cooccurrence.graph.edges.length,
        resolvedTags: cooccurrence.resolvedTags,
        unresolvedTags: cooccurrence.unresolvedTags,
        unresolvedSamples: cooccurrence.unresolvedSamples,
        semanticGainActive: cooccurrence.semanticGainActive,
        edges: cooccurrence.graph.edges.slice(0, 80),
      },
      causal: narrativeGraph.causal.slice(0, 80),
      foreshadows: narrativeGraph.foreshadows.slice(0, 80),
      quality: narrativeGraph.quality,
      note: "角色/关系/伏笔/时间线优先从 ChapterStateDelta 归约；共现走提及清单+别名归一；显式因果来自 causedBy / 伏笔三态。手工备注不进入本图。",
      stateRevision: projection.stateRevision,
      derived: {
        characters: projection.characters.length,
        relationships: projection.relationships.length,
        hooks: projection.hooks.length,
        timeline: projection.timeline.length,
      },
    },
  };
}

export function derivedFactsFromProjection(bookId: string, projection: ChapterStateProjection) {
  const now = "1970-01-01T00:00:00.000Z";
  return [
    ...projection.characters.map((character) => ({
      id: `derived:character:${character.characterId}`,
      bookId,
      subject: character.name ?? character.characterId,
      predicate: "状态",
      object: character.currentState ?? character.arcProgress ?? character.currentGoal ?? character.characterId,
      category: "character_state",
      layer: "dynamic" as const,
      confidence: 1,
      sourceType: "runtime-state" as const,
      sourceId: character.characterId,
      sourceChapter: character.lastChapter,
      validFromChapter: character.lastChapter,
      createdAt: now,
      updatedAt: now,
    })),
    ...projection.relationships.map((relationship) => ({
      id: `derived:relationship:${relationship.source}:${relationship.target}:${relationship.relationType}`,
      bookId,
      subject: relationship.source,
      predicate: relationship.relationType,
      object: relationship.target,
      category: "relationship",
      layer: "dynamic" as const,
      confidence: 1,
      sourceType: "runtime-state" as const,
      sourceId: `${relationship.source}:${relationship.target}`,
      sourceChapter: relationship.lastChapter,
      evidenceText: relationship.description,
      validFromChapter: relationship.lastChapter,
      createdAt: now,
      updatedAt: now,
    })),
    ...projection.hooks.map((hook) => ({
      id: `derived:hook:${hook.hookId}`,
      bookId,
      subject: hook.hookId,
      predicate: hook.status,
      object: hook.expectedPayoff || hook.notes || hook.hookId,
      category: "hook",
      layer: "dynamic" as const,
      confidence: 1,
      sourceType: "runtime-state" as const,
      sourceId: hook.hookId,
      sourceChapter: hook.lastAdvancedChapter,
      evidenceText: hook.notes,
      validFromChapter: hook.startChapter,
      createdAt: now,
      updatedAt: now,
    })),
    ...projection.timeline.map((entry) => ({
      id: `derived:timeline:${entry.chapter}`,
      bookId,
      subject: "时间线",
      predicate: entry.label || "推进",
      object: entry.storyTime || `第${entry.chapter}章`,
      category: "timeline",
      layer: "dynamic" as const,
      confidence: 1,
      sourceType: "runtime-state" as const,
      sourceId: `timeline:${entry.chapter}`,
      sourceChapter: entry.chapter,
      validFromChapter: entry.chapter,
      createdAt: now,
      updatedAt: now,
    })),
  ];
}

function getPendingEventByBook(storage: StorageDatabase, bookId: string, eventId: string): NarrativeEvent | undefined {
  const event = getNarrativeEventById(storage, bookId, eventId);
  return event?.status === "pending" ? event : undefined;
}

export async function handleMemoryEvents(input: MemoryEventsInput, storageOverride?: StorageDatabase): Promise<ToolResult> {
  const bookId = String(input.bookId || "").trim();
  if (!bookId) return { ok: false, error: "invalid-input", summary: "bookId 必填。" };

  const storage = storageOverride ?? getStorageDatabase();
  ensureNarrativeMemorySchema(storage);
  const action = input.action ?? "list";

  if (action === "list") {
    const events = listPendingNarrativeEvents(storage, { bookId, limit: input.limit });
    return { ok: true, summary: `共有 ${events.length} 个 Pending NarrativeEvents。`, data: { events } };
  }

  if (action === "create") {
    const drafts = Array.isArray(input.events) && input.events.length > 0
      ? input.events
      : [input];
    if (drafts.length > 20) {
      return { ok: false, error: "batch-too-large", summary: "一次最多创建 20 条 Pending NarrativeEvents。" };
    }
    // T-29：agent 来源走 classifyNarrativeEventRisk 分流，manual 保持「一律 pending」的历史语义。
    // 单条与批量都以顶层 source 为准，避免批量里逐条写法不一时行为分叉。
    const isAgentSource = input.source === "agent";
    const createdEvents = [];
    for (const [index, draft] of drafts.entries()) {
      if (!draft.chapterNumber || !draft.eventType || !draft.subject || !draft.predicate || !draft.object || !draft.evidenceText) {
        return { ok: false, error: "invalid-input", summary: `create 第 ${index + 1} 条需要 chapterNumber、eventType、subject、predicate、object、evidenceText。` };
      }
      const created = createNarrativeEvent({
        bookId,
        chapterNumber: draft.chapterNumber,
        eventType: draft.eventType,
        subject: draft.subject,
        predicate: draft.predicate,
        object: draft.object,
        evidenceText: draft.evidenceText,
        confidence: draft.confidence ?? 0.8,
        source: isAgentSource ? "agent" : "manual",
        layer: draft.layer ?? "dynamic",
      });
      // 作者手建的一律待确认：createNarrativeEvent 只看 eventType/confidence，会把低风险判成 applied，
      // 那不是「作者已裁决」，只是风险分级的结果，必须显式压回 pending。
      createdEvents.push(isAgentSource ? created : { ...created, status: "pending" as const, appliedAt: undefined });
    }
    // 事件 id 由「书/章/类型/主谓宾」确定性生成：改写后重新抽取、或同一批里写了两遍，都会撞同一个 id。
    // 与章后结算的 persistSettlementEvents 同口径：已存在就复用既有记录，不重复入库、不抛数据库异常；
    // 已被作者裁决（applied/rejected）的保持原裁决，不被重新提交翻回 pending，也不再归约。
    const uniqueEvents = [...new Map(createdEvents.map((event) => [event.id, event])).values()];
    const fresh: NarrativeEvent[] = [];
    const reused: NarrativeEvent[] = [];
    for (const event of uniqueEvents) {
      const existing = getNarrativeEventById(storage, bookId, event.id);
      if (existing) reused.push(existing);
      else fresh.push(event);
    }
    const inserted = persistNarrativeEvents(storage, fresh);
    const persisted = uniqueEvents.map((event) => inserted.find((item) => item.id === event.id) ?? reused.find((item) => item.id === event.id)!);
    const reusedNote = reused.length > 0 ? `（其中 ${reused.length} 条已存在，沿用原记录）` : "";
    if (isAgentSource) {
      // 低风险草案自动生效：与章后结算同一条路——归约器写 fact 并把事件落 applied。
      // 只把 status 写成 applied 而不归约，会留下「applied 却没有 fact」的悬空事件。
      // 只归约新插入的，以及复用但仍是 pending 的；作者已裁决的不动。
      const reducible = persisted.filter((event) => inserted.includes(event) || event.status === "pending");
      const applied = applyNarrativeEvents(storage, bookId, reducible);
      if (applied.failedEvents.length > 0) {
        return {
          ok: false,
          error: "event-apply-failed",
          summary: `agent 草案归约失败：${applied.failedEvents.map((item) => `${item.id}: ${item.error}`).join("；")}`,
        };
      }
      const finalEvents = persisted.map((event) => getNarrativeEventById(storage, bookId, event.id) ?? event);
      return {
        ok: true,
        summary: finalEvents.length === 1
          ? `已创建 agent 草案：${finalEvents[0]!.id}（${finalEvents[0]!.status}）${reusedNote}。`
          : `已批量创建 ${finalEvents.length} 条 agent 草案${reusedNote}。`,
        data: finalEvents.length === 1 ? { event: finalEvents[0], events: finalEvents } : { events: finalEvents },
      };
    }
    return {
      ok: true,
      summary: persisted.length === 1
        ? `已创建 Pending NarrativeEvent：${persisted[0]!.id}${reusedNote}。`
        : `已批量创建 ${persisted.length} 条 Pending NarrativeEvents${reusedNote}。`,
      data: persisted.length === 1 ? { event: persisted[0], events: persisted } : { events: persisted },
    };
  }

  if (!input.eventId) return { ok: false, error: "invalid-input", summary: "approve/reject 需要 eventId。" };
  if (action === "approve") {
    const event = getPendingEventByBook(storage, bookId, input.eventId);
    if (!event) return { ok: false, error: "event-not-found", summary: `Pending 事件 ${input.eventId} 不存在。` };
    // edit-approve：作者批准时可覆盖草案字段，再应用修正后的值。
    const approvedEvent: NarrativeEvent = {
      ...event,
      ...(input.editSubject?.trim() ? { subject: input.editSubject.trim() } : {}),
      ...(input.editPredicate?.trim() ? { predicate: input.editPredicate.trim() } : {}),
      ...(input.editObject?.trim() ? { object: input.editObject.trim() } : {}),
      ...(input.editEvidenceText?.trim() ? { evidenceText: input.editEvidenceText.trim() } : {}),
      status: "applied",
    };
    const config = input.bookRoot?.trim()
      ? await loadNarrativeMemoryConfig(bookId, input.bookRoot).catch(() => null)
      : null;
    type ApplyResult = ReturnType<typeof applyNarrativeEvents>;
    class EventApprovalError extends Error {
      constructor(readonly code: "event-apply-failed" | "event-not-applied", message: string, readonly applied?: ApplyResult) {
        super(message);
      }
    }
    let applied: ApplyResult | undefined;
    let updatedEvent: NarrativeEvent | undefined;
    try {
      storage.sqlite.transaction(() => {
        // 先把作者修正后的字段写回 narrative_event，再让 reducer 用同一份值生成 fact。
        // 整个 edit-approve 在一个 SQLite transaction 内完成，避免 event/fact 半成功。
        updatedEvent = updateNarrativeEvent(storage, {
          ...approvedEvent,
          status: "pending",
          appliedAt: undefined,
        });
        if (!updatedEvent) throw new EventApprovalError("event-not-applied", `事件 ${event.id} 不存在或已被其他操作处理。`);
        applied = applyNarrativeEvents(storage, bookId, [approvedEvent], {
          closeSupersededFacts: config?.ledger.closeSupersededFacts ?? true,
        });
        if (applied.failedEvents.length > 0) {
          throw new EventApprovalError("event-apply-failed", `批准事件 ${event.id} 失败：${applied.failedEvents[0]?.error ?? "unknown"}`, applied);
        }
        if (applied.skippedEventIds.includes(event.id)) {
          updateNarrativeEventStatus(storage, { id: event.id, status: "applied" });
        } else if (!applied.appliedEventIds.includes(event.id)) {
          throw new EventApprovalError("event-not-applied", `事件 ${event.id} 未写入 Narrative Memory facts，请检查事件状态与风险等级。`, applied);
        }
      })();
    } catch (error) {
      if (error instanceof EventApprovalError) {
        return { ok: false, error: error.code, summary: error.message };
      }
      throw error;
    }
    const persisted = getNarrativeEventById(storage, bookId, event.id) ?? updatedEvent ?? approvedEvent;
    if (applied?.skippedEventIds.includes(event.id)) {
      return { ok: true, summary: `已批准 Pending NarrativeEvent：${event.id}；对应事实已存在，跳过重复写入。`, data: { event: persisted, applied, reason: input.reason } };
    }
    return { ok: true, summary: `已批准 Pending NarrativeEvent：${event.id}，并写入 Narrative Memory facts。`, data: { event: persisted, applied, reason: input.reason } };
  }
  if (action === "reject") {
    const event = getPendingEventByBook(storage, bookId, input.eventId);
    if (!event) return { ok: false, error: "event-not-found", summary: `Pending 事件 ${input.eventId} 不存在。` };
    const updated = updateNarrativeEventStatus(storage, { id: event.id, status: "rejected" });
    return { ok: true, summary: `已拒绝 Pending NarrativeEvent：${input.eventId}。`, data: { event: updated ?? event, reason: input.reason } };
  }
  return { ok: false, error: "invalid-action", summary: "action 必须是 list | create | approve | reject。" };
}
