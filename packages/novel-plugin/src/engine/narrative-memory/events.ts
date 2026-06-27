import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { insertNarrativeEvent } from "./storage.js";
import { NarrativeEventSchema, type NarrativeEvent, type NarrativeEventRiskLevel, type NarrativeEventStatus, type NarrativeEventType, type NarrativeFactLayer } from "./types.js";

export type NarrativeEventRiskInput = Readonly<{
  eventType: NarrativeEventType;
  layer?: NarrativeFactLayer;
  confidence: number;
}>;

export type NarrativeEventRiskDecision = Readonly<{
  riskLevel: NarrativeEventRiskLevel;
  status: NarrativeEventStatus;
}>;

export type CreateNarrativeEventInput = Readonly<{
  id?: string;
  bookId: string;
  chapterNumber: number;
  eventType: NarrativeEventType;
  subject: string;
  predicate: string;
  object: string;
  evidenceText: string;
  confidence: number;
  layer?: NarrativeFactLayer;
  source: NarrativeEvent["source"];
  now?: Date;
}>;

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(1, Math.max(0, confidence));
}

function idPart(value: string): string {
  return value.trim().replace(/\s+/gu, "-").replace(/[^\p{L}\p{N}_:-]+/gu, "").slice(0, 48) || "event";
}

function defaultEventId(input: CreateNarrativeEventInput): string {
  return [
    input.bookId,
    String(input.chapterNumber),
    input.eventType,
    idPart(input.subject),
    idPart(input.predicate),
    idPart(input.object),
  ].join(":");
}

export function classifyNarrativeEventRisk(input: NarrativeEventRiskInput): NarrativeEventRiskDecision {
  const confidence = clampConfidence(input.confidence);
  if (input.layer === "canon" || input.eventType === "world_fact_introduced") {
    return { riskLevel: "high", status: "pending" };
  }
  if (input.eventType === "relationship_changed") {
    return { riskLevel: "high", status: "pending" };
  }
  if (confidence < 0.6) {
    return { riskLevel: "medium", status: "pending" };
  }
  if (input.eventType === "hook_resolved" || input.eventType === "character_state_changed") {
    return { riskLevel: "medium", status: confidence >= 0.75 ? "applied" : "pending" };
  }
  if (input.eventType === "location_changed" || input.eventType === "hook_progressed" || input.eventType === "timeline_advanced" || input.eventType === "hook_planted") {
    return { riskLevel: "low", status: "applied" };
  }
  return { riskLevel: "medium", status: "pending" };
}

export function createNarrativeEvent(input: CreateNarrativeEventInput): NarrativeEvent {
  const confidence = clampConfidence(input.confidence);
  const decision = classifyNarrativeEventRisk({ eventType: input.eventType, layer: input.layer, confidence });
  const createdAt = (input.now ?? new Date()).toISOString();
  return NarrativeEventSchema.parse({
    id: input.id ?? defaultEventId(input),
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    eventType: input.eventType,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText,
    confidence,
    source: input.source,
    status: decision.status,
    riskLevel: decision.riskLevel,
    createdAt,
    appliedAt: decision.status === "applied" ? createdAt : undefined,
  });
}

export function persistNarrativeEvents(storage: StorageDatabase, events: readonly NarrativeEvent[]): NarrativeEvent[] {
  return events.map((event) => insertNarrativeEvent(storage, event));
}
