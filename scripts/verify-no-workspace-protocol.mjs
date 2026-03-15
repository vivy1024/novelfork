/**
 * Standalone verification: checks that no workspace: protocol remains in package.json.
 *
 * Usage:
 *   node scripts/verify-no-workspace-protocol.mjs packages/cli packages/core
 *
 * Used by CI and as a pre-publish sanity check. The prepack script also runs
 * this check inline after replacement, but this script catches the case where
 * prepack is skipped entirely.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  process.stderr.write("Usage: node verify-no-workspace-protocol.mjs <pkg-dir> [<pkg-dir>...]\n");
  process.exit(1);
}

let failed = false;

for (const dir of dirs) {
  const packageJsonPath = join(dir, "package.json");
  const raw = await readFile(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw);

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
        process.stderr.write(`FAIL: ${dir} — ${field}.${name}: ${specifier}\n`);
        failed = true;
      }
    }
  }

  if (!failed) {
    process.stderr.write(`OK: ${dir}\n`);
  }
}

if (failed) {
  process.exit(1);
}
