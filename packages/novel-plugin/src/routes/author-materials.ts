export const AUTHOR_REVIEW_FILES = {
  radar: "market_radar.md",
  webCapture: "web_materials.md",
} as const;

export type AuthorMaterialFile = (typeof AUTHOR_REVIEW_FILES)[keyof typeof AUTHOR_REVIEW_FILES];

export interface AuthorMaterialRadarRecommendation {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

export interface AuthorMaterialRadarResult {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<AuthorMaterialRadarRecommendation>;
  readonly timestamp?: string;
}

export interface AuthorMaterialPersistenceInfo {
  readonly bookId: string;
  readonly file: AuthorMaterialFile;
  readonly path: string;
  readonly savedAt: string;
}

export interface AuthorWebCaptureInput {
  readonly url: string;
  readonly label?: string;
  readonly notes?: string;
  readonly perspective?: "market" | "genre" | "setting" | "character" | "reference";
}

export interface AuthorWebCaptureResult {
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly sourceUrl: string;
  readonly label?: string;
  readonly perspective: NonNullable<AuthorWebCaptureInput["perspective"]>;
  readonly notes?: string;
  readonly capturedAt: string;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function nonEmptyLines(values: ReadonlyArray<string | undefined>): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

export function buildRadarReviewMarkdown(result: AuthorMaterialRadarResult, savedAt: string): string {
  const lines: string[] = [
    "# 市场雷达审阅记录",
    "",
    `- 记录时间：${savedAt}`,
    "- 用途：题材分析 / 市场雷达 / 选题预研",
    "- 说明：以下内容为作者可审阅结果，不会自动写入故事经纬。",
    "",
    "## 市场概览",
    "",
    escapeMarkdown(result.marketSummary),
    "",
    "## 题材建议",
    "",
  ];

  if (result.recommendations.length === 0) {
    lines.push("暂无可用建议。", "");
    return lines.join("\n");
  }

  result.recommendations.forEach((recommendation, index) => {
    lines.push(
      `### ${index + 1}. ${recommendation.concept}`,
      "",
      `- 平台：${recommendation.platform || "未标注"}`,
      `- 题材：${recommendation.genre || "未标注"}`,
      `- 置信度：${Number.isFinite(recommendation.confidence) ? `${Math.round(recommendation.confidence * 100)}%` : "未标注"}`,
      `- 推荐理由：${escapeMarkdown(recommendation.reasoning || "未提供")}`,
    );

    if (recommendation.benchmarkTitles.length > 0) {
      lines.push(`- 对标作品：${recommendation.benchmarkTitles.join("、")}`);
    }

    lines.push("");
  });

  return lines.join("\n");
}

export function buildWebCaptureReviewMarkdown(result: AuthorWebCaptureResult): string {
  const metaLines = nonEmptyLines([
    `- 抓取时间：${result.capturedAt}`,
    `- 分析视角：${result.perspective}`,
    result.label ? `- 作者标签：${result.label}` : undefined,
    `- 来源链接：${result.sourceUrl}`,
    result.notes ? `- 备注：${result.notes}` : undefined,
    "- 说明：以下为待审阅素材摘录，不会自动写入故事经纬。",
  ]);

  return [
    "# 网页素材采风夹",
    "",
    `## ${escapeMarkdown(result.title || result.label || result.sourceUrl)}`,
    "",
    ...metaLines,
    "",
    "### 摘要预览",
    "",
    escapeMarkdown(result.excerpt || "（无摘要）"),
    "",
    "### 正文摘录",
    "",
    escapeMarkdown(result.content || "（抓取为空）"),
    "",
  ].join("\n");
}
