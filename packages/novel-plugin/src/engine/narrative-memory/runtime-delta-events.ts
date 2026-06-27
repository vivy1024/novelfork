import { RuntimeStateDeltaSchema, type RuntimeStateDelta } from "@vivy1024/novelfork-core";

import { createNarrativeEvent } from "./events.js";
import type { NarrativeEvent, NarrativeEventType, NarrativeFactLayer } from "./types.js";

export type RuntimeDeltaToNarrativeEventsInput = Readonly<{
  bookId: string;
  delta: RuntimeStateDelta;
  evidenceText: string;
  now?: Date;
}>;

type EventDraft = Readonly<{
  eventType: NarrativeEventType;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  layer?: NarrativeFactLayer;
}>;

function idPart(value: string): string {
  return value.trim().replace(/\s+/gu, "-").replace(/[^\p{L}\p{N}_:-]+/gu, "").slice(0, 48) || "value";
}

function eventId(bookId: string, chapter: number, draft: EventDraft): string {
  return ["runtime-delta", bookId, String(chapter), draft.eventType, idPart(draft.subject), idPart(draft.predicate), idPart(draft.object)].join(":");
}

function pushIfValue(drafts: EventDraft[], eventType: NarrativeEventType, subject: string, predicate: string, object: string, options: { confidence?: number; layer?: NarrativeFactLayer } = {}): void {
  const normalizedObject = object.trim();
  if (!normalizedObject) return;
  drafts.push({ eventType, subject, predicate, object: normalizedObject, confidence: options.confidence, layer: options.layer });
}

function currentStateDrafts(delta: RuntimeStateDelta): EventDraft[] {
  const patch = delta.currentStatePatch;
  if (!patch) return [];
  const drafts: EventDraft[] = [];
  pushIfValue(drafts, "location_changed", "当前地点", "变为", patch.currentLocation ?? "", { confidence: 0.85 });
  pushIfValue(drafts, "character_state_changed", "主角", "状态", patch.protagonistState ?? "", { confidence: 0.82 });
  pushIfValue(drafts, "character_state_changed", "主角", "目标", patch.currentGoal ?? "", { confidence: 0.82 });
  pushIfValue(drafts, "character_state_changed", "当前局势", "约束", patch.currentConstraint ?? "", { confidence: 0.78 });
  pushIfValue(drafts, "relationship_changed", "当前同盟", "变化", patch.currentAlliances ?? "", { confidence: 0.75 });
  pushIfValue(drafts, "character_state_changed", "当前冲突", "变化", patch.currentConflict ?? "", { confidence: 0.78 });
  return drafts;
}

function hookDrafts(delta: RuntimeStateDelta): EventDraft[] {
  const drafts: EventDraft[] = [];
  for (const hook of delta.hookOps.upsert) {
    drafts.push({
      eventType: hook.status === "open" ? "hook_planted" : hook.status === "resolved" ? "hook_resolved" : "hook_progressed",
      subject: hook.hookId,
      predicate: hook.status,
      object: [hook.type, hook.expectedPayoff, hook.notes].filter(Boolean).join("；") || hook.hookId,
      confidence: 0.84,
    });
  }
  for (const hookId of delta.hookOps.mention) {
    drafts.push({ eventType: "hook_progressed", subject: hookId, predicate: "被提及", object: `第${delta.chapter}章提及`, confidence: 0.8 });
  }
  for (const hookId of delta.hookOps.resolve) {
    drafts.push({ eventType: "hook_resolved", subject: hookId, predicate: "已回收", object: `第${delta.chapter}章回收`, confidence: 0.86 });
  }
  for (const candidate of delta.newHookCandidates) {
    drafts.push({
      eventType: "hook_planted",
      subject: candidate.type,
      predicate: "新伏笔",
      object: [candidate.expectedPayoff, candidate.notes].filter(Boolean).join("；") || candidate.type,
      confidence: 0.76,
    });
  }
  return drafts;
}

function knowledgeDrafts(delta: RuntimeStateDelta): EventDraft[] {
  return delta.knowledgeOps.map((op) => ({
    eventType: "world_fact_introduced" as const,
    subject: op.characterId,
    predicate: "知道",
    object: op.fact,
    confidence: 0.82,
    layer: "canon" as const,
  }));
}

function resourceDrafts(delta: RuntimeStateDelta): EventDraft[] {
  return delta.resourceOps.map((op) => ({
    eventType: "character_state_changed" as const,
    subject: op.name?.trim() || op.resourceId,
    predicate: "资源变化",
    object: `${op.delta >= 0 ? "+" : ""}${op.delta}${op.reason ? `：${op.reason}` : ""}`,
    confidence: 0.8,
  }));
}

function timelineDrafts(delta: RuntimeStateDelta): EventDraft[] {
  if (!delta.timelineOp) return [];
  const entry = delta.timelineOp;
  return [{
    eventType: "timeline_advanced",
    subject: "时间线",
    predicate: entry.durationFromPrev ? `推进${entry.durationFromPrev}` : "推进",
    object: [entry.storyTime, entry.label].filter(Boolean).join("：") || `第${delta.chapter}章`,
    confidence: 0.88,
  }];
}

export function runtimeDeltaToNarrativeEvents(input: RuntimeDeltaToNarrativeEventsInput): NarrativeEvent[] {
  const delta = RuntimeStateDeltaSchema.parse(input.delta);
  const drafts = [
    ...currentStateDrafts(delta),
    ...hookDrafts(delta),
    ...knowledgeDrafts(delta),
    ...resourceDrafts(delta),
    ...timelineDrafts(delta),
  ];
  const seen = new Set<string>();
  const events: NarrativeEvent[] = [];
  for (const draft of drafts) {
    const key = `${draft.eventType}\u0000${draft.subject}\u0000${draft.predicate}\u0000${draft.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(createNarrativeEvent({
      id: eventId(input.bookId, delta.chapter, draft),
      bookId: input.bookId,
      chapterNumber: delta.chapter,
      eventType: draft.eventType,
      subject: draft.subject,
      predicate: draft.predicate,
      object: draft.object,
      evidenceText: input.evidenceText,
      confidence: draft.confidence ?? 0.8,
      layer: draft.layer ?? "dynamic",
      source: "settle",
      now: input.now,
    }));
  }
  return events;
}
