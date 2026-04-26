import { describe, expect, it } from "vitest";
import { builtinPresetBundles } from "../presets/bundles/index.js";
import { builtinLogicRisks } from "../presets/logic-risks/index.js";

const expectedLogicRiskIds = [
  "anachronism",
  "character-motivation",
  "economy-resource",
  "geography-transport",
  "information-flow",
  "institution-response",
  "satisfaction-cost",
  "technology-boundary",
];

const expectedBundleIds = [
  "classical-travel-xianxia",
  "historical-governance",
  "industrial-occult-mystery",
  "institutional-cultivation-satire",
  "mortal-sect-xianxia",
  "near-future-hard-scifi",
];

const toneIds = new Set([
  "austere-pragmatic",
  "classical-imagery",
  "comedic-light",
  "dark-humor-social",
  "tragic-solitude",
]);

const settingBaseIds = new Set([
  "victorian-industrial-occult",
  "classical-travelogue-jianghu",
  "sect-family-xianxia",
  "modern-platform-economy-satire",
  "historical-court-livelihood",
  "near-future-industrial-scifi",
]);

describe("logic risks and preset bundles", () => {
  it("registers all required logic risk rules", () => {
    expect(builtinLogicRisks.map((risk) => risk.id).sort()).toEqual(expectedLogicRiskIds);

    for (const risk of builtinLogicRisks) {
      expect(risk.category).toBe("logic-risk");
      expect(risk.writerConstraint.length).toBeGreaterThan(0);
      expect(risk.auditQuestion.length).toBeGreaterThan(0);
      expect(risk.evidenceHints.length).toBeGreaterThan(0);
      expect(risk.uncertainHandling).toContain("作者确认");
      expect(risk.appliesToSettingBases.length).toBeGreaterThan(0);
    }
  });

  it("registers all required preset bundles", () => {
    expect(builtinPresetBundles.map((bundle) => bundle.id).sort()).toEqual(expectedBundleIds);
  });

  it("keeps bundle references resolvable", () => {
    const logicRiskIds = new Set(builtinLogicRisks.map((risk) => risk.id));

    for (const bundle of builtinPresetBundles) {
      expect(bundle.category).toBe("bundle");
      expect(bundle.genreIds.length).toBeGreaterThan(0);
      expect(toneIds.has(bundle.toneId)).toBe(true);
      expect(settingBaseIds.has(bundle.settingBaseId)).toBe(true);
      expect(bundle.logicRiskIds.length).toBeGreaterThan(0);
      for (const riskId of bundle.logicRiskIds) {
        expect(logicRiskIds.has(riskId)).toBe(true);
      }
      if (bundle.difficulty === "hard") {
        expect(bundle.prerequisites.length).toBeGreaterThan(0);
        expect(bundle.notSuitableFor.length).toBeGreaterThan(0);
      }
    }
  });
});
