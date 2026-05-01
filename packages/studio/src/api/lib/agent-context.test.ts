import { describe, expect, it } from "vitest";
import { buildBookContextBlock, buildAgentContext } from "./agent-context";
import type { BookDetail } from "../../shared/contracts";

describe("agent-context", () => {
  it("builds context block with basic book info", () => {
    const { contextBlock, isEmpty } = buildBookContextBlock({
      book: { id: "test-1", title: "测试书", genre: "xianxia", platform: "qidian", chapterCount: 5, targetChapters: 100 },
      chapterSummaries: [],
      pendingHooks: "",
      currentFocus: null,
      auditIssues: [],
    });

    expect(contextBlock).toContain("测试书");
    expect(contextBlock).toContain("xianxia");
    expect(contextBlock).toContain("5/100");
    expect(isEmpty).toBe(false);
  });

  it("includes current focus when available", () => {
    const { contextBlock } = buildBookContextBlock({
      book: { id: "t", title: "T", chapterCount: 1 },
      chapterSummaries: [],
      pendingHooks: "",
      currentFocus: "回收玉佩伏笔，描写林月的伤势恢复",
      auditIssues: [],
    });

    expect(contextBlock).toContain("回收玉佩伏笔");
  });

  it("truncates long focus text", () => {
    const longFocus = "a".repeat(600);
    const { contextBlock } = buildBookContextBlock({
      book: { id: "t", title: "T", chapterCount: 1 },
      chapterSummaries: [],
      pendingHooks: "",
      currentFocus: longFocus,
      auditIssues: [],
    });

    expect(contextBlock.length).toBeLessThan(longFocus.length + 100);
    expect(contextBlock).toContain("...");
  });

  it("includes recent chapter summaries", () => {
    const { contextBlock } = buildBookContextBlock({
      book: { id: "t", title: "T", chapterCount: 3 },
      chapterSummaries: [
        { number: 1, summary: "开端" },
        { number: 2, summary: "发展" },
        { number: 3, summary: "高潮" },
      ],
      pendingHooks: "",
      currentFocus: null,
      auditIssues: [],
    });

    expect(contextBlock).toContain("第2章");
    expect(contextBlock).toContain("第3章");
    // Should only show last 3
    expect(contextBlock).not.toContain("第1章");
  });

  it("includes pending hooks content", () => {
    const { contextBlock } = buildBookContextBlock({
      book: { id: "t", title: "T", chapterCount: 1 },
      chapterSummaries: [],
      pendingHooks: "| hook-1 | 玉佩伏笔 | open | 3 |",
      currentFocus: null,
      auditIssues: [],
    });

    expect(contextBlock).toContain("玉佩伏笔");
  });

  it("includes audit issues when present", () => {
    const { contextBlock } = buildBookContextBlock({
      book: { id: "t", title: "T", chapterCount: 5 },
      chapterSummaries: [],
      pendingHooks: "",
      currentFocus: null,
      auditIssues: [{ chapterNumber: 3, count: 2 }],
    });

    expect(contextBlock).toContain("审计问题");
    expect(contextBlock).toContain("第3章: 2");
  });

  it("buildAgentContext returns empty for empty book", () => {
    const result = buildAgentContext({ bookId: "test" });
    expect(result).toBe("");
  });

  it("buildAgentContext with full data", () => {
    const book: BookDetail = {
      id: "test",
      title: "仙逆",
      status: "drafting" as const,
      platform: "qidian",
      genre: "xianxia",
      targetChapters: 100,
      chapters: 5,
      chapterCount: 5,
      lastChapterNumber: 5,
      totalWords: 15000,
      approvedChapters: 3,
      pendingReview: 2,
      pendingReviewChapters: 2,
      failedReview: 0,
      failedChapters: 0,
      updatedAt: "2026-01-01",
      createdAt: "2026-01-01",
      chapterWordCount: 3000,
      language: "zh",
    };

    const result = buildAgentContext({
      bookId: "test",
      book,
      chapterSummaries: [{ number: 5, summary: "林月觉醒" }],
    });

    expect(result).toContain("仙逆");
    expect(result).toContain("林月觉醒");
  });
});
