import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { prepareRuntimeExecutionRoot } from "./runtime-execution";

const repositoryRoot = resolve(import.meta.dir, "..");
const migrationsRoot = join(
	repositoryRoot,
	"packages",
	"narrafork-runtime-overlay",
	"runtime-migrations",
);
const migrationJournal = join(migrationsRoot, "meta", "_journal.json");
const localZstdDirectory = join(
	repositoryRoot,
	"packages",
	".narrafork-runtime-import",
	"tools",
	"zstd",
);
const workspaceTestTempRoot = mkdtempSync(join(tmpdir(), "novelfork-workspace-tests-"));

function assertRuntimeMigrationAssets(): void {
	if (!existsSync(migrationJournal) || !statSync(migrationJournal).isFile()) {
		throw new Error(
			`Runtime test migrations are missing: ${migrationJournal}. Initialize the private Runtime overlay before running tests.`,
		);
	}

	let journal: { entries?: unknown };
	try {
		journal = JSON.parse(readFileSync(migrationJournal, "utf8")) as { entries?: unknown };
	} catch (error) {
		throw new Error(`Runtime test migration journal is invalid: ${migrationJournal} (${String(error)})`);
	}
	if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
		throw new Error(`Runtime test migration journal has no entries: ${migrationJournal}`);
	}
}

function testEnvironment(scope: "public" | "runtime"): NodeJS.ProcessEnv {
	const testRoot = join(workspaceTestTempRoot, scope);
	const projectRoot = join(testRoot, "project");
	const booksRoot = join(projectRoot, "books");
	mkdirSync(booksRoot, { recursive: true });

	const environment: NodeJS.ProcessEnv = {
		...process.env,
		// Keep both suites separate from a running desktop executable and from
		// one another, including the controlled books root external bindings need.
		NARRAFORK_HOME: join(testRoot, "runtime"),
		// Runtime's test preload only honors an explicit NARRAFORK_HOME when the
		// multi-instance debug flag is set; the path itself remains isolated.
		NARRAFORK_ALLOW_MULTIPLE: "1",
		NARRAFORK_MIGRATIONS_DIR: migrationsRoot,
		NARRAFORK_DEFER_WINDOWS_TEMP_CLEANUP: "1",
		NOVELFORK_PROJECT_ROOT: projectRoot,
		NOVELFORK_BOOKS_ROOT: booksRoot,
		NOVELFORK_STORAGE_DB_PATH: join(projectRoot, "novelfork.db"),
		NOVELFORK_SESSION_STORE_DIR: join(projectRoot, "sessions"),
		TEMP: workspaceTestTempRoot,
		TMP: workspaceTestTempRoot,
		TMPDIR: workspaceTestTempRoot,
	};
	const zstdExecutable = process.platform === "win32" ? "zstd.exe" : "zstd";
	if (existsSync(join(localZstdDirectory, zstdExecutable))) {
		environment.PATH = [localZstdDirectory, environment.PATH].filter(Boolean).join(delimiter);
	}
	return environment;
}

assertRuntimeMigrationAssets();
const runtimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");
if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
	throw new Error(
		`Private Runtime is missing: ${runtimeRoot}. Materialize the Runtime tree before running tests.`,
	);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// Bun's isolated linker records the installation path in its package links. Keep
// the short Runtime junction alive for public packages too, because they import
// Runtime modules through the canonical product path.
const runtimeExecutionRoot = prepareRuntimeExecutionRoot(runtimeRoot);
let publicExitCode = 1;
let runtimeExitCode = 0;
try {
	const publicTests = Bun.spawn([pnpm, "-r", "test"], {
		cwd: repositoryRoot,
		env: testEnvironment("public"),
		stdio: ["inherit", "inherit", "inherit"],
	});
	publicExitCode = await publicTests.exited;
	if (publicExitCode === 0) {
		const runtimeTests = Bun.spawn([process.execPath, "test", "--isolate"], {
			cwd: runtimeExecutionRoot.path,
			env: testEnvironment("runtime"),
			stdio: ["inherit", "inherit", "inherit"],
		});
		runtimeExitCode = await runtimeTests.exited;
	}
} finally {
	runtimeExecutionRoot.cleanup();
	rmSync(workspaceTestTempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
if (publicExitCode !== 0) process.exit(publicExitCode);
if (runtimeExitCode !== 0) process.exit(runtimeExitCode);
