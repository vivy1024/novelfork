import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CI and release workflow contracts", () => {
  it("keeps public CI manual-only and points to the local release gate", async () => {
    const ci = await readFile(join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml"), "utf-8");

    expect(ci).toContain("workflow_dispatch:");
    expect(ci).toContain("noop:");
    expect(ci).toContain("Public CI disabled");
    expect(ci).toContain("Release gate: local tests + Windows EXE + EXE verification.");
    expect(ci).not.toContain("branches:");
    expect(ci).not.toContain("node-version:");
  });

  it("keeps public release manual-only without pretending to publish artifacts", async () => {
    const release = await readFile(join(process.cwd(), "..", "..", ".github", "workflows", "release.yml"), "utf-8");

    expect(release).toContain("workflow_dispatch:");
    expect(release).toContain("noop:");
    expect(release).toContain("Public release workflow disabled");
    expect(release).toContain("Automatic GitHub Release is intentionally disabled.");
    expect(release).toContain("local compile + EXE verification");
    expect(release).not.toContain("oven-sh/setup-bun");
    expect(release).not.toContain("softprops/action-gh-release");
  });
});
