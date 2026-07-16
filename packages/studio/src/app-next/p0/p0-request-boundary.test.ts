import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const p0Root = join(process.cwd(), "src", "app-next", "p0");

describe("P0 Runtime request boundary", () => {
  it("keeps the isolated P0 shell free of legacy Studio API surfaces", async () => {
    const source = await Promise.all([
      readFile(join(p0Root, "RuntimeP0App.tsx"), "utf8"),
      readFile(join(p0Root, "RuntimeNarratorConversation.tsx"), "utf8"),
      readFile(join(p0Root, "RuntimeAuthGate.tsx"), "utf8"),
    ]).then((parts) => parts.join("\n"));

    for (const legacyPath of ["/api/sessions", "/api/providers", "/api/settings", "/api/onboarding", "/api/tools/list", "/api/upload", "/api/workspace"]) {
      expect(source).not.toContain(legacyPath);
    }
    expect(source).toContain("createRuntimeProductClient");
    expect(source).toContain("RuntimeAuthGate");
    expect(source).toContain("RuntimeNarratorConversation");
    expect(source).toContain("RuntimeNarratorPanelMount");
    expect(source).not.toContain("NovelForkNarratorPanelHost");
    expect(source).not.toContain("createNarrator");
  });

  it("keeps AgentShell as the product root while loading its data from Runtime", async () => {
    const studioNextApp = await readFile(join(process.cwd(), "src", "app-next", "StudioNextApp.tsx"), "utf8");
    const exportedRoot = studioNextApp.slice(studioNextApp.lastIndexOf("export function StudioNextApp"));

    expect(exportedRoot).toContain("useRuntimeShellData(runtimeClient, narratorClient, activeNarratorId)");
    expect(exportedRoot).toContain("<AgentShell");
    expect(exportedRoot).not.toContain("RuntimeP0App");
  });
});
