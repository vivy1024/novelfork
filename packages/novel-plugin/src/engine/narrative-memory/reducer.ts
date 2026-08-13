import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { upsertNarrativeFact } from "./facts.js";
import { closeSupersededNarrativeFacts, narrativeFactSlotKey } from "./ledger.js";
import { queryNarrativeFacts, updateNarrativeEventStatus } from "./storage.js";
import type { NarrativeEvent, NarrativeEventType, NarrativeFact } from "./types.js";

export type ApplyNarrativeEventsResult = Readonly<{
  appliedEventIds: readonly string[];
  pendingEventIds: readonly string[];
  rejectedEventIds: readonly string[];
  skippedEventIds: readonly string[];
  failedEvents: readonly Readonly<{ id: string; error: string }>[];
}>;

export type ApplyNarrativeEventsOptions = Readonly<{
  /** Close open facts that share the same current-state slot before writing the new fact. */
  closeSupersededFacts?: boolean;
}>;

function factCategoryFor(eventType: NarrativeEventType): string {
  switch (eventType) {
    case "character_state_changed":
      return "character_state";
    case "relationship_changed":
      return "relationship";
    case "location_changed":
      return "location";
    case "hook_planted":
    case "hook_progressed":
    case "hook_resolved":
      return "hook";
    case "world_fact_introduced":
      return "world_fact";
    case "timeline_advanced":
      return "timeline";
  }
}

function idPart(value: string): string {
  return value.trim().replace(/\s+/gu, "-").replace(/[^\p{L}\p{N}_:-]+/gu, "").slice(0, 48) || "value";
}

function tupleKey(event: NarrativeEvent): string {
  return [event.bookId, event.chapterNumber, event.eventType, event.subject, event.predicate, event.object].join("\u0000");
}

function factIdFor(event: NarrativeEvent): string {
  return ["event-fact", event.bookId, String(event.chapterNumber), event.eventType, idPart(event.subject), idPart(event.predicate), idPart(event.object)].join(":");
}

function factExists(storage: StorageDatabase, factId: string): boolean {
  const row = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE id = ?").get(factId);
  return (row?.count ?? 0) > 0;
}

function shouldRemainPending(event: NarrativeEvent): boolean {
  if (event.status === "applied") return false;
  return event.status === "pending" || event.riskLevel === "high" || event.eventType === "world_fact_introduced" || event.eventType === "relationship_changed";
}

/**
 * 作者纠正保护：目标 slot 的当前 open fact 是 manual（作者权威值）时，
 * 机器来源（settle/import）的事件不得直接覆盖，降级为 pending 由作者确认。
 * 作者手动录入的事件（source: "manual"）不受此限。
 */
function slotLockedByManualFact(storage: StorageDatabase, event: NarrativeEvent): boolean {
  if (event.source === "manual") return false;
  const probe = eventToFact(event);
  const slot = narrativeFactSlotKey(probe);
  return queryNarrativeFacts(storage, { bookId: event.bookId, categories: [probe.category], limit: 200 })
    .some((fact) =>
      fact.sourceType === "manual"
      && (fact.validUntilChapter === undefined || fact.validUntilChapter === null)
      && narrativeFactSlotKey(fact) === slot
      && fact.object !== probe.object,
    );
}

function eventToFact(event: NarrativeEvent): NarrativeFact {
  const now = new Date().toISOString();
  return {
    id: factIdFor(event),
    bookId: event.bookId,
    subject: event.subject,
    predicate: event.predicate,
    object: event.object,
    category: factCategoryFor(event.eventType),
    layer: "dynamic",
    confidence: event.confidence,
    sourceType: "event",
    sourceId: event.id,
    sourceChapter: event.chapterNumber,
    evidenceText: event.evidenceText,
    validFromChapter: event.chapterNumber,
    createdAt: event.createdAt,
    updatedAt: now,
  };
}

function applyOne(
  storage: StorageDatabase,
  bookId: string,
  event: NarrativeEvent,
  seenTuples: Set<string>,
  options: ApplyNarrativeEventsOptions,
): { kind: "applied" | "pending" | "rejected" | "skipped"; id: string } {
  if (event.bookId !== bookId) {
    throw new Error(`event bookId ${event.bookId} does not match reducer bookId ${bookId}`);
  }
  if (event.status === "rejected") {
    updateNarrativeEventStatus(storage, { id: event.id, status: "rejected" });
    return { kind: "rejected", id: event.id };
  }
  if (shouldRemainPending(event)) {
    updateNarrativeEventStatus(storage, { id: event.id, status: "pending" });
    return { kind: "pending", id: event.id };
  }
  if (slotLockedByManualFact(storage, event)) {
    updateNarrativeEventStatus(storage, { id: event.id, status: "pending" });
    return { kind: "pending", id: event.id };
  }

  const key = tupleKey(event);
  const factId = factIdFor(event);
  if (seenTuples.has(key) || factExists(storage, factId)) {
    return { kind: "skipped", id: event.id };
  }

  const nextFact = eventToFact(event);
  if (options.closeSupersededFacts !== false) {
    closeSupersededNarrativeFacts(storage, nextFact, event.chapterNumber);
  }
  upsertNarrativeFact(storage, nextFact);
  updateNarrativeEventStatus(storage, { id: event.id, status: "applied" });
  seenTuples.add(key);
  return { kind: "applied", id: event.id };
}

export function applyNarrativeEvents(
  storage: StorageDatabase,
  bookId: string,
  events: readonly NarrativeEvent[],
  options: ApplyNarrativeEventsOptions = {},
): ApplyNarrativeEventsResult {
  const appliedEventIds: string[] = [];
  const pendingEventIds: string[] = [];
  const rejectedEventIds: string[] = [];
  const skippedEventIds: string[] = [];
  const failedEvents: { id: string; error: string }[] = [];
  const seenTuples = new Set<string>();

  for (const event of events) {
    try {
      const result = applyOne(storage, bookId, event, seenTuples, options);
      if (result.kind === "applied") appliedEventIds.push(result.id);
      else if (result.kind === "pending") pendingEventIds.push(result.id);
      else if (result.kind === "rejected") rejectedEventIds.push(result.id);
      else skippedEventIds.push(result.id);
    } catch (error) {
      failedEvents.push({ id: event.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { appliedEventIds, pendingEventIds, rejectedEventIds, skippedEventIds, failedEvents };
}
