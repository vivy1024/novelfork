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
  "character-kernel",
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
  "character-kernel",
  "recent-summary",
  "knowledge",
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

export const NarrativeEventSourceSchema = z.enum(["settle", "manual", "import"]);
export type NarrativeEventSource = z.infer<typeof NarrativeEventSourceSchema>;

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
  "hook_triggered",
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
  /** 实体身份链：subject/object 命中经纬实体字典时回填的 story_jingwei_entry.id。 */
  subjectEntryId: z.string().optional(),
  objectEntryId: z.string().optional(),
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
  /** 实体身份链：subject/object 对应的经纬条目 id（命中字典时回填）。 */
  subjectEntryId?: string;
  objectEntryId?: string;
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
  source: NarrativeEventSourceSchema,
  status: NarrativeEventStatusSchema,
  riskLevel: NarrativeEventRiskLevelSchema,
  /** 实体身份链：subject/object 命中经纬实体字典时回填的 story_jingwei_entry.id。 */
  subjectEntryId: z.string().optional(),
  objectEntryId: z.string().optional(),
  /** 显式因果前驱（narrative_event.id）。空数组视为缺省。 */
  causedBy: z.array(nonEmptyString).optional(),
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
  source: NarrativeEventSource;
  status: NarrativeEventStatus;
  riskLevel: NarrativeEventRiskLevel;
  /** 实体身份链：subject/object 对应的经纬条目 id（命中字典时回填）。 */
  subjectEntryId?: string;
  objectEntryId?: string;
  /** 显式因果前驱事件 id；缺省表示本事件没有标注因果。 */
  causedBy?: readonly string[];
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

export const WriteProfileTrimReasonSchema = z.object({
  id: nonEmptyString,
  reason: nonEmptyString,
  channel: z.string().optional(),
  kind: z.enum(["count-cap", "token-budget", "aged", "degraded", "named-keep"]),
});

export const WriteProfileItemSchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  summary: z.string().default(""),
  chapter: z.number().optional(),
  named: z.boolean().optional(),
});

export const WriteProfileColumnSchema = z.object({
  key: nonEmptyString,
  title: nonEmptyString,
  items: z.array(WriteProfileItemSchema).default([]),
  candidateCount: nonNegativeInteger.default(0),
  trimmed: nonNegativeInteger.default(0),
  cap: z.number().int().min(0).optional(),
});

export const WriteProfileSchema = z.object({
  locationAndTime: WriteProfileColumnSchema,
  hardConstraints: WriteProfileColumnSchema,
  coreCharacters: WriteProfileColumnSchema,
  activeHooks: WriteProfileColumnSchema,
  recentSummaries: WriteProfileColumnSchema,
  nextCommitments: WriteProfileColumnSchema,
  continuityRisks: WriteProfileColumnSchema,
  caps: z.object({
    coreCharacters: z.number().int().min(0),
    activeHooks: z.number().int().min(0),
    recentSummaries: z.number().int().min(0),
  }),
  namedEntities: z.array(z.string()).default([]),
  trimReasons: z.array(WriteProfileTrimReasonSchema).default([]),
});

export const NarrativeRetrievalDiagnosticsSchema = z.object({
  totalMs: nonNegativeNumber,
  totalEstimatedTokens: nonNegativeInteger,
  channelStats: z.array(NarrativeChannelStatSchema).default([]),
  injectedTokensByChannel: z.record(z.string(), nonNegativeInteger).default({}),
  droppedCardIds: z.array(z.string()).default([]),
  degradedCards: z.array(z.object({ id: nonEmptyString, from: nonEmptyString, to: nonEmptyString })).default([]),
  warnings: z.array(z.string()).default([]),
  wave: WaveMemoryDiagnosticsSchema.optional(),
  trimReasons: z.array(WriteProfileTrimReasonSchema).default([]),
  writeProfile: WriteProfileSchema.optional(),
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
  trimReasons?: readonly Readonly<{
    id: string;
    reason: string;
    channel?: string;
    kind: "count-cap" | "token-budget" | "aged" | "degraded" | "named-keep";
  }>[];
  writeProfile?: unknown;
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
    "character-kernel": z.string().default(""),
    "recent-summary": z.string().default(""),
    knowledge: z.string().default(""),
  }),
  diagnostics: NarrativeRetrievalDiagnosticsSchema,
  writeProfile: WriteProfileSchema.optional(),
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
    "character-kernel": string;
    "recent-summary": string;
    knowledge: string;
  }>;
  diagnostics: NarrativeRetrievalDiagnostics;
  writeProfile?: unknown;
}>;

// ─── 角色内核（Character Kernel）─────────────────────────────────────

/**
 * 内核字段形态：UI 形态与校验只由 kind 决定，不存业务枚举——
 * 字段列表完全由作品级配置决定（见 CharacterKernelConfig.fields），
 * 书中想加「境界」「伤势」「婚约状态」等任意键只需在配置里加一行。
 */
export const KernelFieldKindSchema = z.enum(["short_text", "long_text", "list"]);
export type KernelFieldKind = z.infer<typeof KernelFieldKindSchema>;

export const KernelFieldSpecSchema = z.object({
  key: nonEmptyString,
  label: nonEmptyString,
  kind: KernelFieldKindSchema,
  /** true = 结算时由 LLM 生成；false = 仅作者手填 */
  llmExtract: z.boolean(),
  /** true = 写章时注入 prompt */
  injectOnWrite: z.boolean(),
  /** 注入优先级；预算不足时按此升序裁剪（值越小越先被删除） */
  injectPriority: z.number().int().min(0),
});
export type KernelFieldSpec = Readonly<z.infer<typeof KernelFieldSpecSchema>>;

export const CharacterKernelConfigSchema = z.object({
  /** 总开关；默认关闭（不改老书行为、不消耗 LLM 预算） */
  enabled: z.boolean(),
  /** 重算 prompt 覆盖；null = 用内置模板 */
  promptTemplate: z.string().nullable(),
  /** 写章注入预算（占总召回预算比例 0–0.5） */
  injectBudgetRatio: z.number().min(0).max(0.5),
  /** 每角色 stateSummary 类长字段截断上限（字）；0 = 不截断 */
  stateSummaryMaxChars: nonNegativeInteger,
  /** 触发结算重算的事件类型；空数组 = 任意事件类型都触发 */
  triggerEventTypes: z.array(z.string()),
  /** 字段定义；空数组 = 用内核代码内置默认 */
  fields: z.array(KernelFieldSpecSchema),
});
export type CharacterKernelConfig = Readonly<z.infer<typeof CharacterKernelConfigSchema>>;

export const DEFAULT_CHARACTER_KERNEL_CONFIG: CharacterKernelConfig = {
  enabled: false,
  promptTemplate: null,
  injectBudgetRatio: 0.1,
  stateSummaryMaxChars: 200,
  triggerEventTypes: [],
  fields: [],
};

/** 内置默认字段集（配置 fields=[] 时生效；都可以被配置覆盖）。 */
export const DEFAULT_KERNEL_FIELDS: readonly KernelFieldSpec[] = [
  { key: "motivation", label: "核心动机", kind: "short_text", llmExtract: true, injectOnWrite: true, injectPriority: 100 },
  { key: "emotionalCenter", label: "情绪重心", kind: "short_text", llmExtract: true, injectOnWrite: true, injectPriority: 90 },
  { key: "conflictAxis", label: "主要矛盾轴", kind: "short_text", llmExtract: true, injectOnWrite: true, injectPriority: 80 },
  { key: "stateSummary", label: "当前状态摘要", kind: "long_text", llmExtract: true, injectOnWrite: true, injectPriority: 70 },
  // T5 情绪弧线：LLM 从正文提取情绪节点序列（章/情绪/触发/强度）。
  { key: "emotionalArc", label: "情绪弧线", kind: "list", llmExtract: true, injectOnWrite: true, injectPriority: 60 },
  { key: "activeScars", label: "活跃心理伤痕", kind: "list", llmExtract: false, injectOnWrite: true, injectPriority: 50 },
  { key: "notes", label: "作者备注", kind: "long_text", llmExtract: false, injectOnWrite: false, injectPriority: 0 },
];

export const CharacterKernelOriginSchema = z.enum(["settle", "manual", "import"]);
export type CharacterKernelOrigin = z.infer<typeof CharacterKernelOriginSchema>;

/** fields 的值形态：由 KernelFieldSpec.kind 决定（list 用 string[]，其余用 string）。 */
export const KernelFieldValueSchema = z.union([z.string(), z.array(z.string())]);
export type KernelFieldValue = z.infer<typeof KernelFieldValueSchema>;

export const CharacterKernelSchema = z.object({
  id: nonEmptyString,
  bookId: nonEmptyString,
  characterId: nonEmptyString,
  entryStatus: z.enum(["active", "archived"]),
  /** 键值对；键在配置的 fields 里注册，值形态由 kind 决定 */
  fields: z.record(nonEmptyString, KernelFieldValueSchema).default({}),
  /** 结算证据：参考了哪些 fact/event（[{id, excerpt}]） */
  evidence: z.array(z.object({ id: nonEmptyString, excerpt: z.string().optional() })).default([]),
  updatedChapter: nonNegativeInteger,
  updatedAt: nonEmptyString,
  origin: CharacterKernelOriginSchema,
});
export type CharacterKernel = Readonly<z.infer<typeof CharacterKernelSchema>>;
