import { describe, expect, it } from "vitest";

import {
  BibleEntryStatusSchema,
  BookStatusSchema,
  CandidateStatusSchema,
  ChapterStatusSchema,
  normalizeBibleEntryStatus,
  normalizeBookStatus,
  normalizeCandidateStatus,
  normalizeChapterStatus,
} from "../models/status.js";

describe("canonical status models", () => {
  it("defines the Phase 5 book status set and maps legacy values", () => {
    expect(BookStatusSchema.options).toEqual(["idea", "outlining", "drafting", "revising", "reviewing", "publishing", "archived"]);
    expect(normalizeBookStatus("incubating")).toBe("idea");
    expect(normalizeBookStatus("active")).toBe("drafting");
    expect(normalizeBookStatus("paused")).toBe("revising");
    expect(normalizeBookStatus("completed")).toBe("publishing");
    expect(normalizeBookStatus("dropped")).toBe("archived");
    expect(normalizeBookStatus("not-a-status")).toBe("drafting");
  });

  it("defines the Phase 5 chapter status set and maps legacy values", () => {
    expect(ChapterStatusSchema.options).toEqual(["draft", "writing", "ready-for-review", "approved", "published"]);
    expect(normalizeChapterStatus("card-generated")).toBe("draft");
    expect(normalizeChapterStatus("drafting")).toBe("writing");
    expect(normalizeChapterStatus("drafted")).toBe("draft");
    expect(normalizeChapterStatus("auditing")).toBe("ready-for-review");
    expect(normalizeChapterStatus("audit-passed")).toBe("approved");
    expect(normalizeChapterStatus("audit-failed")).toBe("ready-for-review");
    expect(normalizeChapterStatus("state-degraded")).toBe("writing");
    expect(normalizeChapterStatus("revising")).toBe("writing");
    expect(normalizeChapterStatus("imported")).toBe("draft");
    expect(normalizeChapterStatus("not-a-status")).toBe("draft");
  });

  it("defines candidate and bible entry status sets with safe fallbacks", () => {
    expect(CandidateStatusSchema.options).toEqual(["candidate", "accepted", "rejected", "archived"]);
    expect(BibleEntryStatusSchema.options).toEqual(["active", "unresolved", "resolved", "deprecated"]);
    expect(normalizeCandidateStatus("accepted")).toBe("accepted");
    expect(normalizeCandidateStatus("missing")).toBe("candidate");
    expect(normalizeBibleEntryStatus("resolved")).toBe("resolved");
    expect(normalizeBibleEntryStatus("missing")).toBe("active");
  });
});
