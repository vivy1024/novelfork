import { createHash } from "node:crypto";
import { z } from "zod";

import {
  ChapterSummaryRowSchema,
  HookPayoffTimingSchema,
  HookStatusSchema,
  KnowledgeEventSchema,
  ResourceOpSchema,
  TimelineEntrySchema,
} from "./runtime-state.js";

// ── 角色状态变化 ──
export const CharacterStateUpdateSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().optional(),
  currentState: z.string().optional(),
  currentGoal: z.string().optional(),
  emotionalState: z.string().optional(),
  arcProgress: z.string().optional(),
  knowledge: z.array(z.string()).default([]),
});
export type CharacterStateUpdate = z.infer<typeof CharacterStateUpdateSchema>;

// ── 关系演变 ──
export const RelationshipDeltaSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  relationType: z.string().default("neutral"),
  sentiment: z.enum(["friendly", "hostile", "neutral", "complicated"]).default("neutral"),
  status: z.enum(["active", "broken", "evolving", "dormant"]).default("active"),
  turningPoint: z.string().optional(),
  description: z.string().default(""),
});
export type RelationshipDelta = z.infer<typeof RelationshipDeltaSchema>;

// ── 伏笔变动 ──
export const HookDeltaOpSchema = z.enum(["upsert", "mention", "resolve", "defer"]);
export type HookDeltaOp = z.infer<typeof HookDeltaOpSchema>;

export const HookDeltaSchema = z.object({
  hookId: z.string().min(1),
  action: HookDeltaOpSchema.default("upsert"),
  type: z.string().default("foreshadowing"),
  status: HookStatusSchema.default("open"),
  expectedPayoff: z.string().default(""),
  payoffTiming: HookPayoffTimingSchema.optional(),
  notes: z.string().default(""),
  volume: z.number().int().min(0).optional(),
});
export type HookDelta = z.infer<typeof HookDeltaSchema>;

// ── 下一章承诺 / 意图 ──
export const CommitmentDeltaSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1),
  targetChapter: z.number().int().min(1).optional(),
  scope: z.enum(["scene", "chapter", "volume", "book"]).default("chapter"),
  fulfilled: z.boolean().default(false),
});
export type CommitmentDelta = z.infer<typeof CommitmentDeltaSchema>;

// ── 统一 ChapterStateDelta ──
export const ChapterStateDeltaSchema = z.object({
  chapterNumber: z.number().int().min(1),
  /**
   * 内容指纹的一部分。结算台账的正文指纹、强制重结算次数都放这里，
   * 避免 force 重结算被相同剧情 delta 短路。
   */
  origin: z.string().min(1).optional(),
  title: z.string().optional(),
  characters: z.array(CharacterStateUpdateSchema).default([]),
  relationships: z.array(RelationshipDeltaSchema).default([]),
  hooks: z.array(HookDeltaSchema).default([]),
  timeline: TimelineEntrySchema.optional(),
  commitments: z.array(CommitmentDeltaSchema).default([]),
  summary: ChapterSummaryRowSchema.optional(),
  resources: z.array(ResourceOpSchema).default([]),
  knowledge: z.array(KnowledgeEventSchema).default([]),
  notes: z.array(z.string()).default([]),
});
export type ChapterStateDelta = z.infer<typeof ChapterStateDeltaSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * 稳定、幂等的 Delta 内容指纹计算（SHA-256）。
 * 递归按键排序后再序列化，相同内容在不同对象字段顺序下指纹一致。
 */
export function computeDeltaFingerprint(delta: ChapterStateDelta): string {
  const parsed = ChapterStateDeltaSchema.parse(delta);
  return createHash("sha256").update(JSON.stringify(canonicalize(parsed))).digest("hex");
}
