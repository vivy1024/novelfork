import { describe, expect, it } from "vitest";

import { parityEntryCanBeAdvertisedAsCurrent, validateParityMatrix, type ParityMatrixEntry } from "./parity-matrix";

const evidence = {
  source: "local-cli" as const,
  label: "claude --version",
  reference: "2.1.69 (Claude Code)",
  checkedAt: "2026-05-06",
};

describe("parity matrix validator", () => {
  it("accepts only audited statuses and requires dated evidence", () => {
    const entries: ParityMatrixEntry[] = [
      { capability: "continue latest", upstreamEvidence: [evidence], novelForkStatus: "current", surface: "/next sessions", verification: "session lifecycle tests", notes: "已接 NovelFork session service" },
      { capability: "bad status", upstreamEvidence: [], novelForkStatus: "done" as never, surface: "docs", verification: "none", notes: "invalid" },
      { capability: "missing date", upstreamEvidence: [{ ...evidence, checkedAt: "May 6" }], novelForkStatus: "partial", surface: "docs", verification: "manual", notes: "invalid date" },
    ];

    expect(validateParityMatrix(entries)).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "bad status", code: "INVALID_STATUS" }),
      expect.objectContaining({ capability: "bad status", code: "MISSING_EVIDENCE" }),
      expect.objectContaining({ capability: "missing date", code: "MISSING_DATE" }),
    ]));
  });

  it("blocks non-goal Claude capabilities from UI current claims", () => {
    const nonGoal: ParityMatrixEntry = {
      capability: "Chrome bridge",
      upstreamEvidence: [{ ...evidence, label: "main.tsx --chrome", reference: "claude/restored-cli-src/src/main.tsx" }],
      novelForkStatus: "non-goal",
      surface: "能力矩阵",
      verification: "docs guard",
      notes: "NovelFork 不实现 Claude Chrome bridge",
    };

    expect(validateParityMatrix([nonGoal])).toContainEqual(expect.objectContaining({ capability: "Chrome bridge", code: "NON_GOAL_UI_CLAIM" }));
    expect(parityEntryCanBeAdvertisedAsCurrent({ ...nonGoal, uiClaimAllowed: false })).toBe(false);
    expect(parityEntryCanBeAdvertisedAsCurrent({ ...nonGoal, novelForkStatus: "current" })).toBe(true);
  });
});
