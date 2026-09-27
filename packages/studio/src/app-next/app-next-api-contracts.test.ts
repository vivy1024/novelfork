import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appNextRoot = join(process.cwd(), "src", "app-next");

describe("app-next API contracts", () => {
  it("keeps global search wired to the implemented Runtime /api/search contract", async () => {
    const pageSource = await readFile(join(appNextRoot, "search", "SearchPage.tsx"), "utf-8");
    const clientSource = await readFile(join(appNextRoot, "search", "runtime-search.ts"), "utf-8");

    expect(pageSource).toContain("createRuntimeSearchClient");
    expect(clientSource).toContain("SEARCH_API_PATH");
    expect(clientSource).toContain("appendApiQuery(SEARCH_API_PATH, params)");
    expect(clientSource).toContain("new URLSearchParams({ q: query, entities })");
    expect(clientSource).not.toContain("/search?q=");
    expect(clientSource).not.toContain("{ hits:");
  });

  it("renders the shell version from package metadata instead of hard-coding a release", async () => {
    const source = await readFile(join(appNextRoot, "components", "layouts.tsx"), "utf-8");

    expect(source).toContain("studioPackageJson.version");
    expect(source).toContain("v{STUDIO_VERSION}");
    expect(source).not.toContain("v0.0.1");
    expect(source).not.toContain("v0.0.2");
  });
});
