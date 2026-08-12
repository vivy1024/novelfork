import type {
  BookAiTasteReport,
  ChapterAiTasteSignal,
  RulePackMetadata,
  SupportedPlatform,
} from "./types.js";

export const AI_TASTE_RULE_PACK: RulePackMetadata = {
  id: "AI_TASTE_RULE_PACK",
  name: "NovelFork AI 味启发式规则",
  version: "1.0.0",
  source: "NovelFork 本地 AI 味特征量表",
  confidence: "low",
  effectiveAt: "2026-08-12",
  note: "只用于定位可能需要人工改写的文本特征；0–100 分量表不表示实际 AI 生成比例，也不代表任何平台审核阈值。",
};

export const AI_TASTE_METHODOLOGY =
  "基于 NovelFork 本地 AI 味特征量表生成粗粒度风险线索；不估算 AI 生成比例，不映射平台阈值，最终由作者人工复核。";

export interface ChapterAiTasteInput {
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly wordCount: number;
  readonly aiTasteScore: number;
}

export function normalizeAiTasteScore(aiTasteScore: number): number {
  if (!Number.isFinite(aiTasteScore)) return 0;
  const normalized = aiTasteScore > 1 ? aiTasteScore / 100 : aiTasteScore;
  return Math.max(0, Math.min(1, normalized));
}

function classifyRisk(score: number): "low" | "medium" | "high" {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function assessChapterAiTaste(input: ChapterAiTasteInput): ChapterAiTasteSignal {
  const aiTasteScore = normalizeAiTasteScore(input.aiTasteScore);
  const riskLevel = classifyRisk(aiTasteScore);
  return {
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    wordCount: input.wordCount,
    aiTasteScore,
    riskLevel,
    ...(riskLevel === "low" ? {} : {
      evidence: {
        ruleId: "ai-taste-heuristic",
        rulePackId: AI_TASTE_RULE_PACK.id,
        source: AI_TASTE_RULE_PACK.name,
        severity: riskLevel === "high" ? "high" : "medium",
        chapterNumber: input.chapterNumber,
        chapterTitle: input.chapterTitle,
        message: `本地 AI 味特征量表为 ${Math.round(aiTasteScore * 100)}/100，建议人工复核表达是否模板化。`,
        suggestion: "重点检查套话、重复句式、空泛总结和缺少具体感官细节的段落。",
      },
    }),
  };
}

export function assessBookAiTaste(
  bookId: string,
  chapters: ReadonlyArray<ChapterAiTasteInput>,
  platform: SupportedPlatform = "generic",
): BookAiTasteReport {
  const signals = chapters.map(assessChapterAiTaste);
  const overallRiskLevel = signals.some((chapter) => chapter.riskLevel === "high")
    ? "high"
    : signals.some((chapter) => chapter.riskLevel === "medium")
      ? "medium"
      : "low";

  return {
    bookId,
    chapters: signals,
    totalWords: signals.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    overallRiskLevel,
    platform,
    methodology: AI_TASTE_METHODOLOGY,
    rulePack: AI_TASTE_RULE_PACK,
  };
}
