import { describe, expect, it } from "vitest";

import {
  REQUIRED_THEME_UTILITIES,
  auditVisualStates,
  type VisualAuditSnapshot,
} from "./visual-audit";

function snapshot(id: string, overrides: Partial<VisualAuditSnapshot> = {}): VisualAuditSnapshot {
  return {
    id,
    label: id,
    backgroundColor: "rgb(255, 255, 255)",
    color: "rgb(17, 24, 39)",
    borderColor: "rgb(209, 213, 219)",
    opacity: "1",
    cursor: "pointer",
    boxShadow: "none",
    ...overrides,
  };
}

describe("app-next visual audit", () => {
  it("fails when theme utilities are missing and visual states collapse into the same style group", () => {
    const result = auditVisualStates({
      cssText: ".bg-card{}",
      snapshots: {
        primaryAction: snapshot("primaryAction"),
        outlineAction: snapshot("outlineAction"),
        activeTab: snapshot("activeTab"),
        disabledAction: snapshot("disabledAction", { cursor: "not-allowed", opacity: "0.5" }),
      },
    });

    expect(result.pass).toBe(false);
    expect(result.missingUtilities).toContain(REQUIRED_THEME_UTILITIES[0]);
    expect(result.comparisons.primaryVsOutline.sameGroup).toBe(true);
    expect(result.comparisons.activeTabVsOutline.sameGroup).toBe(true);
  });

  it("passes when primary/active, outline and disabled states stay visually distinguishable", () => {
    const cssText = REQUIRED_THEME_UTILITIES.join("\n");
    const result = auditVisualStates({
      cssText,
      snapshots: {
        primaryAction: snapshot("primaryAction", {
          backgroundColor: "oklch(0.45 0.12 25)",
          color: "oklch(0.98 0.006 76)",
          borderColor: "rgba(0, 0, 0, 0)",
        }),
        outlineAction: snapshot("outlineAction", {
          backgroundColor: "oklch(0.985 0.005 80)",
          color: "oklch(0.13 0.02 60)",
          borderColor: "oklch(0.84 0.01 76)",
        }),
        activeTab: snapshot("activeTab", {
          backgroundColor: "oklch(0.45 0.12 25)",
          color: "oklch(0.98 0.006 76)",
          borderColor: "rgba(0, 0, 0, 0)",
        }),
        disabledAction: snapshot("disabledAction", {
          backgroundColor: "oklch(0.45 0.12 25)",
          color: "oklch(0.98 0.006 76)",
          borderColor: "rgba(0, 0, 0, 0)",
          opacity: "0.5",
          cursor: "not-allowed",
        }),
      },
    });

    expect(result.pass).toBe(true);
    expect(result.missingUtilities).toEqual([]);
    expect(result.comparisons.primaryVsOutline.sameGroup).toBe(false);
    expect(result.comparisons.activeTabVsOutline.sameGroup).toBe(false);
    expect(result.comparisons.disabledVsOutline.sameGroup).toBe(false);
    expect(result.comparisons.disabledVsPrimary.sameGroup).toBe(false);
  });
});
