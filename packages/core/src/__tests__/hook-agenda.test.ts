import { describe, expect, it } from "vitest";
import {
  buildPlannerHookAgenda,
  isHookWithinLifecycleWindow,
} from "../utils/hook-agenda.js";
import { describeHookLifecycle } from "../utils/hook-lifecycle.js";
import type { StoredHook } from "../state/memory-db.js";

function createHook(overrides: Partial<StoredHook> = {}): StoredHook {
  return {
    hookId: overrides.hookId ?? "mentor-oath",
    startChapter: overrides.startChapter ?? 8,
    type: overrides.type ?? "relationship",
    status: overrides.status ?? "open",
    lastAdvancedChapter: overrides.lastAdvancedChapter ?? 9,
    expectedPayoff: overrides.expectedPayoff ?? "Reveal why the mentor broke the oath",
    payoffTiming: overrides.payoffTiming ?? "slow-burn",
    notes: overrides.notes ?? "Long debt should stay visible",
  };
}

describe("hook-agenda", () => {
  it("keeps lifecycle-aware windowing and pressure agenda behavior after extraction", () => {
    const staleSlowBurn = createHook({
      hookId: "mentor-oath",
      startChapter: 4,
      lastAdvancedChapter: 7,
      notes: "Long debt is stalling",
    });
    const readyMystery = createHook({
      hookId: "ledger-fragment",
      type: "mystery",
      startChapter: 2,
      lastAdvancedChapter: 10,
      payoffTiming: "near-term",
      expectedPayoff: "Reveal the ledger fragment's origin",
      notes: "Ready to cash out",
    });

    const agenda = buildPlannerHookAgenda({
      hooks: [staleSlowBurn, readyMystery],
      chapterNumber: 12,
      targetChapters: 24,
      language: "en",
    });

    expect(agenda.mustAdvance).toContain("mentor-oath");
    expect(agenda.pressureMap).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hookId: "mentor-oath",
      }),
    ]));

    const lifecycle = describeHookLifecycle({
      payoffTiming: staleSlowBurn.payoffTiming,
      expectedPayoff: staleSlowBurn.expectedPayoff,
      notes: staleSlowBurn.notes,
      startChapter: staleSlowBurn.startChapter,
      lastAdvancedChapter: staleSlowBurn.lastAdvancedChapter,
      status: staleSlowBurn.status,
      chapterNumber: 12,
      targetChapters: 24,
    });

    expect(isHookWithinLifecycleWindow(staleSlowBurn, 12, lifecycle)).toBe(true);
  });
});
