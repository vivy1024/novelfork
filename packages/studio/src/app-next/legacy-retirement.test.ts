import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const retiredBuildPaths = [
  "src/app-next/StudioApp.tsx",
  "src/app-next/StudioApp.test.tsx",
  "src/app-next/editor/**",
  "src/app-next/conversation/ConversationPanel.tsx",
  "src/app-next/conversation/ConversationPanel.test.tsx",
  "src/app-next/conversation/GitChangesView.tsx",
  "src/app-next/hooks/useStudioData.ts",
  "src/app-next/workspace/**",
  "src/components/split-view/**",
  "src/components/ChatWindow.tsx",
  "src/components/ChatWindow.test.tsx",
  "src/components/ChatWindowManager.tsx",
] as const;

function readStudioTsconfig(): { exclude?: string[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "tsconfig.json"), "utf-8")) as { exclude?: string[] };
}

describe("legacy three-column retirement", () => {
  it("keeps failed three-column experiment modules outside the Studio typecheck build path", () => {
    const tsconfig = readStudioTsconfig();

    expect(tsconfig.exclude).toEqual(expect.arrayContaining([...retiredBuildPaths]));
  });
});
