import { describe, expect, it, vi } from "vitest";

import { executeWriteNextWorkflow, type WriteNextWorkflowInput, type WriteNextWorkflowResult } from "./novel-write-next-handler";

describe("/novel:write-next handler", () => {
  it("executes the full workflow: context → plan → candidate", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ success: true, type: "message", content: "基于驾驶舱快照，我建议写第四章：主角进入秘境。" })
      .mockResolvedValueOnce({ success: true, type: "message", content: "# 第四章 秘境入口\n\n林远站在洞口前，灵气如潮水般涌来..." });

    const readContext = vi.fn().mockResolvedValue({
      ok: true,
      bookId: "book-1",
      chapters: [{ id: "ch-3", title: "第三章", wordCount: 3200 }],
      currentChapter: 3,
      totalPlanned: 10,
    });

    const result = await executeWriteNextWorkflow({
      bookId: "book-1",
      sessionId: "session-1",
      generate,
      readContext,
    });

    expect(result.ok).toBe(true);
    expect(result.candidateContent).toContain("秘境入口");
    expect(result.candidateWordCount).toBeGreaterThan(0);
    expect(result.steps).toEqual(["context", "plan", "candidate"]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(readContext).toHaveBeenCalledWith("book-1");
  });

  it("stops and preserves context when model is unavailable", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Model unavailable"));
    const readContext = vi.fn().mockResolvedValue({ ok: true, bookId: "book-1", chapters: [], currentChapter: 0, totalPlanned: 10 });

    const result = await executeWriteNextWorkflow({
      bookId: "book-1",
      sessionId: "session-1",
      generate,
      readContext,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("unavailable");
    expect(result.steps).toEqual(["context"]); // Context was read before failure
    expect(result.preservedContext).toBeTruthy();
  });

  it("stops when context read fails", async () => {
    const generate = vi.fn();
    const readContext = vi.fn().mockResolvedValue({ ok: false, error: "Book not found" });

    const result = await executeWriteNextWorkflow({
      bookId: "nonexistent",
      sessionId: "session-1",
      generate,
      readContext,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
    expect(result.steps).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });
});
