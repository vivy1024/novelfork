/**
 * prepublishOnly guard — aborts publish if package.json still contains workspace: protocol.
 *
 * This runs AFTER prepack (which replaces workspace:* with real versions)
 * but BEFORE the actual upload. If prepack was skipped or failed silently,
 * this script catches it and prevents a broken publish.
 *
 * Usage in each publishable package:
 *   "prepublishOnly": "node ../../scripts/verify-no-workspace-protocol.mjs"
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const packageJsonPath = join(process.cwd(), "package.json");
const raw = await readFile(packageJsonPath, "utf-8");
const pkg = JSON.parse(raw);

const violations = [];

for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const [name, specifier] of Object.entries(deps)) {
    if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
      violations.push(`  ${field}.${name}: ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `\n[ERROR] Cannot publish: package.json still contains workspace: protocol references.\n` +
    `This means the prepack script did not run or failed silently.\n\n` +
    `Violations:\n${violations.join("\n")}\n\n` +
    `Fix: run "node ../../scripts/prepare-package-for-publish.mjs" manually,\n` +
    `or check that "prepack" is configured in package.json scripts.\n\n`,
  );
  process.exit(1);
}
