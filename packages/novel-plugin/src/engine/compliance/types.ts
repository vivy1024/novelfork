/**
 * Platform compliance types for NovelFork.
 *
 * Covers local sensitive-word signals, AI-taste signals,
 * format checking, publish-risk self-check, and AI-usage disclosure.
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

export interface RulePackMetadata {
  /** 稳定规则包标识，供 UI 和审计结果追溯来源。 */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: string;
  readonly confidence: "high" | "medium" | "low";
  readonly effectiveAt?: string;
  readonly note?: string;
}

export interface ComplianceEvidence {
  readonly ruleId: string;
  /** 产出此证据的规则包；缺省时仅有 source 文本来源。 */
  readonly rulePackId?: string;
  readonly source: string;
  readonly severity: "high" | "medium" | "low";
  readonly chapterNumber?: number;
  readonly chapterTitle?: string;
  readonly message: string;
  readonly matchedText?: string;
  readonly offset?: number;
  readonly paragraph?: number;
  readonly context?: string;
  readonly suggestion?: string;
}

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
// Local AI-taste signals (not generation-ratio estimation)
// ---------------------------------------------------------------------------

export interface ChapterAiTasteSignal {
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly wordCount: number;
  readonly aiTasteScore: number;
  readonly riskLevel: "low" | "medium" | "high";
  readonly evidence?: ComplianceEvidence;
}

export interface BookAiTasteReport {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<ChapterAiTasteSignal>;
  readonly totalWords: number;
  readonly overallRiskLevel: "low" | "medium" | "high";
  readonly platform: SupportedPlatform;
  readonly methodology: string;
  readonly rulePack: RulePackMetadata;
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

export type PublishReadinessStatus = "ready" | "has-warnings" | "needs-review" | "skipped";

export interface ContinuityIssue {
  readonly chapterNumber: number;
  readonly category: string;
  readonly severity: "critical" | "warning";
  readonly message: string;
}

export type ContinuityCheckResult =
  | {
      readonly status: "has-issues";
      readonly source: string;
      readonly checkedChapterCount: number;
      readonly issueCount: number;
      readonly blockCount: number;
      readonly warnCount: number;
      readonly score: number;
      readonly issues: ReadonlyArray<ContinuityIssue>;
    }
  | {
      readonly status: "unknown";
      readonly reason: string;
    }
  | {
      readonly status: "passed";
      readonly source: string;
      readonly checkedChapterCount: number;
      readonly issueCount: number;
      readonly score: number;
    };

export interface PublishReadinessReport {
  readonly platform: SupportedPlatform;
  readonly status: PublishReadinessStatus;
  readonly rulePack: RulePackMetadata;
  readonly evidence: ReadonlyArray<ComplianceEvidence>;
  readonly sensitiveScan: BookSensitiveScanResult;
  readonly aiTaste: BookAiTasteReport;
  readonly formatCheck: FormatCheckResult;
  readonly continuity: ContinuityCheckResult;
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
  readonly aiTasteRiskLevel: "low" | "medium" | "high";
  readonly modelNames: ReadonlyArray<string>;
  readonly humanEditDescription: string;
  readonly markdownText: string;
}
