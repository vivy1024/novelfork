import type {
  ChapterStateDelta,
  CharacterStateUpdate,
  CommitmentDelta,
  HookDelta,
  RelationshipDelta,
} from "../models/chapter-state-delta.js";
import type {
  ChapterSummaryRow,
  HookPayoffTiming,
  HookStatus,
  KnowledgeEvent,
  ResourceLedgerEntry,
  TimelineEntry,
} from "../models/runtime-state.js";
import type { ChapterStateDeltaRecord } from "./chapter-state-commit.js";
import {
  getBookStateRevision,
  listChapterStateDeltas,
} from "./chapter-state-commit.js";
import type { StorageDatabase } from "../storage/index.js";

export interface DerivedCharacterBeat {
  readonly chapter: number;
  readonly state?: string;
  readonly goal?: string;
  readonly emotionalState?: string;
  readonly arcProgress?: string;
}

export interface DerivedCharacterState {
  readonly characterId: string;
  readonly name?: string;
  readonly currentState?: string;
  readonly currentGoal?: string;
  readonly emotionalState?: string;
  readonly arcProgress?: string;
  readonly knowledge: readonly string[];
  readonly lastChapter: number;
  readonly firstChapter: number;
  readonly beats: readonly DerivedCharacterBeat[];
}

export interface DerivedRelationship {
  readonly source: string;
  readonly target: string;
  readonly relationType: string;
  readonly sentiment: "friendly" | "hostile" | "neutral" | "complicated";
  readonly status: "active" | "broken" | "evolving" | "dormant";
  readonly turningPoint?: string;
  readonly description: string;
  readonly lastChapter: number;
  readonly firstChapter: number;
}

export interface DerivedHook {
  readonly hookId: string;
  readonly type: string;
  readonly status: HookStatus;
  readonly expectedPayoff: string;
  readonly payoffTiming?: HookPayoffTiming;
  readonly notes: string;
  readonly startChapter: number;
  readonly lastAdvancedChapter: number;
  readonly volume?: number;
}

export interface DerivedCommitment {
  readonly id: string;
  readonly text: string;
  readonly targetChapter?: number;
  readonly scope: CommitmentDelta["scope"];
  readonly fulfilled: boolean;
  readonly sourceChapter: number;
}

export interface ChapterStateProjection {
  readonly lastChapter: number;
  readonly stateRevision: number;
  readonly characters: readonly DerivedCharacterState[];
  readonly relationships: readonly DerivedRelationship[];
  readonly hooks: readonly DerivedHook[];
  readonly timeline: readonly TimelineEntry[];
  readonly commitments: readonly DerivedCommitment[];
  readonly summaries: readonly ChapterSummaryRow[];
  readonly resources: readonly ResourceLedgerEntry[];
  readonly knowledge: readonly KnowledgeEvent[];
}

export function emptyChapterStateProjection(
  overrides: Partial<ChapterStateProjection> = {},
): ChapterStateProjection {
  return {
    lastChapter: 0,
    stateRevision: 0,
    characters: [],
    relationships: [],
    hooks: [],
    timeline: [],
    commitments: [],
    summaries: [],
    resources: [],
    knowledge: [],
    ...overrides,
  };
}

/**
 * 将按提交顺序排列的 ChapterStateDelta 归约为当前剧情事实。
 * 纯函数：不读库、不写库。手工备注不属于这里。
 */
export function reduceChapterStateDeltas(
  deltas: readonly ChapterStateDelta[],
  options: { readonly stateRevision?: number } = {},
): ChapterStateProjection {
  const characters = new Map<string, MutableCharacter>();
  const relationships = new Map<string, MutableRelationship>();
  const hooks = new Map<string, MutableHook>();
  const timeline = new Map<number, TimelineEntry>();
  const commitments = new Map<string, DerivedCommitment>();
  const summaries = new Map<number, ChapterSummaryRow>();
  const resources = new Map<string, ResourceLedgerEntry>();
  const knowledge = new Map<string, KnowledgeEvent>();
  let lastChapter = 0;

  for (const delta of deltas) {
    lastChapter = Math.max(lastChapter, delta.chapterNumber);
    for (const character of delta.characters) {
      applyCharacter(characters, character, delta.chapterNumber);
    }
    for (const relationship of delta.relationships) {
      applyRelationship(relationships, relationship, delta.chapterNumber);
    }
    for (const hook of delta.hooks) {
      applyHook(hooks, hook, delta.chapterNumber);
    }
    if (delta.timeline) {
      const chapter = delta.timeline.chapter || delta.chapterNumber;
      timeline.set(chapter, { ...delta.timeline, chapter });
    }
    for (const commitment of delta.commitments) {
      const id = commitment.id?.trim() || `commitment:${commitment.text}`;
      const existing = commitments.get(id);
      commitments.set(id, {
        id,
        text: commitment.text,
        ...(typeof commitment.targetChapter === "number" ? { targetChapter: commitment.targetChapter } : {}),
        scope: commitment.scope,
        fulfilled: commitment.fulfilled,
        sourceChapter: existing?.sourceChapter ?? delta.chapterNumber,
      });
    }
    if (delta.summary) {
      summaries.set(delta.summary.chapter, delta.summary);
    }
    for (const op of delta.resources) {
      applyResource(resources, op, delta.chapterNumber);
    }
    for (const event of delta.knowledge) {
      const key = `${event.characterId}::${event.fact}`.toLowerCase();
      const existing = knowledge.get(key);
      if (!existing || event.learnedAtChapter < existing.learnedAtChapter) {
        knowledge.set(key, event);
      }
    }
  }

  return {
    lastChapter,
    stateRevision: options.stateRevision ?? 0,
    characters: [...characters.values()]
      .map(freezeCharacter)
      .sort((left, right) => left.characterId.localeCompare(right.characterId)),
    relationships: [...relationships.values()]
      .map(freezeRelationship)
      .sort((left, right) => (
        left.source.localeCompare(right.source)
        || left.target.localeCompare(right.target)
        || left.relationType.localeCompare(right.relationType)
      )),
    hooks: [...hooks.values()]
      .map(freezeHook)
      .sort((left, right) => (
        left.startChapter - right.startChapter
        || left.lastAdvancedChapter - right.lastAdvancedChapter
        || left.hookId.localeCompare(right.hookId)
      )),
    timeline: [...timeline.values()].sort((left, right) => left.chapter - right.chapter),
    commitments: [...commitments.values()].sort((left, right) => (
      left.sourceChapter - right.sourceChapter || left.id.localeCompare(right.id)
    )),
    summaries: [...summaries.values()].sort((left, right) => left.chapter - right.chapter),
    resources: [...resources.values()].sort((left, right) => left.resourceId.localeCompare(right.resourceId)),
    knowledge: [...knowledge.values()].sort((left, right) => (
      left.learnedAtChapter - right.learnedAtChapter
      || left.characterId.localeCompare(right.characterId)
    )),
  };
}

export function reduceChapterStateRecords(
  records: readonly ChapterStateDeltaRecord[],
  options: { readonly stateRevision?: number } = {},
): ChapterStateProjection {
  const lastRevision = records.length > 0 ? records[records.length - 1]!.resultingRevision : 0;
  return reduceChapterStateDeltas(records.map((record) => record.delta), {
    stateRevision: options.stateRevision ?? lastRevision,
  });
}

export function loadChapterStateProjection(
  storage: StorageDatabase,
  bookId: string,
): ChapterStateProjection {
  const records = listChapterStateDeltas(storage, bookId);
  return reduceChapterStateRecords(records, {
    stateRevision: getBookStateRevision(storage, bookId),
  });
}

interface MutableCharacter {
  characterId: string;
  name?: string;
  currentState?: string;
  currentGoal?: string;
  emotionalState?: string;
  arcProgress?: string;
  knowledge: Set<string>;
  lastChapter: number;
  firstChapter: number;
  beats: DerivedCharacterBeat[];
}

interface MutableRelationship {
  source: string;
  target: string;
  relationType: string;
  sentiment: DerivedRelationship["sentiment"];
  status: DerivedRelationship["status"];
  turningPoint?: string;
  description: string;
  lastChapter: number;
  firstChapter: number;
}

interface MutableHook {
  hookId: string;
  type: string;
  status: HookStatus;
  expectedPayoff: string;
  payoffTiming?: HookPayoffTiming;
  notes: string;
  startChapter: number;
  lastAdvancedChapter: number;
  volume?: number;
}

function applyCharacter(
  characters: Map<string, MutableCharacter>,
  update: CharacterStateUpdate,
  chapter: number,
): void {
  const existing = characters.get(update.characterId);
  const beat: DerivedCharacterBeat = {
    chapter,
    ...(update.currentState ? { state: update.currentState } : {}),
    ...(update.currentGoal ? { goal: update.currentGoal } : {}),
    ...(update.emotionalState ? { emotionalState: update.emotionalState } : {}),
    ...(update.arcProgress ? { arcProgress: update.arcProgress } : {}),
  };
  if (!existing) {
    characters.set(update.characterId, {
      characterId: update.characterId,
      ...(update.name ? { name: update.name } : {}),
      ...(update.currentState ? { currentState: update.currentState } : {}),
      ...(update.currentGoal ? { currentGoal: update.currentGoal } : {}),
      ...(update.emotionalState ? { emotionalState: update.emotionalState } : {}),
      ...(update.arcProgress ? { arcProgress: update.arcProgress } : {}),
      knowledge: new Set(update.knowledge),
      lastChapter: chapter,
      firstChapter: chapter,
      beats: [beat],
    });
    return;
  }
  existing.lastChapter = chapter;
  existing.beats.push(beat);
  if (update.name) existing.name = update.name;
  if (update.currentState) existing.currentState = update.currentState;
  if (update.currentGoal) existing.currentGoal = update.currentGoal;
  if (update.emotionalState) existing.emotionalState = update.emotionalState;
  if (update.arcProgress) existing.arcProgress = update.arcProgress;
  for (const fact of update.knowledge) existing.knowledge.add(fact);
}

function applyRelationship(
  relationships: Map<string, MutableRelationship>,
  update: RelationshipDelta,
  chapter: number,
): void {
  const key = `${update.source}\u0000${update.target}\u0000${update.relationType}`;
  const existing = relationships.get(key);
  if (!existing) {
    relationships.set(key, {
      source: update.source,
      target: update.target,
      relationType: update.relationType,
      sentiment: update.sentiment,
      status: update.status,
      ...(update.turningPoint ? { turningPoint: update.turningPoint } : {}),
      description: update.description,
      lastChapter: chapter,
      firstChapter: chapter,
    });
    return;
  }
  existing.sentiment = update.sentiment;
  existing.status = update.status;
  existing.description = preferRicherText(existing.description, update.description);
  if (update.turningPoint) existing.turningPoint = update.turningPoint;
  existing.lastChapter = chapter;
}

function applyHook(hooks: Map<string, MutableHook>, update: HookDelta, chapter: number): void {
  const existing = hooks.get(update.hookId);
  if (update.action === "upsert" || !existing) {
    const status = update.action === "resolve"
      ? "resolved"
      : update.action === "defer"
        ? "deferred"
        : update.action === "mention"
          ? (update.status === "open" ? "progressing" : update.status)
          : update.status;
    hooks.set(update.hookId, {
      hookId: update.hookId,
      type: update.type,
      status,
      expectedPayoff: update.expectedPayoff,
      ...(update.payoffTiming ? { payoffTiming: update.payoffTiming } : {}),
      notes: update.notes,
      startChapter: existing?.startChapter ?? chapter,
      lastAdvancedChapter: Math.max(existing?.lastAdvancedChapter ?? 0, chapter),
      ...(typeof update.volume === "number" ? { volume: update.volume } : existing?.volume ? { volume: existing.volume } : {}),
    });
    return;
  }

  existing.lastAdvancedChapter = Math.max(existing.lastAdvancedChapter, chapter);
  existing.type = preferRicherText(existing.type, update.type);
  existing.expectedPayoff = preferRicherText(existing.expectedPayoff, update.expectedPayoff);
  existing.notes = preferRicherText(existing.notes, update.notes);
  if (update.payoffTiming) existing.payoffTiming = update.payoffTiming;
  if (typeof update.volume === "number") existing.volume = update.volume;

  if (update.action === "resolve") {
    existing.status = "resolved";
    return;
  }
  if (update.action === "defer") {
    if (existing.status !== "resolved") existing.status = "deferred";
    return;
  }
  if (existing.status !== "resolved") {
    existing.status = "progressing";
  }
}

function applyResource(
  resources: Map<string, ResourceLedgerEntry>,
  op: ChapterStateDelta["resources"][number],
  chapter: number,
): void {
  const existing = resources.get(op.resourceId);
  const oldBalance = existing?.balance ?? 0;
  const computedBalance = oldBalance + op.delta;
  const historyEntry = { chapter, delta: op.delta, reason: op.reason };
  resources.set(op.resourceId, existing
    ? {
      ...existing,
      name: op.name ?? existing.name,
      balance: computedBalance,
      lastChapter: chapter,
      history: [...existing.history, historyEntry],
    }
    : {
      resourceId: op.resourceId,
      name: op.name ?? "",
      balance: computedBalance,
      lastChapter: chapter,
      history: [historyEntry],
    });
}

function freezeCharacter(character: MutableCharacter): DerivedCharacterState {
  return {
    characterId: character.characterId,
    ...(character.name ? { name: character.name } : {}),
    ...(character.currentState ? { currentState: character.currentState } : {}),
    ...(character.currentGoal ? { currentGoal: character.currentGoal } : {}),
    ...(character.emotionalState ? { emotionalState: character.emotionalState } : {}),
    ...(character.arcProgress ? { arcProgress: character.arcProgress } : {}),
    knowledge: [...character.knowledge],
    lastChapter: character.lastChapter,
    firstChapter: character.firstChapter,
    beats: character.beats,
  };
}

function freezeRelationship(relationship: MutableRelationship): DerivedRelationship {
  return {
    source: relationship.source,
    target: relationship.target,
    relationType: relationship.relationType,
    sentiment: relationship.sentiment,
    status: relationship.status,
    ...(relationship.turningPoint ? { turningPoint: relationship.turningPoint } : {}),
    description: relationship.description,
    lastChapter: relationship.lastChapter,
    firstChapter: relationship.firstChapter,
  };
}

function freezeHook(hook: MutableHook): DerivedHook {
  return {
    hookId: hook.hookId,
    type: hook.type,
    status: hook.status,
    expectedPayoff: hook.expectedPayoff,
    ...(hook.payoffTiming ? { payoffTiming: hook.payoffTiming } : {}),
    notes: hook.notes,
    startChapter: hook.startChapter,
    lastAdvancedChapter: hook.lastAdvancedChapter,
    ...(typeof hook.volume === "number" ? { volume: hook.volume } : {}),
  };
}

function preferRicherText(primary: string | undefined, fallback: string | undefined): string {
  const left = (primary ?? "").trim();
  const right = (fallback ?? "").trim();
  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  return right.length > left.length ? right : left;
}
