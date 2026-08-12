import { describe, expect, it } from "vitest";
import { checkPublishReadiness } from "./publish-readiness.js";

describe("投稿风险自检", () => {
  it("聚合实际命中、AI 味线索与格式证据，并要求人工复核", () => {
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
    expect(report.aiTaste.chapters[1]?.riskLevel).toBe("high");
    expect(report.formatCheck.chapterCount).toBe(2);
    expect(report.status).toBe("needs-review");
    expect(report.rulePack.name).toContain("投稿风险自检");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ matchedText: "法轮功", chapterNumber: 1, context: expect.stringContaining("【法轮功】") }),
      expect.objectContaining({ ruleId: "ai-taste-heuristic", chapterNumber: 2 }),
    ]));
    expect(report.continuity.status).toBe("unknown");
  });

  it("在没有高风险或提醒时返回 ready", () => {
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

  it("把连续性审计异常转为可定位复核证据", () => {
    const report = checkPublishReadiness(
      "book-1",
      "generic",
      [
        { chapterNumber: 1, title: "第1章 开始", content: "字".repeat(12_000), aiTasteScore: 0.1, status: "approved", auditIssues: [] },
        { chapterNumber: 2, title: "第2章 断裂", content: "字".repeat(12_000), aiTasteScore: 0.1, status: "audit-failed", auditIssues: ["[critical] 连续性：角色位置矛盾", "[warning] 节奏：铺垫过慢"] },
      ],
      { synopsis: "简介" },
    );

    expect(report.continuity.status).toBe("has-issues");
    expect(report.status).toBe("needs-review");
    expect(report.evidence).toContainEqual(expect.objectContaining({
      ruleId: "continuity:连续性",
      chapterNumber: 2,
      severity: "high",
    }));
  });

  it("在审计数据缺失或格式异常时保持连续性未知", () => {
    const withoutAuditSource = checkPublishReadiness(
      "book-1", "generic", [{ chapterNumber: 1, title: "第1章 开始", content: "字".repeat(12_000), aiTasteScore: 0.1 }], { synopsis: "简介" },
    );
    expect(withoutAuditSource.continuity).toMatchObject({ status: "unknown", reason: expect.stringContaining("缺少") });

    const malformedAuditSource = checkPublishReadiness(
      "book-1", "generic", [{ chapterNumber: 1, title: "第1章 开始", content: "字".repeat(12_000), aiTasteScore: 0.1, status: "approved", auditIssues: "bad-shape" } as never], { synopsis: "简介" },
    );
    expect(malformedAuditSource.continuity).toMatchObject({ status: "unknown", reason: expect.stringContaining("格式") });
  });
});
