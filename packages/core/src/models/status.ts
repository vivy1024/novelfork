import { z } from "zod";

export const BookStatusSchema = z.enum(["idea", "outlining", "drafting", "revising", "reviewing", "publishing", "archived"]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const ChapterStatusSchema = z.enum(["draft", "writing", "ready-for-review", "approved", "published"]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const CandidateStatusSchema = z.enum(["candidate", "accepted", "rejected", "archived"]);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const BibleEntryStatusSchema = z.enum(["active", "unresolved", "resolved", "deprecated"]);
export type BibleEntryStatus = z.infer<typeof BibleEntryStatusSchema>;

export function normalizeBookStatus(value: unknown): BookStatus {
  if (BookStatusSchema.safeParse(value).success) return value as BookStatus;
  switch (value) {
    case "incubating":
      return "idea";
    case "outlining":
      return "outlining";
    case "active":
      return "drafting";
    case "paused":
      return "revising";
    case "completed":
      return "publishing";
    case "dropped":
      return "archived";
    default:
      return "drafting";
  }
}

export function normalizeChapterStatus(value: unknown): ChapterStatus {
  if (ChapterStatusSchema.safeParse(value).success) return value as ChapterStatus;
  switch (value) {
    case "card-generated":
    case "drafted":
    case "imported":
      return "draft";
    case "drafting":
    case "state-degraded":
    case "revising":
      return "writing";
    case "auditing":
    case "audit-failed":
    case "rejected":
      return "ready-for-review";
    case "audit-passed":
      return "approved";
    default:
      return "draft";
  }
}

export function normalizeCandidateStatus(value: unknown): CandidateStatus {
  return CandidateStatusSchema.safeParse(value).success ? value as CandidateStatus : "candidate";
}

export function normalizeBibleEntryStatus(value: unknown): BibleEntryStatus {
  return BibleEntryStatusSchema.safeParse(value).success ? value as BibleEntryStatus : "active";
}
