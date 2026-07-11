import { describe, expect, it } from "vitest";

import { canRunToolInParallel } from "./tool-parallel-policy.js";

describe("tool parallel policy", () => {
  it("keeps confirmed cooperative read-only tools parallel-safe", () => {
    for (const name of [
      "Read", "Glob", "Grep", "WebSearch", "WebFetch",
      "GetGoals", "LearningGuide", "Recall",
      "jingwei.read", "chapter.read", "cockpit.snapshot",
      "chapter.list", "chapter.audit", "presets.read", "beat.read",
      "outline.suggest_next", "character.check_consistency",
      "presets.check_compliance",
    ]) {
      expect(canRunToolInParallel(name, {}), name).toBe(true);
    }
  });

  it.each([
    ["list", true],
    ["check_due", true],
    ["plant", false],
    ["payoff", false],
    ["delete", false],
    ["unknown", false],
    [undefined, false],
  ])("classifies hooks.manage action %s as parallel-safe=%s", (action, expected) => {
    expect(canRunToolInParallel("hooks.manage", action === undefined ? {} : { action })).toBe(expected);
  });

  it("defaults unknown tools and action-narrowed reads to serial", () => {
    expect(canRunToolInParallel("future.tool", {})).toBe(false);
    expect(canRunToolInParallel("future.tool", { action: "read" })).toBe(false);
    expect(canRunToolInParallel("Read", { action: "overwrite" })).toBe(false);
  });

  it("rejects tools whose current cancellation capability is not cooperative", () => {
    expect(canRunToolInParallel("Write", {})).toBe(false);
    expect(canRunToolInParallel("Bash", {})).toBe(false);
  });
});
