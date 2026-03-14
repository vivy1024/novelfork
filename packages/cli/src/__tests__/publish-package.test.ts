import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..", "..");
const workspaceRoot = resolve(cliDir, "..", "..");

async function extractPackedPackageJson(packDir: string) {
  execFileSync("npm", ["pack", "--pack-destination", packDir], {
    cwd: cliDir,
    env: process.env,
    encoding: "utf-8",
  });

  const tgzFiles = (await readdir(packDir)).filter((name) => name.endsWith(".tgz"));
  if (tgzFiles.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tgzFiles.length}`);
  }

  return execFileSync("tar", ["-xOf", join(packDir, tgzFiles[0]), "package/package.json"], {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });
}

describe("publish packaging", () => {
  it("replaces workspace dependencies before npm pack", async () => {
    const packDir = await mkdtemp(join(tmpdir(), "inkos-cli-pack-"));

    try {
      const packedPackageJson = JSON.parse(await extractPackedPackageJson(packDir));
      const corePackageJson = JSON.parse(
        await readFile(resolve(workspaceRoot, "packages/core/package.json"), "utf-8"),
      );

      expect(packedPackageJson.dependencies["@actalk/inkos-core"]).toBe(corePackageJson.version);
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });
});
