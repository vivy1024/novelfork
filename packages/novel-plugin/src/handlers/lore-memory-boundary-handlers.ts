import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { loadNarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { applyNarrativeEvents } from "../engine/narrative-memory/reducer.js";
import { createNarrativeEvent, persistNarrativeEvents } from "../engine/narrative-memory/events.js";
import { ensureNarrativeMemorySchema, listPendingNarrativeEvents, queryNarrativeFacts, updateNarrativeEventStatus } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent, NarrativeEventType, NarrativeFactLayer, NarrativeRetrievalPurpose } from "../engine/narrative-memory/types.js";
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
  chapterRange?: [number, number];
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
  reason?: string;
  limit?: number;
  /** approve 时覆盖原草案字段（edit-approve：机器抽错一个字不用整章重结）。 */
  editSubject?: string;
  editPredicate?: string;
  editObject?: string;
  editEvidenceText?: string;
  /** Trusted absolute book root injected by the Runtime/product router. */
  bookRoot?: string;
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

export async function handleMemoryRead(input: MemoryReadInput): Promise<ToolResult> {
  const bookId = String(input.bookId || "").trim();
  if (!bookId) return { ok: false, error: "invalid-input", summary: "bookId 必填。" };
  if (!["write", "revise", "audit", "outline", "diagnose"].includes(input.purpose)) {
    return { ok: false, error: "invalid-purpose", summary: "purpose 必须是 write | revise | audit | outline | diagnose。" };
  }

  const storage = getStorageDatabase();
  const memoryConfig = input.bookRoot?.trim()
    ? await loadNarrativeMemoryConfig(bookId, input.bookRoot).catch(() => null)
    : null;
  const maxTokens = input.budgetTokens ?? memoryConfig?.retrieval.maxTokens;
  const result = await buildNarrativeContext({
    storage,
    bookId,
    purpose: mapPurpose(input.purpose),
    chapterNumber: input.chapterNumber,
    sceneText: input.sceneText,
    entities: input.entities ?? [],
    maxTokens,
    budgetPolicy: channelBudgetPolicy({ ...input, budgetTokens: maxTokens }),
    enabledChannels: memoryConfig?.retrieval.channels,
    waveConfig: { enabled: memoryConfig?.retrieval.waveEnabled ?? false },
    semanticConfig: { enabled: memoryConfig?.retrieval.semanticEnabled ?? false },
  });

  return {
    ok: true,
    summary: `已召回动态叙事记忆：${result.cards.length} 张 ContextCard，约 ${result.diagnostics.totalEstimatedTokens} tokens。`,
    data: {
      package: result,
      diagnostics: result.diagnostics,
      sections: result.sections,
      cards: result.cards,
      warnings: result.diagnostics.warnings,
    },
  };
}

function graphEventTypes(view: MemoryGraphInput["view"]): Set<string> | undefined {
  switch (view) {
    case "relationship": return new Set(["relationship_changed"]);
    case "timeline": return new Set(["timeline_advanced", "location_changed", "world_fact_introduced"]);
    case "character_arc": return new Set(["character_state_changed"]);
    case "foreshadowing": return new Set(["hook_planted", "hook_progressed", "hook_resolved"]);
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

function withinChapterRange(chapterNumber: unknown, range?: readonly number[]): boolean {
  if (!range || range.length < 2) return true;
  const value = typeof chapterNumber === "number" ? chapterNumber : Number(chapterNumber);
  return Number.isFinite(value) && value >= Number(range[0]) && value <= Number(range[1]);
}

function matchesFocus(event: Record<string, unknown>, focusEntity?: string): boolean {
  if (!focusEntity) return true;
  return [event.subject, event.object].some((value) => typeof value === "string" && value.includes(focusEntity));
}

export async function handleMemoryGraph(input: MemoryGraphInput, storageOverride?: StorageDatabase): Promise<ToolResult> {
  const bookId = String(input.bookId || "").trim();
  if (!bookId) return { ok: false, error: "invalid-input", summary: "bookId 必填。" };
  if (!["relationship", "timeline", "character_arc", "foreshadowing", "conflict", "event_chain", "wave"].includes(input.view)) {
    return { ok: false, error: "invalid-view", summary: "view 必须是 relationship | timeline | character_arc | foreshadowing | conflict | event_chain | wave。" };
  }

  const storage = storageOverride ?? getStorageDatabase();
  ensureNarrativeMemorySchema(storage);
  const entities = input.focusEntity ? [input.focusEntity] : undefined;
  const eventTypeFilter = graphEventTypes(input.view);
  const factCategoryFilter = graphFactCategories(input.view);
  const facts = queryNarrativeFacts(storage, { bookId, entities, limit: 200 })
    .filter((fact) => !factCategoryFilter || factCategoryFilter.has(fact.category))
    .filter((fact) => withinChapterRange(fact.sourceChapter, input.chapterRange));
  const allEvents = storage.sqlite.prepare(`
    SELECT id, chapter_number AS chapterNumber, event_type AS eventType, subject, predicate, object,
           evidence_text AS evidenceText, confidence, source, status, risk_level AS riskLevel, created_at AS createdAt, applied_at AS appliedAt
    FROM narrative_event
    WHERE book_id = ?
    ORDER BY chapter_number DESC, created_at DESC
    LIMIT 500
  `).all(bookId) as Record<string, unknown>[];
  const events = allEvents
    .filter((event) => !eventTypeFilter || eventTypeFilter.has(String(event.eventType)))
    .filter((event) => withinChapterRange(event.chapterNumber, input.chapterRange))
    .filter((event) => matchesFocus(event, input.focusEntity))
    .slice(0, 200);

  return {
    ok: true,
    summary: `已读取 ${input.view} 记忆图谱：${facts.length} 条事实，${events.length} 个事件。`,
    data: {
      view: input.view,
      focusEntity: input.focusEntity,
      chapterRange: input.chapterRange,
      facts,
      events,
      note: "第一版复用 NarrativeFact / NarrativeEvent 数据源，只读展示动态图谱语义，不修改 Lore。",
    },
  };
}

function getPendingEventByBook(storage: ReturnType<typeof getStorageDatabase>, bookId: string, eventId: string): NarrativeEvent | undefined {
  const row = storage.sqlite.prepare(`
    SELECT id, book_id AS bookId, chapter_number AS chapterNumber, event_type AS eventType, subject, predicate, object,
           evidence_text AS evidenceText, confidence, source, status, risk_level AS riskLevel, created_at AS createdAt, applied_at AS appliedAt
    FROM narrative_event
    WHERE book_id = ? AND id = ? AND status = 'pending'
  `).get(bookId, eventId) as Record<string, unknown> | undefined;
  return row as NarrativeEvent | undefined;
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
    if (!input.chapterNumber || !input.eventType || !input.subject || !input.predicate || !input.object || !input.evidenceText) {
      return { ok: false, error: "invalid-input", summary: "create 需要 chapterNumber、eventType、subject、predicate、object、evidenceText。" };
    }
    const event = createNarrativeEvent({
      bookId,
      chapterNumber: input.chapterNumber,
      eventType: input.eventType,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      evidenceText: input.evidenceText,
      confidence: input.confidence ?? 0.8,
      source: "manual",
      layer: input.layer ?? "dynamic",
    });
    const created = persistNarrativeEvents(storage, [{ ...event, status: "pending", appliedAt: undefined }])[0]!;
    return { ok: true, summary: `已创建 Pending NarrativeEvent：${created.id}。`, data: { event: created } };
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
    const applied = applyNarrativeEvents(storage, bookId, [approvedEvent], {
      closeSupersededFacts: config?.ledger.closeSupersededFacts ?? true,
    });
    if (applied.failedEvents.length > 0) {
      return { ok: false, error: "event-apply-failed", summary: `批准事件 ${event.id} 失败：${applied.failedEvents[0]?.error ?? "unknown"}` };
    }
    if (applied.skippedEventIds.includes(event.id)) {
      const updated = updateNarrativeEventStatus(storage, { id: event.id, status: "applied" });
      return { ok: true, summary: `已批准 Pending NarrativeEvent：${event.id}；对应事实已存在，跳过重复写入。`, data: { event: updated ?? approvedEvent, applied, reason: input.reason } };
    }
    if (!applied.appliedEventIds.includes(event.id)) {
      return { ok: false, error: "event-not-applied", summary: `事件 ${event.id} 未写入 Narrative Memory facts，请检查事件状态与风险等级。` };
    }
    const updated = updateNarrativeEventStatus(storage, { id: event.id, status: "applied" });
    return { ok: true, summary: `已批准 Pending NarrativeEvent：${event.id}，并写入 Narrative Memory facts。`, data: { event: updated ?? approvedEvent, applied, reason: input.reason } };
  }
  if (action === "reject") {
    const event = getPendingEventByBook(storage, bookId, input.eventId);
    if (!event) return { ok: false, error: "event-not-found", summary: `Pending 事件 ${input.eventId} 不存在。` };
    const updated = updateNarrativeEventStatus(storage, { id: event.id, status: "rejected" });
    return { ok: true, summary: `已拒绝 Pending NarrativeEvent：${input.eventId}。`, data: { event: updated ?? event, reason: input.reason } };
  }
  return { ok: false, error: "invalid-action", summary: "action 必须是 list | create | approve | reject。" };
}
