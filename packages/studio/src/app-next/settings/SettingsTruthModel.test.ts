import { describe, expect, it } from "vitest";

import { deriveModelSettingsFacts, settingsFactDisplayValue } from "./SettingsTruthModel";

const sampleConfig = {
  modelDefaults: {
    defaultSessionModel: "gpt-4o",
    summaryModel: "gpt-4o-mini",
    subagentModelPool: ["gpt-4o", "gpt-4o-mini"],
    validation: { defaultSessionModel: "valid", summaryModel: "valid", subagentModelPool: {}, invalidModelIds: [] },
  },
  runtimeControls: {
    defaultReasoningEffort: "medium",
  },
} as const;

describe("SettingsTruthModel", () => {
  it("derives visible model facts with source, status, writability and API provenance", () => {
    const facts = deriveModelSettingsFacts(sampleConfig);

    expect(facts.map((fact) => fact.id)).toEqual([
      "model.defaultSessionModel",
      "model.summaryModel",
      "model.exploreSubagentModel",
      "model.planSubagentModel",
      "model.subagentModelPool",
      "runtime.defaultReasoningEffort",
    ]);
    for (const fact of facts) {
      expect(fact).toMatchObject({
        group: "models",
        source: "user-settings",
        status: "current",
        writable: true,
        readApi: "/api/settings/user",
        writeApi: "/api/settings/user",
        verifiedBy: "unit",
      });
      expect(settingsFactDisplayValue(fact)).not.toBe("—");
    }
  });

  it("marks missing user settings as unconfigured with a reason instead of a dash", () => {
    const facts = deriveModelSettingsFacts({ modelDefaults: { defaultSessionModel: "", summaryModel: "", subagentModelPool: [] }, runtimeControls: {} });

    expect(facts.every((fact) => fact.status === "unconfigured")).toBe(true);
    expect(facts.every((fact) => fact.reason)).toBe(true);
    expect(facts.every((fact) => settingsFactDisplayValue(fact) === "未配置")).toBe(true);
  });
});
