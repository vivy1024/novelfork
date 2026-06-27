import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { NarrativeBudgetResult, PackedNarrativeContextCard } from "./budget.js";
import type { ChannelResult } from "./channels.js";
import { insertRetrievalLog, type NarrativeRetrievalLogRecord } from "./storage.js";
import {
  NarrativeContextPackageSchema,
  NarrativeRetrievalDiagnosticsSchema,
  type NarrativeContextPackage,
  type NarrativeRetrievalDiagnostics,
  type NarrativeRetrievalPurpose,
  type WaveMemoryDiagnostics,
} from "./types.js";

const SECTION_BY_CHANNEL = {
  hard: { key: "hard", tag: "hard_constraints" },
  state: { key: "state", tag: "narrative_state" },
  relationship: { key: "state", tag: "narrative_state" },
  timeline: { key: "timeline", tag: "timeline_context" },
  hooks: { key: "hooks", tag: "active_hooks" },
  facts: { key: "facts", tag: "known_facts" },
  style: { key: "style", tag: "style_rules" },
  semantic: { key: "semantic", tag: "semantic_memory" },
} as const;

const SECTION_ORDER = ["hard", "state", "timeline", "hooks", "facts", "style", "semantic"] as const;

type SectionKey = keyof NarrativeContextPackage["sections"];

export type NarrativeSections = NarrativeContextPackage["sections"];

export type BuildNarrativeRetrievalDiagnosticsInput = Readonly<{
  startedAt: number;
  endedAt?: number;
  channelResults: readonly ChannelResult[];
  budget: NarrativeBudgetResult;
  warnings?: readonly string[];
  wave?: WaveMemoryDiagnostics;
}>;

export type PersistNarrativeRetrievalLogInput = Readonly<{
  id: string;
  bookId: string;
  chapterNumber?: number;
  purpose: NarrativeRetrievalPurpose;
  diagnostics: NarrativeRetrievalDiagnostics;
  createdAt?: string;
}>;

function normalizeMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatCard(item: PackedNarrativeContextCard): string {
  const source = `${item.card.sourceType}:${item.card.sourceId}`;
  const header = `- [${source}] ${item.card.title}: ${item.content}`;
  const meta = [
    `  reason: ${item.card.reason}`,
    `  level: ${item.detailLevel}; tokens: ${item.estimatedTokens}`,
  ];
  return [header, ...meta].join("\n");
}

function wrapSection(tag: string, items: readonly PackedNarrativeContextCard[]): string {
  const body = items.length > 0 ? items.map(formatCard).join("\n") : "";
  return [`<${tag}>`, body, `</${tag}>`].join("\n");
}

export function formatNarrativeSections(cards: readonly PackedNarrativeContextCard[]): NarrativeSections {
  const buckets: Record<SectionKey, PackedNarrativeContextCard[]> = {
    hard: [],
    state: [],
    timeline: [],
    hooks: [],
    facts: [],
    style: [],
    semantic: [],
  };

  for (const item of cards) {
    const section = SECTION_BY_CHANNEL[item.card.channel];
    buckets[section.key].push(item);
  }

  const sections = Object.fromEntries(SECTION_ORDER.map((key) => {
    const firstChannel = Object.values(SECTION_BY_CHANNEL).find((section) => section.key === key);
    return [key, wrapSection(firstChannel?.tag ?? key, buckets[key])];
  })) as NarrativeSections;

  return NarrativeContextPackageSchema.shape.sections.parse(sections);
}

export function buildNarrativeRetrievalDiagnostics(input: BuildNarrativeRetrievalDiagnosticsInput): NarrativeRetrievalDiagnostics {
  const endedAt = input.endedAt ?? performance.now();
  const channelWarnings = input.channelResults.flatMap((result) => result.warnings);
  const errors = input.channelResults.flatMap((result) => result.error ? [`${result.channel}: ${result.error}`] : []);
  const diagnostics = {
    totalMs: normalizeMs(endedAt - input.startedAt),
    totalEstimatedTokens: input.budget.totalEstimatedTokens,
    channelStats: input.channelResults.map((result) => ({
      channel: result.channel,
      status: result.status,
      latencyMs: normalizeMs(result.latencyMs),
      candidateCount: result.candidateCount,
      returnedCount: result.returnedCount,
      estimatedTokens: result.estimatedTokens,
      error: result.error,
      metadata: result.diagnostics,
    })),
    injectedTokensByChannel: input.budget.injectedTokensByChannel,
    droppedCardIds: input.budget.droppedCards.map((card) => card.id),
    degradedCards: input.budget.degradedCards,
    warnings: uniqueStrings([...channelWarnings, ...input.budget.warnings, ...errors, ...(input.warnings ?? [])]),
    wave: input.wave,
  };
  return NarrativeRetrievalDiagnosticsSchema.parse(diagnostics);
}

export function persistNarrativeRetrievalLog(storage: StorageDatabase, input: PersistNarrativeRetrievalLogInput): NarrativeRetrievalLogRecord {
  return insertRetrievalLog(storage, {
    id: input.id,
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    purpose: input.purpose,
    totalTokens: input.diagnostics.totalEstimatedTokens,
    diagnostics: input.diagnostics,
    createdAt: input.createdAt,
  });
}
