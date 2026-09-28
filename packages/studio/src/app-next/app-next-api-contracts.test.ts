import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appNextRoot = join(process.cwd(), "src", "app-next");

describe("app-next API contracts", () => {
  it("renders the shell version from package metadata instead of hard-coding a release", async () => {
    const source = await readFile(join(appNextRoot, "components", "layouts.tsx"), "utf-8");

    expect(source).toContain("studioPackageJson.version");
    expect(source).toContain("v{STUDIO_VERSION}");
    expect(source).not.toContain("v0.0.1");
    expect(source).not.toContain("v0.0.2");
  });
});
