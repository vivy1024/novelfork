export type EntrySource = "user" | "agent-write" | "auto-settle" | "system-init" | "ai-enrich";
export type ConflictStatus = "none" | "pending" | "resolved";

/** @deprecated 仅用于读取旧 revision_history JSON；新历史以 jingwei_revision 为权威。 */
export interface EntryRevision {
  timestamp: string;
  source: EntrySource;
  changedFields: string[];
  previousSnapshot?: string;
}

export interface JingweiRevisionSnapshot {
  title: string;
  contentMd: string;
  summaryMd: string | null;
  category: string;
  layer: "canon" | "dynamic" | "reference";
  status: "draft" | "confirmed" | "needs-review";
  fields: Record<string, unknown>;
  tags: string[];
  aliases: string[];
  relatedChapterNumbers: number[];
  relatedEntryIds: string[];
  visibilityRule: {
    type: "tracked" | "global" | "nested";
    visibleAfterChapter?: number;
    visibleUntilChapter?: number;
    keywords?: string[];
    parentEntryIds?: string[];
  };
  participatesInAi: boolean;
  tokenBudget: number | null;
  priorityTier: "core" | "relevant" | "reference" | "auto";
  importance: number;
  summaryL0: string | null;
  sectionId: string;
  parentId: string | null;
  sortOrder: number;
  lifecycle: string;
}

export interface JingweiRevisionRecord {
  id: string;
  entryId: string;
  bookId: string;
  contentMd: string;
  category: string | null;
  layer: string | null;
  snapshot: JingweiRevisionSnapshot | null;
  reason: string | null;
  changedBy: string;
  createdAt: Date;
}
