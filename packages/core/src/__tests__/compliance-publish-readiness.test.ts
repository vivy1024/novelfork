import { describe, expect, it } from "vitest";
import { checkPublishReadiness } from "../compliance/publish-readiness.js";

describe("publish readiness", () => {
  it("aggregates sensitive scan, AI ratio, and format check", () => {
    const report = checkPublishReadiness(
      "book-1",
      "qidian",
      [
        { chapterNumber: 1, title: "第1章 开始", content: "法轮功" + "字".repeat(1200), aiTasteScore: 0.1 },
        { chapterNumber: 2, title: "第2章 转折", content: "字".repeat(1200), aiTasteScore: 0.7 },
      ],
      { synopsis: "简介" },
    );

    expect(report.sensitiveScan.totalBlockCount).toBeGreaterThan(0);
    expect(report.aiRatio.chapters[1]!.isAboveThreshold).toBe(true);
    expect(report.formatCheck.chapterCount).toBe(2);
    expect(report.status).toBe("blocked");
    expect(report.continuity.status).toBe("unknown");
    expect(report.continuity.status === "unknown" && report.continuity.reason).toContain("连续性");
  });

  it("returns ready when no block or warning exists", () => {
    const report = checkPublishReadiness(
      "book-1",
      "generic",
      [
        { chapterNumber: 1, title: "第1章 开始", content: "字".repeat(12_000), aiTasteScore: 0.1 },
        { chapterNumber: 2, title: "第2章 继续", content: "字".repeat(12_000), aiTasteScore: 0.1 },
      ],
      { synopsis: "简介" },
    );

    expect(report.totalBlockCount).toBe(0);
    expect(report.status).toBe("ready");
  });

  it("derives continuity metrics from audited chapter issues", () => {
    const report = checkPublishReadiness(
      "book-1",
      "generic",
      [
        {
          chapterNumber: 1,
          title: "第1章 开始",
          content: "字".repeat(12_000),
          aiTasteScore: 0.1,
          status: "approved",
          auditIssues: [],
        },
        {
          chapterNumber: 2,
          title: "第2章 断裂",
          content: "字".repeat(12_000),
          aiTasteScore: 0.1,
          status: "audit-failed",
          auditIssues: ["[critical] 连续性：角色位置矛盾", "[warning] 节奏：铺垫过慢"],
        },
      ],
      { synopsis: "简介" },
    );

    expect(report.continuity.status).toBe("has-issues");
    if (report.continuity.status === "has-issues") {
      expect(report.continuity).toMatchObject({
        source: "chapter-audit-issues",
        checkedChapterCount: 2,
        issueCount: 1,
        blockCount: 1,
        warnCount: 0,
        score: 0.5,
      });
      expect(report.continuity.issues[0]).toMatchObject({
        chapterNumber: 2,
        category: "连续性",
        severity: "critical",
      });
    }
    expect(report.totalBlockCount).toBe(1);
    expect(report.status).toBe("blocked");
  });

  it("keeps continuity unknown when audit data is absent or malformed", () => {
    const withoutAuditSource = checkPublishReadiness(
      "book-1",
      "generic",
      [{ chapterNumber: 1, title: "第1章 开始", content: "字".repeat(12_000), aiTasteScore: 0.1 }],
      { synopsis: "简介" },
    );

    expect(withoutAuditSource.continuity).toMatchObject({
      status: "unknown",
      reason: expect.stringContaining("缺少"),
    });

    const malformedAuditSource = checkPublishReadiness(
      "book-1",
      "generic",
      [{
        chapterNumber: 1,
        title: "第1章 开始",
        content: "字".repeat(12_000),
        aiTasteScore: 0.1,
        status: "approved",
        auditIssues: "bad-shape",
      } as never],
      { synopsis: "简介" },
    );

    expect(malformedAuditSource.continuity).toMatchObject({
      status: "unknown",
      reason: expect.stringContaining("格式"),
    });
  });
});
