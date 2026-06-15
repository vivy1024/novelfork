export type EntrySource = "user" | "agent-write" | "auto-settle" | "system-init" | "ai-enrich";
export type ConflictStatus = "none" | "pending" | "resolved";

export interface EntryRevision {
  timestamp: string;
  source: EntrySource;
  changedFields: string[];
  previousSnapshot?: string;
}
