import { describe, expect, it } from "vitest";

import {
  explainDiagnostic,
  explainNarrativeEventRisk,
  formatAuthorExplanation,
  hasDiagnosticExplanation,
  isAuthorFacingDetail,
  listExplainedDiagnosticCodes,
} from "./diagnostic-explanation.js";

/** preflight 的全部 blocker 与 warning code，必须都有人话解释。 */
const PREFLIGHT_CODES = [
  "missing-directive",
  "empty-recent-progress",
  "high-risk-pending",
  "book-not-found",
  "style-disabled",
  "hooks-overdue",
  "volume-focus-missing",
  "platform-target-mismatch",
  "short-directive",
  "focus-default-only",
  "empty-chapter-summary",
] as const;

describe("diagnostic explanation contract", () => {
  it("registers an explanation for every preflight code", () => {
    for (const code of PREFLIGHT_CODES) {
      expect(hasDiagnosticExplanation(code), `missing explanation for ${code}`).toBe(true);
    }
  });

  it("keeps every registered explanation non-empty and actionable", () => {
    for (const code of listExplainedDiagnosticCodes()) {
      const { explanation } = explainDiagnostic(code, "msg");
      expect(explanation.whatHappened.length).toBeGreaterThan(8);
      expect(explanation.whyItMatters.length).toBeGreaterThan(8);
      expect(explanation.suggestedAction.length).toBeGreaterThan(8);
    }
  });

  it("marks hard data problems persistent and reminders advisory", () => {
    expect(explainDiagnostic("empty-recent-progress", "m").kind).toBe("persistent");
    expect(explainDiagnostic("missing-directive", "m").kind).toBe("persistent");
    expect(explainDiagnostic("style-disabled", "m").kind).toBe("advisory");
    expect(explainDiagnostic("hooks-overdue", "m").kind).toBe("advisory");
  });

  it("falls back instead of returning empty text for unknown codes", () => {
    const result = explainDiagnostic("brand-new-code", "something happened");
    expect(result.code).toBe("brand-new-code");
    expect(result.explanation.suggestedAction.length).toBeGreaterThan(0);
    expect(hasDiagnosticExplanation("brand-new-code")).toBe(false);
  });

  it("keeps registered explanations free of internal tool names and error codes", () => {
    for (const code of listExplainedDiagnosticCodes()) {
      const { explanation } = explainDiagnostic(code, "msg");
      expect(isAuthorFacingDetail(explanation.whatHappened), code).toBe(true);
      expect(isAuthorFacingDetail(explanation.whyItMatters), code).toBe(true);
      expect(isAuthorFacingDetail(explanation.suggestedAction), code).toBe(true);
    }
  });

  it("formats the three-part explanation for authors", () => {
    const text = formatAuthorExplanation({
      whatHappened: "这一章的记忆没写上。",
      whyItMatters: "续写会接不上人物位置和伏笔。",
      suggestedAction: "让叙述者再结算这一章。",
    });
    expect(text).toContain("发生了什么：这一章的记忆没写上。");
    expect(text).toContain("为什么要看：续写会接不上人物位置和伏笔。");
    expect(text).toContain("建议怎么做：让叙述者再结算这一章。");
  });
});

describe("isAuthorFacingDetail", () => {
  it("rejects internal codes, tool names and extractor jargon", () => {
    expect(isAuthorFacingDetail("settlement-extraction-failed")).toBe(false);
    expect(isAuthorFacingDetail("memory.settle_chapter")).toBe(false);
    expect(isAuthorFacingDetail("抽取器不可用。")).toBe(false);
    expect(isAuthorFacingDetail("LLM 事件抽取调用未完成（extractor unavailable）。")).toBe(false);
    expect(isAuthorFacingDetail("正文已经保存，不会丢稿。")).toBe(true);
  });
});

describe("explainNarrativeEventRisk", () => {
  it("treats high risk as persistent with review guidance", () => {
    const result = explainNarrativeEventRisk({ riskLevel: "high", eventType: "world_fact_introduced", chapterNumber: 12 });
    expect(result.kind).toBe("persistent");
    expect(result.explanation.whatHappened).toContain("第12章");
    expect(result.explanation.suggestedAction).toContain("批准");
  });

  it("treats low risk as advisory", () => {
    const result = explainNarrativeEventRisk({ riskLevel: "low", eventType: "location_changed", chapterNumber: 3 });
    expect(result.kind).toBe("advisory");
    expect(result.message).toContain("第3章");
    expect(result.message).toContain("待确认");
  });
});
