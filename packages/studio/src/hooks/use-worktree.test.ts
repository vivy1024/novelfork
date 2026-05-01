import { describe, it, expect } from "vitest";

import { classifyWorktrees, getVisibleWorktrees, type Worktree } from "./use-worktree";

function makeWorktree(overrides: Partial<Worktree>): Worktree {
  return {
    path: "",
    branch: "main",
    head: "abc",
    bare: false,
    status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
    ...overrides,
  };
}

describe("classifyWorktrees", () => {
  it("returns empty for empty input", () => {
    expect(classifyWorktrees([])).toEqual([]);
  });

  it("treats the primary non-bare worktree and its subpaths as internal", () => {
    const result = classifyWorktrees([
      makeWorktree({ path: "D:/DESKTOP/novelfork" }),
      makeWorktree({ path: "D:/DESKTOP/novelfork/.novelfork-worktrees/draft-main" }),
      makeWorktree({ path: "D:/DESKTOP/novelfork/.novelfork-worktrees/feature-x" }),
    ]);
    expect(result.every((w) => w.externalReason === undefined)).toBe(true);
  });

  it("flags worktrees outside the project root as external via heuristic", () => {
    const result = classifyWorktrees([
      makeWorktree({ path: "D:/DESKTOP/novelfork" }),
      makeWorktree({ path: "D:/DESKTOP/sub2api/novelfork-legacy/.test-workspace/.novelfork-worktrees/feature-test" }),
    ]);
    expect(result[0].externalReason).toBeUndefined();
    expect(result[1].externalReason).toBe("heuristic");
  });

  it("respects backend-supplied isExternal flag over the heuristic", () => {
    const result = classifyWorktrees([
      makeWorktree({ path: "D:/DESKTOP/novelfork" }),
      makeWorktree({
        path: "D:/DESKTOP/novelfork/.novelfork-worktrees/child",
        isExternal: true,
      }),
      makeWorktree({
        path: "D:/elsewhere/project",
        isExternal: false,
      }),
    ]);
    expect(result[1].externalReason).toBe("backend");
    expect(result[2].externalReason).toBeUndefined();
  });

  it("is case- and separator-insensitive", () => {
    const result = classifyWorktrees([
      makeWorktree({ path: "D:\\DESKTOP\\Novelfork" }),
      makeWorktree({ path: "D:/desktop/novelfork/.novelfork-worktrees/draft" }),
    ]);
    expect(result.every((w) => w.externalReason === undefined)).toBe(true);
  });

  it("falls back to the first entry when no non-bare worktree exists", () => {
    const result = classifyWorktrees([
      makeWorktree({ path: "D:/bare-repo", bare: true }),
      makeWorktree({ path: "D:/bare-repo/linked", bare: true }),
      makeWorktree({ path: "D:/elsewhere", bare: true }),
    ]);
    expect(result[0].externalReason).toBeUndefined();
    expect(result[1].externalReason).toBeUndefined();
    expect(result[2].externalReason).toBe("heuristic");
  });

  it("hides external worktrees by default and includes them when requested", () => {
    const classified = classifyWorktrees([
      makeWorktree({ path: "D:/DESKTOP/novelfork" }),
      makeWorktree({ path: "D:/DESKTOP/sub2api/.novelfork-worktrees/feature-test" }),
    ]);

    expect(getVisibleWorktrees(classified, false).map((w) => w.path)).toEqual(["D:/DESKTOP/novelfork"]);
    expect(getVisibleWorktrees(classified, true)).toHaveLength(2);
  });
});
