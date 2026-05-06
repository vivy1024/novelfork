import { describe, expect, it } from "vitest";

import * as parityMatrixModule from "./parity-matrix";
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

  it("ships a dated Codex CLI parity baseline that keeps sandbox and approval out of current UI claims", () => {
    const entries = (parityMatrixModule as { CODEX_CLI_PARITY_MATRIX?: readonly ParityMatrixEntry[] }).CODEX_CLI_PARITY_MATRIX ?? [];

    expect(entries.map((entry) => entry.capability)).toEqual([
      "Codex TUI",
      "Codex non-interactive exec",
      "Codex config file and profile overrides",
      "Codex sandbox modes",
      "Codex approval policy",
      "Codex MCP server/client configuration",
      "Codex subagents",
      "Codex web search",
      "Codex image input",
      "Codex code review",
      "Codex Windows native support boundary",
    ]);
    expect(validateParityMatrix(entries)).toEqual([]);

    const sandbox = entries.find((entry) => entry.capability === "Codex sandbox modes");
    expect(sandbox).toMatchObject({ novelForkStatus: "planned", uiClaimAllowed: false });
    expect(sandbox?.notes).toContain("read-only");
    expect(sandbox?.notes).toContain("workspace-write");
    expect(sandbox?.notes).toContain("danger-full-access");

    const approval = entries.find((entry) => entry.capability === "Codex approval policy");
    expect(approval).toMatchObject({ novelForkStatus: "partial", uiClaimAllowed: false });
    expect(approval?.notes).toContain("untrusted");
    expect(approval?.notes).toContain("on-request");
    expect(approval?.notes).toContain("never");
    expect(approval?.notes).toContain("granular");
  });
});
