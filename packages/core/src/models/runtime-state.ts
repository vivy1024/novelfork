import { z } from "zod";

export const RuntimeStateLanguageSchema = z.enum(["zh", "en"]);
export type RuntimeStateLanguage = z.infer<typeof RuntimeStateLanguageSchema>;

export const StateManifestSchema = z.object({
  schemaVersion: z.literal(2),
  language: RuntimeStateLanguageSchema,
  lastAppliedChapter: z.number().int().min(0),
  projectionVersion: z.number().int().min(1),
  migrationWarnings: z.array(z.string()).default([]),
});

export type StateManifest = z.infer<typeof StateManifestSchema>;

export const HookStatusSchema = z.enum(["open", "progressing", "deferred", "resolved"]);
export type HookStatus = z.infer<typeof HookStatusSchema>;

export const HookPayoffTimingSchema = z.enum([
  "immediate",
  "near-term",
  "mid-arc",
  "slow-burn",
  "endgame",
]);
export type HookPayoffTiming = z.infer<typeof HookPayoffTimingSchema>;

export const HookRecordSchema = z.object({
  hookId: z.string().min(1),
  startChapter: z.number().int().min(0),
  type: z.string().min(1),
  status: HookStatusSchema,
  lastAdvancedChapter: z.number().int().min(0),
  expectedPayoff: z.string().default(""),
  payoffTiming: HookPayoffTimingSchema.optional(),
  notes: z.string().default(""),
  /** 埋设所在卷（P3-2 伏笔卷级追踪）。缺省按章号推断。 */
  volume: z.number().int().min(0).optional(),
});

export type HookRecord = z.infer<typeof HookRecordSchema>;

export const HooksStateSchema = z.object({
  hooks: z.array(HookRecordSchema).default([]),
});

export type HooksState = z.infer<typeof HooksStateSchema>;

export const ChapterSummaryRowSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().min(1),
  characters: z.string().default(""),
  events: z.string().default(""),
  stateChanges: z.string().default(""),
  hookActivity: z.string().default(""),
  mood: z.string().default(""),
  chapterType: z.string().default(""),
});

export type ChapterSummaryRow = z.infer<typeof ChapterSummaryRowSchema>;

export const ChapterSummariesStateSchema = z.object({
  rows: z.array(ChapterSummaryRowSchema).default([]),
});

export type ChapterSummariesState = z.infer<typeof ChapterSummariesStateSchema>;

export const CurrentStateFactSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  validFromChapter: z.number().int().min(0),
  validUntilChapter: z.number().int().min(0).nullable(),
  sourceChapter: z.number().int().min(0),
});

export type CurrentStateFact = z.infer<typeof CurrentStateFactSchema>;

export const CurrentStateStateSchema = z.object({
  chapter: z.number().int().min(0),
  facts: z.array(CurrentStateFactSchema).default([]),
});

export type CurrentStateState = z.infer<typeof CurrentStateStateSchema>;

export const CurrentStatePatchSchema = z.object({
  currentLocation: z.string().optional(),
  protagonistState: z.string().optional(),
  currentGoal: z.string().optional(),
  currentConstraint: z.string().optional(),
  currentAlliances: z.string().optional(),
  currentConflict: z.string().optional(),
});

export type CurrentStatePatch = z.infer<typeof CurrentStatePatchSchema>;

export const HookOpsSchema = z.object({
  upsert: z.array(HookRecordSchema).default([]),
  mention: z.array(z.string().min(1)).default([]),
  resolve: z.array(z.string().min(1)).default([]),
  defer: z.array(z.string().min(1)).default([]),
});

export type HookOps = z.infer<typeof HookOpsSchema>;

export const NewHookCandidateSchema = z.object({
  type: z.string().min(1),
  expectedPayoff: z.string().default(""),
  payoffTiming: HookPayoffTimingSchema.optional(),
  notes: z.string().default(""),
});

export type NewHookCandidate = z.infer<typeof NewHookCandidateSchema>;

const LooseOpSchema = z.record(z.string(), z.unknown());

// ── 资源账本（P2-1 / A2）：结构化数值消耗，代码层验算，替代 LLM 维护的 Markdown ──
export const ResourceLedgerEntrySchema = z.object({
  resourceId: z.string().min(1),
  name: z.string().default(""),
  balance: z.number(),
  lastChapter: z.number().int().min(0).default(0),
  history: z.array(z.object({
    chapter: z.number().int().min(0),
    delta: z.number(),
    reason: z.string().default(""),
  })).default([]),
});
export type ResourceLedgerEntry = z.infer<typeof ResourceLedgerEntrySchema>;

export const ResourceLedgerStateSchema = z.object({
  resources: z.array(ResourceLedgerEntrySchema).default([]),
});
export type ResourceLedgerState = z.infer<typeof ResourceLedgerStateSchema>;

/** settler 产出的资源操作：delta 为本章增减；可选 name（首次出现）与 expectedBalance（用于交叉验算） */
export const ResourceOpSchema = z.object({
  resourceId: z.string().min(1),
  delta: z.number(),
  reason: z.string().default(""),
  name: z.string().optional(),
  expectedBalance: z.number().optional(),
});
export type ResourceOp = z.infer<typeof ResourceOpSchema>;

// ── 角色知识边界事件溯源（P2-2 / A3）：谁在第几章知道了什么，防信息越界 ──
export const KnowledgeEventSchema = z.object({
  characterId: z.string().min(1),
  fact: z.string().min(1),
  learnedAtChapter: z.number().int().min(0),
  source: z.string().default(""),
});
export type KnowledgeEvent = z.infer<typeof KnowledgeEventSchema>;

export const KnowledgeStateSchema = z.object({
  events: z.array(KnowledgeEventSchema).default([]),
});
export type KnowledgeState = z.infer<typeof KnowledgeStateSchema>;

// ── 全书时间线（P3-1 / B2）：结构化故事时间推进，机器校验时序矛盾 ──
export const TimelineEntrySchema = z.object({
  chapter: z.number().int().min(0),
  storyTime: z.string().default(""),
  label: z.string().default(""),
  durationFromPrev: z.string().default(""),
  /** 单调序号：用于检测时序倒流（settler 给出本章故事时间相对全书的累计推进刻度，单位由书自定） */
  ordinal: z.number().optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineStateSchema = z.object({
  entries: z.array(TimelineEntrySchema).default([]),
});
export type TimelineState = z.infer<typeof TimelineStateSchema>;

export const RuntimeStateDeltaSchema = z.object({
  chapter: z.number().int().min(1),
  currentStatePatch: CurrentStatePatchSchema.optional(),
  hookOps: HookOpsSchema.default({
    upsert: [],
    mention: [],
    resolve: [],
    defer: [],
  }),
  newHookCandidates: z.array(NewHookCandidateSchema).default([]),
  chapterSummary: ChapterSummaryRowSchema.optional(),
  resourceOps: z.array(ResourceOpSchema).default([]),
  knowledgeOps: z.array(KnowledgeEventSchema).default([]),
  timelineOp: TimelineEntrySchema.optional(),
  subplotOps: z.array(LooseOpSchema).default([]),
  emotionalArcOps: z.array(LooseOpSchema).default([]),
  characterMatrixOps: z.array(LooseOpSchema).default([]),
  notes: z.array(z.string()).default([]),
});

export type RuntimeStateDelta = z.infer<typeof RuntimeStateDeltaSchema>;
