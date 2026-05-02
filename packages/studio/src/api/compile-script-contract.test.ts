import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "..", "..");

describe("compile script contract", () => {
  it("routes root bun:compile through the studio compile pipeline", async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["bun:compile"]).toBe("pnpm --dir packages/studio compile");
  });

  it("does not expose the old root embedded-assets generator", async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["bun:embed-assets"]).toBeUndefined();
    expect(existsSync(join(repoRoot, "scripts", "generate-embedded-assets.mjs"))).toBe(false);
  });
});
