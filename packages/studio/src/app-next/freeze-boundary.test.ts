import { describe, expect, it } from "vitest";

import { FRONTEND_REWRITE_BOUNDARY } from "./freeze-boundary";

describe("Studio frontend rewrite boundary", () => {
  it("documents the freeze -> bypass rewrite -> validation -> replacement sequence", () => {
    expect(FRONTEND_REWRITE_BOUNDARY.sequence).toEqual([
      "freeze-legacy-frontend",
      "build-bypass-next-entry",
      "validate-first-phase-paths",
      "replace-after-acceptance",
    ]);
  });

  it("keeps the legacy frontend as fallback and limits allowed legacy edits", () => {
    expect(FRONTEND_REWRITE_BOUNDARY.legacyFallback).toBe(true);
    expect(FRONTEND_REWRITE_BOUNDARY.allowedLegacyEditTypes).toEqual([
      "build-fix",
      "security-fix",
      "blocking-runtime-fix",
    ]);
  });
});
