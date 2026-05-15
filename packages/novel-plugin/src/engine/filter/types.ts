export type RuleSeverity = "low" | "medium" | "high";
export type AiTasteLevel = "clean" | "mild" | "moderate" | "severe";
export type ZhuqueStatus = "success" | "failed" | "not-configured";

export interface RuleSpan {
  start: number;
  end: number;
  matched: string;
}

export interface RuleHit {
  ruleId: string;
  name: string;
  severity: RuleSeverity;
  spans: RuleSpan[];
  suggestion?: string;
  weightContribution: number;
}

export interface ZhuqueResult {
  status: ZhuqueStatus;
  score?: number;
  error?: string;
  raw?: unknown;
}

export interface CrossSpecHint {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface FilterReport {
  aiTasteScore: number;
  level: AiTasteLevel;
  hits: RuleHit[];
  zhuque?: ZhuqueResult;
  engineVersion: string;
  tokensAnalyzed: number;
  elapsedMs: number;
  pgiUsed: boolean;
  filterReportId?: string;
  crossSpecHints?: CrossSpecHint[];
}

export interface StoredFilterReportRecord {
  id: string;
  bookId: string;
  chapterNumber: number;
  aiTasteScore: number;
  level: AiTasteLevel;
  hitCountsJson: string;
  zhuqueScore: number | null;
  zhuqueStatus: ZhuqueStatus | null;
  details: string;
  engineVersion: string;
  scannedAt: Date;
}

export type CreateStoredFilterReportInput = StoredFilterReportRecord;
