/**
 * postpack hook — restores original package.json from backup.
 *
 * Shared by all publishable packages. Invoked as:
 *   "postpack": "node ../../scripts/restore-package-json.mjs"
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageDir = process.cwd();
const packageJsonPath = join(packageDir, "package.json");
const backupPath = join(packageDir, ".package.json.publish-backup");

async function main() {
  try {
    const original = await readFile(backupPath, "utf-8");
    await writeFile(packageJsonPath, original, "utf-8");
    await rm(backupPath, { force: true });
  } catch {
    // No backup means prepack found nothing to replace — fine.
  }
}

await main();
