import { describe, expect, it } from "vitest";

import { REUSE_MATRIX, findReuseItem } from "./reuse-matrix";

const requiredPaths = [
  "packages/studio/src/pages/SettingsView.tsx",
  "packages/studio/src/pages/settings/RuntimeControlPanel.tsx",
  "packages/studio/src/components/Settings/ReleaseOverview.tsx",
  "packages/studio/src/components/Routines/Routines.tsx",
  "packages/studio/src/types/routines.ts",
  "packages/studio/src/api/routes/routines.ts",
  "packages/studio/src/components/writing-tools/*",
  "packages/studio/src/components/compliance/*",
  "packages/studio/src/pages/BibleView.tsx",
  "packages/studio/src/api/routes/bible.ts",
  "packages/studio/src/pages/BookDetail.tsx",
  "packages/studio/src/pages/ChapterReader.tsx",
] as const;

describe("Studio Next reuse matrix", () => {
  it("records every required reusable legacy asset before new frontend execution", () => {
    for (const path of requiredPaths) {
      const item = findReuseItem(path);
      expect(item?.path).toBe(path);
      expect(item?.decision).toMatch(/^(direct-reuse|wrap|reuse-logic|defer)$/);
      expect(item?.reason.length).toBeGreaterThan(8);
    }
  });

  it("documents active spec UI boundaries so new pages do not create second systems", () => {
    expect(REUSE_MATRIX.some((item) => item.spec === "writing-modes-v1" && item.decision === "defer")).toBe(true);
    expect(REUSE_MATRIX.some((item) => item.spec === "writing-tools-v1" && item.decision === "wrap")).toBe(true);
    expect(REUSE_MATRIX.some((item) => item.spec === "platform-compliance-v1" && item.decision === "direct-reuse")).toBe(true);
  });
});
