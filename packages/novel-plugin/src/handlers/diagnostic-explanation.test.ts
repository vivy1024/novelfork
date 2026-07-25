import { describe, expect, it } from "vitest";

import {
  explainDiagnostic,
  explainNarrativeEventRisk,
  hasDiagnosticExplanation,
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
    expect(result.message).toContain("location_changed");
  });
});
