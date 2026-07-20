import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(
  process.env.NOVELFORK_BUILD_WORKSPACE_ROOT ?? resolve(import.meta.dir, ".."),
);
const studioRoot = join(repositoryRoot, "packages", "studio");
const defaultRuntimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");

export function resolveProductRuntimeRoot(
  runtimeRootOverride = process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT,
): string {
  return runtimeRootOverride ? resolve(runtimeRootOverride) : defaultRuntimeRoot;
}

const runtimeRoot = resolveProductRuntimeRoot();
if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
  throw new Error(`Product Runtime directory is missing: ${runtimeRoot}`);
}

const runtimeFrontendDir = join(runtimeRoot, "dist", "frontend");
const indexFile = join(runtimeFrontendDir, "index.html");

rmSync(runtimeFrontendDir, { recursive: true, force: true });

const build = Bun.spawnSync([process.execPath, "run", "build"], {
  cwd: studioRoot,
  env: process.env,
  stdio: ["inherit", "inherit", "inherit"],
});

if (build.exitCode !== 0) {
  console.error("Product Studio build failed; no frontend artifact was retained.");
  process.exit(build.exitCode || 1);
}

if (!existsSync(indexFile)) {
  console.error(`Studio build did not produce ${indexFile}`);
  process.exit(1);
}

console.log(`Product Studio built for Runtime: ${runtimeFrontendDir}`);
