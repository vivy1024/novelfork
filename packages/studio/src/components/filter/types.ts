export type AiTasteLevel = "clean" | "mild" | "moderate" | "severe";

export interface FilterUiHit {
  ruleId: string;
  name: string;
  severity: "low" | "medium" | "high";
  spans: Array<{ start: number; end: number; matched: string }>;
  suggestion?: string;
}

export interface StoredFilterReportView {
  id: string;
  bookId?: string;
  chapterNumber: number;
  aiTasteScore: number;
  level: AiTasteLevel;
  details: {
    pgiUsed?: boolean;
    hits?: FilterUiHit[];
  };
}

export interface SevenTacticView {
  tacticId: number;
  name: string;
  type: string;
  template: string;
}
