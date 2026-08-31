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

export const NarrativeContractSchema = z.object({
  /** 书名/简介对读者作出的核心承诺。 */
  titlePromise: z.string().optional(),
  /** 驱动主线的核心问题。 */
  coreQuestion: z.string().optional(),
  /** 贯穿全书的主题锚点。 */
  themeAnchors: z.array(z.string()).optional(),
  /** 章内允许揭示的底牌层级。 */
  revealBudget: z.object({
    level: z.number().int().min(0),
    description: z.string().optional(),
  }).optional(),
});
export type NarrativeContract = z.infer<typeof NarrativeContractSchema>;

export const BookConfigSchema = z.object({
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
  arcTrackingMode: z.enum(["off", "rule", "llm"]).optional(),
  customSensitiveWords: z.string().optional(),
  /** 题材复杂度（决定经纬初始展开规模） */
  complexity: z.enum(["light", "medium", "heavy"]).optional(),
  /** 作者手动覆盖的可见经纬分类（覆盖模板默认） */
  visibleCategories: z.array(z.string()).optional(),
  /** 叙事契约：全书承诺、核心问题、主题锚点与揭示预算。 */
  narrativeContract: NarrativeContractSchema.optional(),
  /**
   * 是否把作者级跨书习惯注入本书。默认关闭，避免把一本的口吻泄漏到另一本。
   * 存量书籍没有该字段时按 false 处理。
   */
  authorProfileEnabled: z.boolean().optional().default(false),
});

export type BookConfig = z.infer<typeof BookConfigSchema>;
