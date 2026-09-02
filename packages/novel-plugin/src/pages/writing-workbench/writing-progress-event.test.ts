import { describe, expect, it } from "vitest";

import {
  dispatchWritingProgress,
  WRITING_PROGRESS_EVENT,
  writingProgressBookId,
} from "./writing-progress-event";

describe("writing progress event", () => {
  it("carries the book id so other books ignore it", () => {
    if (typeof window === "undefined") return;
    const seen: Array<string | undefined> = [];
    const handler = (event: Event) => seen.push(writingProgressBookId(event));
    window.addEventListener(WRITING_PROGRESS_EVENT, handler);
    dispatchWritingProgress({ reason: "pipeline.write", bookId: "book-1" });
    window.removeEventListener(WRITING_PROGRESS_EVENT, handler);
    expect(seen).toEqual(["book-1"]);
  });

  it("does not throw when window is missing", () => {
    expect(() => dispatchWritingProgress({ reason: "chapter-save" })).not.toThrow();
  });
});
