import { describe, expect, it } from "vitest";

import {
  JingweiEntryStatusSchema,
  BookStatusSchema,
  ChapterStatusSchema,
  normalizeJingweiEntryStatus,
  normalizeBookStatus,
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

  it("defines jingwei entry status set with safe fallbacks", () => {
    expect(JingweiEntryStatusSchema.options).toEqual(["active", "unresolved", "resolved", "deprecated"]);
    expect(normalizeJingweiEntryStatus("resolved")).toBe("resolved");
    expect(normalizeJingweiEntryStatus("missing")).toBe("active");
  });
});
