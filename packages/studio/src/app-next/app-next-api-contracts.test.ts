import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appNextRoot = join(process.cwd(), "src", "app-next");

describe("app-next API contracts", () => {
  it("keeps global search wired to the implemented POST /api/search contract", async () => {
    const source = await readFile(join(appNextRoot, "search", "SearchPage.tsx"), "utf-8");

    expect(source).toContain("fetchJson<{ results:");
    expect(source).toContain("/search");
    expect(source).toContain("method: \"POST\"");
    expect(source).not.toContain("/search?q=");
    expect(source).not.toContain("{ hits:");
  });

  it("uses existing workflow APIs instead of dead /api/agents or /api/scheduler endpoints", async () => {
    const source = await readFile(join(appNextRoot, "workflow", "WorkflowPage.tsx"), "utf-8");

    expect(source).toContain("/agent/config");
    expect(source).toContain("/daemon");
    expect(source).not.toContain("/agents");
    expect(source).not.toContain("/scheduler");
  });

  it("loads project model overrides from the implemented endpoint", async () => {
    const source = await readFile(join(appNextRoot, "settings", "ProjectConfigSection.tsx"), "utf-8");

    expect(source).toContain("/project/model-overrides");
    expect(source).not.toContain("/project/overrides");
  });

  it("renders the shell version from package metadata instead of hard-coding a release", async () => {
    const source = await readFile(join(appNextRoot, "components", "layouts.tsx"), "utf-8");

    expect(source).toContain("studioPackageJson.version");
    expect(source).toContain("v{STUDIO_VERSION}");
    expect(source).not.toContain("v0.0.1");
    expect(source).not.toContain("v0.0.2");
  });
});
