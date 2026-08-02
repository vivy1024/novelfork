import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { prepareRuntimeExecutionRoot } from "./runtime-execution";

const repositoryRoot = resolve(import.meta.dir, "..");
const runtimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");

if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
	throw new Error(
		`Private Runtime is missing: ${runtimeRoot}. Materialize the Runtime tree before running type checks.`,
	);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// Bun's isolated linker records the installation path in its package links. Keep
// the short Runtime junction alive for public packages too, because they import
// Runtime declarations through the canonical product path.
const runtimeExecutionRoot = prepareRuntimeExecutionRoot(runtimeRoot);
let publicExitCode = 1;
let runtimeExitCode = 0;
try {
	const publicTypecheck = Bun.spawn([pnpm, "-r", "typecheck"], {
		cwd: repositoryRoot,
		stdio: ["inherit", "inherit", "inherit"],
	});
	publicExitCode = await publicTypecheck.exited;
	if (publicExitCode === 0) {
		const runtimeTypecheck = Bun.spawn([process.execPath, "run", "typecheck"], {
			cwd: runtimeExecutionRoot.path,
			stdio: ["inherit", "inherit", "inherit"],
		});
		runtimeExitCode = await runtimeTypecheck.exited;
	}
} finally {
	runtimeExecutionRoot.cleanup();
}
if (publicExitCode !== 0) process.exit(publicExitCode);
if (runtimeExitCode !== 0) process.exit(runtimeExitCode);
