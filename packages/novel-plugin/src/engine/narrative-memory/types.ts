import { z } from "zod";

export const NarrativeContextSourceTypeSchema = z.enum([
  "jingwei",
  "fact",
  "outline",
  "chapter-summary",
  "runtime-state",
  "hook",
  "style",
  "scene-spec",
]);
export type NarrativeContextSourceType = z.infer<typeof NarrativeContextSourceTypeSchema>;

export const NarrativeContextChannelSchema = z.enum([
  "hard",
  "state",
  "timeline",
  "relationship",
  "hooks",
  "facts",
  "style",
  "semantic",
]);
export type NarrativeContextChannel = z.infer<typeof NarrativeContextChannelSchema>;

export const NarrativeRetrievalPurposeSchema = z.enum([
  "write_chapter",
  "continue",
  "revise",
  "audit",
  "outline",
]);
export type NarrativeRetrievalPurpose = z.infer<typeof NarrativeRetrievalPurposeSchema>;

export const NarrativeEventStatusSchema = z.enum(["pending", "applied", "rejected"]);
export type NarrativeEventStatus = z.infer<typeof NarrativeEventStatusSchema>;

export const NarrativeEventRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type NarrativeEventRiskLevel = z.infer<typeof NarrativeEventRiskLevelSchema>;

export const NarrativeFactLayerSchema = z.enum(["canon", "dynamic", "reference"]);
export type NarrativeFactLayer = z.infer<typeof NarrativeFactLayerSchema>;

export const NarrativeFactSourceTypeSchema = z.enum(["jingwei", "runtime-state", "event", "manual", "import"]);
export type NarrativeFactSourceType = z.infer<typeof NarrativeFactSourceTypeSchema>;

export const NarrativeEventTypeSchema = z.enum([
  "character_state_changed",
  "relationship_changed",
  "location_changed",
  "hook_planted",
  "hook_progressed",
  "hook_resolved",
  "world_fact_introduced",
  "timeline_advanced",
]);
export type NarrativeEventType = z.infer<typeof NarrativeEventTypeSchema>;

const nonEmptyString = z.string().trim().min(1);
const nonNegativeInteger = z.number().int().min(0);
const positiveInteger = z.number().int().min(1);
const nonNegativeNumber = z.number().min(0);
const confidenceScore = z.number().min(0).max(1);

export const NarrativeContextCardSchema = z.object({
  id: nonEmptyString,
  bookId: nonEmptyString,
  sourceType: NarrativeContextSourceTypeSchema,
  sourceId: nonEmptyString,
  channel: NarrativeContextChannelSchema,
  title: nonEmptyString,
  content: z.string(),
  normal: z.string().optional(),
  summary: z.string().optional(),
  brief: nonEmptyString,
  tags: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  priority: z.number(),
  importance: nonNegativeNumber,
  accessCount: nonNegativeInteger,
  lastAccessedAt: z.string().optional(),
  validFromChapter: nonNegativeInteger.optional(),
  validUntilChapter: nonNegativeInteger.optional(),
  reason: nonEmptyString,
  estimatedTokens: nonNegativeInteger,
  score: z.number().optional(),
  scoreBreakdown: z.record(z.string(), z.number()).optional(),
});
export type NarrativeContextCard = Readonly<{
  id: string;
  bookId: string;
  sourceType: NarrativeContextSourceType;
  sourceId: string;
  channel: NarrativeContextChannel;
  title: string;
  content: string;
  normal?: string;
  summary?: string;
  brief: string;
  tags: readonly string[];
  entities: readonly string[];
  priority: number;
  importance: number;
  accessCount: number;
  lastAccessedAt?: string;
  validFromChapter?: number;
  validUntilChapter?: number;
  reason: string;
  estimatedTokens: number;
  score?: number;
  scoreBreakdown?: Readonly<Record<string, number>>;
}>;

export const NarrativeFactSchema = z.object({
  id: nonEmptyString,
  bookId: nonEmptyString,
  subject: nonEmptyString,
  predicate: nonEmptyString,
  object: nonEmptyString,
  category: nonEmptyString,
  layer: NarrativeFactLayerSchema,
  confidence: confidenceScore,
  sourceType: NarrativeFactSourceTypeSchema,
  sourceId: z.string().optional(),
  sourceChapter: positiveInteger.optional(),
  evidenceText: z.string().optional(),
  validFromChapter: nonNegativeInteger.optional(),
  validUntilChapter: nonNegativeInteger.optional(),
  createdAt: nonEmptyString,
  updatedAt: nonEmptyString,
});
export type NarrativeFact = Readonly<{
  id: string;
  bookId: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer: NarrativeFactLayer;
  confidence: number;
  sourceType: NarrativeFactSourceType;
  sourceId?: string;
  sourceChapter?: number;
  evidenceText?: string;
  validFromChapter?: number;
  validUntilChapter?: number;
  createdAt: string;
  updatedAt: string;
}>;

export const NarrativeEventSchema = z.object({
  id: nonEmptyString,
  bookId: nonEmptyString,
  chapterNumber: positiveInteger,
  eventType: NarrativeEventTypeSchema,
  subject: nonEmptyString,
  predicate: nonEmptyString,
  object: nonEmptyString,
  evidenceText: nonEmptyString,
  confidence: confidenceScore,
  source: z.enum(["settle", "manual", "import"]),
  status: NarrativeEventStatusSchema,
  riskLevel: NarrativeEventRiskLevelSchema,
  createdAt: nonEmptyString,
  appliedAt: z.string().optional(),
});
export type NarrativeEvent = Readonly<{
  id: string;
  bookId: string;
  chapterNumber: number;
  eventType: NarrativeEventType;
  subject: string;
  predicate: string;
  object: string;
  evidenceText: string;
  confidence: number;
  source: "settle" | "manual" | "import";
  status: NarrativeEventStatus;
  riskLevel: NarrativeEventRiskLevel;
  createdAt: string;
  appliedAt?: string;
}>;

export const NarrativeChannelStatusSchema = z.enum(["ok", "skipped", "timeout", "error"]);
export type NarrativeChannelStatus = z.infer<typeof NarrativeChannelStatusSchema>;

export const SemanticChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxCandidates: positiveInteger.max(500).default(80),
  topK: positiveInteger.max(50).default(8),
  minSimilarity: z.number().min(-1).max(1).default(0.72),
});
export type SemanticChannelConfig = Readonly<{
  enabled: boolean;
  maxCandidates: number;
  topK: number;
  minSimilarity: number;
}>;

export const NarrativeContextVectorSchema = z.object({
  cardId: nonEmptyString,
  bookId: nonEmptyString,
  embeddingModelId: nonEmptyString,
  embeddingDim: positiveInteger,
  vector: z.array(z.number()),
  vectorUpdatedAt: nonEmptyString,
  sourceCard: NarrativeContextCardSchema,
});
export type NarrativeContextVector = Readonly<{
  cardId: string;
  bookId: string;
  embeddingModelId: string;
  embeddingDim: number;
  vector: readonly number[];
  vectorUpdatedAt: string;
  sourceCard: NarrativeContextCard;
}>;

export const NarrativeChannelStatSchema = z.object({
  channel: z.string(),
  status: NarrativeChannelStatusSchema,
  latencyMs: nonNegativeNumber,
  candidateCount: nonNegativeInteger,
  returnedCount: nonNegativeInteger,
  estimatedTokens: nonNegativeInteger,
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type NarrativeChannelStat = Readonly<{
  channel: string;
  status: NarrativeChannelStatus;
  latencyMs: number;
  candidateCount: number;
  returnedCount: number;
  estimatedTokens: number;
  error?: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export const WaveMemoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  spikeRoutingEnabled: z.boolean().default(true),
  geodesicRerankEnabled: z.boolean().default(true),
  rerankAlpha: z.number().min(0).max(2).default(0.25),
});
export type WaveMemoryConfig = Readonly<{
  enabled: boolean;
  spikeRoutingEnabled: boolean;
  geodesicRerankEnabled: boolean;
  rerankAlpha: number;
}>;

export const WaveMemoryDiagnosticsSchema = z.object({
  activatedTags: z.array(z.string()).default([]),
  rerankAlpha: z.number(),
  fallbackLevel: z.string(),
});
export type WaveMemoryDiagnostics = Readonly<{
  activatedTags: readonly string[];
  rerankAlpha: number;
  fallbackLevel: string;
}>;

export const NarrativeRetrievalDiagnosticsSchema = z.object({
  totalMs: nonNegativeNumber,
  totalEstimatedTokens: nonNegativeInteger,
  channelStats: z.array(NarrativeChannelStatSchema).default([]),
  injectedTokensByChannel: z.record(z.string(), nonNegativeInteger).default({}),
  droppedCardIds: z.array(z.string()).default([]),
  degradedCards: z.array(z.object({ id: nonEmptyString, from: nonEmptyString, to: nonEmptyString })).default([]),
  warnings: z.array(z.string()).default([]),
  wave: WaveMemoryDiagnosticsSchema.optional(),
});
export type NarrativeRetrievalDiagnostics = Readonly<{
  totalMs: number;
  totalEstimatedTokens: number;
  channelStats: readonly NarrativeChannelStat[];
  injectedTokensByChannel: Readonly<Record<string, number>>;
  droppedCardIds: readonly string[];
  degradedCards: readonly Readonly<{ id: string; from: string; to: string }>[];
  warnings: readonly string[];
  wave?: WaveMemoryDiagnostics;
}>;

export const BuildNarrativeContextInputSchema = z.object({
  bookId: nonEmptyString,
  purpose: NarrativeRetrievalPurposeSchema,
  chapterNumber: positiveInteger.optional(),
  sceneSpec: z.unknown().optional(),
  sceneText: z.string().optional(),
  entities: z.array(z.string()).default([]),
  maxTokens: positiveInteger.optional(),
});
export type BuildNarrativeContextInput = Readonly<{
  bookId: string;
  purpose: NarrativeRetrievalPurpose;
  chapterNumber?: number;
  sceneSpec?: unknown;
  sceneText?: string;
  entities: readonly string[];
  maxTokens?: number;
}>;

export const NarrativeContextPackageSchema = z.object({
  bookId: nonEmptyString,
  chapterNumber: positiveInteger.optional(),
  purpose: NarrativeRetrievalPurposeSchema,
  cards: z.array(NarrativeContextCardSchema).default([]),
  sections: z.object({
    hard: z.string().default(""),
    state: z.string().default(""),
    timeline: z.string().default(""),
    hooks: z.string().default(""),
    facts: z.string().default(""),
    style: z.string().default(""),
    semantic: z.string().default(""),
  }),
  diagnostics: NarrativeRetrievalDiagnosticsSchema,
});
export type NarrativeContextPackage = Readonly<{
  bookId: string;
  chapterNumber?: number;
  purpose: NarrativeRetrievalPurpose;
  cards: readonly NarrativeContextCard[];
  sections: Readonly<{
    hard: string;
    state: string;
    timeline: string;
    hooks: string;
    facts: string;
    style: string;
    semantic: string;
  }>;
  diagnostics: NarrativeRetrievalDiagnostics;
}>;
