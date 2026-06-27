import { describe, expect, it } from "vitest";

import {
  createDefaultNarrativeBenchmarkFixtures,
  runNarrativeRecallBenchmark,
} from "./benchmark.js";

describe("Narrative recall@budget benchmark", () => {
  it("runs deterministic baseline recall and skips embedding-dependent modes without provider", () => {
    const fixtures = createDefaultNarrativeBenchmarkFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    expect(fixtures.length).toBeLessThanOrEqual(20);

    const result = runNarrativeRecallBenchmark({ fixtures, budgetTokens: 120 });
    expect(result.fixtures).toBe(fixtures.length);
    expect(result.baselines.map((item) => item.name)).toEqual(["priority-only", "fts-only", "facts+fts", "semantic", "wave"]);
    expect(result.baselines.find((item) => item.name === "facts+fts")?.recallAtBudget).toBeGreaterThanOrEqual(
      result.baselines.find((item) => item.name === "priority-only")?.recallAtBudget ?? 0,
    );
    expect(result.baselines.find((item) => item.name === "semantic")?.skippedReason).toBe("embedding provider unavailable");
    expect(result.baselines.find((item) => item.name === "wave")?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
