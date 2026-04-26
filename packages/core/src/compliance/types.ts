/**
 * Platform compliance types for NovelFork.
 *
 * Covers sensitive-word scanning, AI content ratio estimation,
 * format checking, publish-readiness assessment, and AI-usage disclosure.
 */

// ---------------------------------------------------------------------------
// Sensitive-word scanning
// ---------------------------------------------------------------------------

export type SensitiveWordCategory =
  | "political"
  | "sexual"
  | "violence"
  | "religious"
  | "racial"
  | "crime-glorify"
  | "minor-protection"
  | "medical-mislead"
  | "custom";

export type SensitiveWordSeverity = "block" | "warn" | "suggest";

export type SupportedPlatform = "qidian" | "jjwxc" | "fanqie" | "qimao" | "generic";

export interface SensitiveWord {
  readonly word: string;
  readonly category: SensitiveWordCategory;
  readonly severity: SensitiveWordSeverity;
  readonly platforms: ReadonlyArray<SupportedPlatform>;
  readonly suggestion?: string;
}

export interface SensitiveHit {
  readonly word: string;
  readonly category: SensitiveWordCategory;
  readonly severity: SensitiveWordSeverity;
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly count: number;
  readonly positions: ReadonlyArray<{
    readonly offset: number;
    readonly paragraph: number;
    readonly context: string;
  }>;
  readonly suggestion?: string;
}

export interface SensitiveScanResult {
  readonly platform: SupportedPlatform;
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly hits: ReadonlyArray<SensitiveHit>;
  readonly blockCount: number;
  readonly warnCount: number;
  readonly suggestCount: number;
}

export interface BookSensitiveScanResult {
  readonly platform: SupportedPlatform;
  readonly chapters: ReadonlyArray<SensitiveScanResult>;
  readonly totalBlockCount: number;
  readonly totalWarnCount: number;
  readonly totalSuggestCount: number;
}

// ---------------------------------------------------------------------------
// AI content ratio estimation
// ---------------------------------------------------------------------------

export interface ChapterAiEstimate {
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly wordCount: number;
  readonly aiTasteScore: number;
  readonly estimatedAiRatio: number;
  readonly isAboveThreshold: boolean;
  readonly level: "safe" | "caution" | "danger";
}

export interface BookAiRatioReport {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<ChapterAiEstimate>;
  readonly totalWords: number;
  readonly overallAiRatio: number;
  readonly overallLevel: "safe" | "caution" | "danger";
  readonly platformThreshold: number;
  readonly platformThresholds: Record<SupportedPlatform, number>;
  readonly platform: SupportedPlatform;
  readonly methodology: string;
}

// ---------------------------------------------------------------------------
// Format checking
// ---------------------------------------------------------------------------

export type FormatIssueSeverity = "block" | "warn" | "suggest";

export interface FormatIssue {
  readonly type:
    | "title-format"
    | "chapter-too-short"
    | "chapter-too-long"
    | "empty-chapter"
    | "consecutive-blank-lines"
    | "total-word-count"
    | "missing-synopsis";
  readonly severity: FormatIssueSeverity;
  readonly message: string;
  readonly detail?: string;
  readonly chapterNumber?: number;
  readonly suggestion?: string;
}

export interface FormatCheckResult {
  readonly platform: SupportedPlatform;
  readonly issues: ReadonlyArray<FormatIssue>;
  readonly totalWords: number;
  readonly chapterCount: number;
  readonly avgChapterWords: number;
  readonly blockCount: number;
  readonly warnCount: number;
  readonly suggestCount: number;
}

// ---------------------------------------------------------------------------
// Publish readiness
// ---------------------------------------------------------------------------

export type PublishReadinessStatus = "ready" | "has-warnings" | "blocked";

export interface PublishReadinessReport {
  readonly platform: SupportedPlatform;
  readonly status: PublishReadinessStatus;
  readonly sensitiveScan: BookSensitiveScanResult;
  readonly aiRatio: BookAiRatioReport;
  readonly formatCheck: FormatCheckResult;
  readonly totalBlockCount: number;
  readonly totalWarnCount: number;
  readonly totalSuggestCount: number;
}

// ---------------------------------------------------------------------------
// AI usage disclosure
// ---------------------------------------------------------------------------

export interface AiDisclosure {
  readonly bookId: string;
  readonly platform: SupportedPlatform;
  readonly aiUsageTypes: ReadonlyArray<string>;
  readonly estimatedAiRatio: number;
  readonly modelNames: ReadonlyArray<string>;
  readonly humanEditDescription: string;
  readonly markdownText: string;
}
