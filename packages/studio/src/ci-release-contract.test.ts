import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CI and release workflow contracts", () => {
  it("uses the actual master branch and Node 22 in CI", async () => {
    const ci = await readFile(join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml"), "utf-8");

    expect(ci).toContain("branches: [master]");
    expect(ci).toContain("node-version: [22]");
    expect(ci).not.toContain("branches: [master, main]");
    expect(ci).not.toContain("node-version: [20, 22]");
  });

  it("builds and uploads the Bun single-exe release artifact", async () => {
    const release = await readFile(join(process.cwd(), "..", "..", ".github", "workflows", "release.yml"), "utf-8");

    expect(release).toContain("oven-sh/setup-bun");
    expect(release).toContain("pnpm --dir packages/studio compile");
    expect(release).toContain("dist/novelfork-v${{ needs.publish-canary.outputs.release_version }}-linux-x64");
    expect(release).toContain("softprops/action-gh-release");
    expect(release).toContain("files:");
    expect(release).not.toContain("node-version: [20, 22]");
  });
});
