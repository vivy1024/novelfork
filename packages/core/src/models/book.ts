import { z } from "zod";

export const PlatformSchema = z.enum(["tomato", "feilu", "qidian", "other"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const GenreSchema = z.string().min(1);
export type Genre = z.infer<typeof GenreSchema>;

export const BookStatusSchema = z.enum([
  "incubating",
  "outlining",
  "active",
  "paused",
  "completed",
  "dropped",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const FanficModeSchema = z.enum(["canon", "au", "ooc", "cp"]);
export type FanficMode = z.infer<typeof FanficModeSchema>;

function normalizeLegacyBookConfig(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;

  const normalized = { ...(input as Record<string, unknown>) };
  const legacyPresetIds = normalized.enabledPresetIds;
  delete normalized.enabledPresetIds;
  delete normalized.beatTemplateId;
  delete normalized.customPresetOverrides;

  if (
    normalized.enabledWritingSkillIds === undefined
    && Array.isArray(legacyPresetIds)
    && legacyPresetIds.every((id) => typeof id === "string")
  ) {
    normalized.enabledWritingSkillIds = legacyPresetIds;
  }

  return normalized;
}

export const BookConfigSchema = z.preprocess(normalizeLegacyBookConfig, z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: PlatformSchema,
  genre: GenreSchema,
  status: BookStatusSchema,
  targetChapters: z.number().int().min(1).default(200),
  chapterWordCount: z.number().int().min(1000).default(3000),
  language: z.enum(["zh", "en"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentBookId: z.string().optional(),
  fanficMode: FanficModeSchema.optional(),
  enabledWritingSkillIds: z.array(z.string()).optional(),
  arcTrackingMode: z.enum(["off", "rule", "llm"]).optional(),
  customSensitiveWords: z.string().optional(),
  /** 题材复杂度（决定经纬初始展开规模） */
  complexity: z.enum(["light", "medium", "heavy"]).optional(),
  /** 作者手动覆盖的可见经纬分类（覆盖模板默认） */
  visibleCategories: z.array(z.string()).optional(),
}));

export type BookConfig = z.infer<typeof BookConfigSchema>;
