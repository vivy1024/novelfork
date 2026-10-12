import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { REQUIRED_RUNTIME_BUN_VERSION } from "./lib/isolated-runtime-build";
import { prepareRuntimeExecutionRoot } from "./runtime-execution";

const repositoryRoot = resolve(import.meta.dir, "..");
const migrationsRoot = join(
	repositoryRoot,
	"packages",
	"narrafork-runtime-private",
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
			`Runtime test migrations are missing: ${migrationJournal}. Materialize the derived private Runtime before running tests.`,
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
		// 默认测试使用临时 SQLite；PostgreSQL 集成测试必须自行创建隔离目标。
		NF_DATABASE_BACKEND: "sqlite",
		NARRAFORK_MIGRATIONS_DIR: migrationsRoot,
		NARRAFORK_TEST_REAL_HOME: homedir(),
		NARRAFORK_DEFER_WINDOWS_TEMP_CLEANUP: "1",
		// 产品代码的默认路径（全局配置、作者技能、市场数据）先看 NOVELFORK_HOME 再看 homedir()；
		// 开发者自己的值指向真实数据，测试必须覆盖。
		NOVELFORK_HOME: join(testRoot, "novelfork-home"),
		NOVELFORK_PROJECT_ROOT: projectRoot,
		NOVELFORK_BOOKS_ROOT: booksRoot,
		NOVELFORK_STORAGE_DB_PATH: join(projectRoot, "novelfork.db"),
		NOVELFORK_SESSION_STORE_DIR: join(projectRoot, "sessions"),
		TEMP: workspaceTestTempRoot,
		TMP: workspaceTestTempRoot,
		TMPDIR: workspaceTestTempRoot,
		// Runtime Git fixtures must not inherit a developer-machine checkout policy:
		// core.autocrlf=true changes snapshot bytes and makes clean-worktree tests platform-dependent.
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "core.autocrlf",
		GIT_CONFIG_VALUE_0: "false",
	};

	for (const name of ["NF_DATABASE_URL", "DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"]) {
		delete environment[name];
	}

	if (scope === "public") {
		// Public packages import Runtime modules but do not exercise the Runtime
		// instance-lock contract, so they need an explicit disposable data home.
		environment.NARRAFORK_HOME = join(testRoot, "runtime");
		environment.NARRAFORK_ALLOW_MULTIPLE = "1";
	} else {
		// Runtime's preload owns its isolated home and tests the lock itself.
		delete environment.NARRAFORK_HOME;
		delete environment.NARRAFORK_ALLOW_MULTIPLE;
	}

	const zstdExecutable = process.platform === "win32" ? "zstd.exe" : "zstd";
	if (existsSync(join(localZstdDirectory, zstdExecutable))) {
		environment.PATH = [localZstdDirectory, environment.PATH].filter(Boolean).join(delimiter);
	}
	return environment;
}

function bunVersionOf(executable: string): string | null {
	try {
		const probe = Bun.spawnSync([executable, "--version"], { stdout: "pipe", stderr: "ignore" });
		return probe.exitCode === 0 ? probe.stdout.toString().trim() : null;
	} catch {
		return null;
	}
}

/**
 * Runtime 测试必须跑在它 packageManager 声明的 Bun 上（与编译、发货 EXE 内嵌的同一版本）。
 * 用 PATH 上的旧 Bun 跑会出现大面积假红甚至 Bun 自身崩溃，等于没验证。
 * 解析顺序：当前进程 → NOVELFORK_RUNTIME_BUN → 仓库 tmp/bun-<版本>/extracted 下的解压版。
 */
function resolveRuntimeBun(): string {
	if (Bun.version === REQUIRED_RUNTIME_BUN_VERSION) return process.execPath;
	const executableName = process.platform === "win32" ? "bun.exe" : "bun";
	const extracted = join(repositoryRoot, "tmp", `bun-${REQUIRED_RUNTIME_BUN_VERSION}`, "extracted");
	const candidates = [
		process.env.NOVELFORK_RUNTIME_BUN?.trim(),
		...(existsSync(extracted)
			? readdirSync(extracted).map((entry) => join(extracted, entry, executableName))
			: []),
	].filter((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
	for (const candidate of candidates) {
		if (bunVersionOf(candidate) === REQUIRED_RUNTIME_BUN_VERSION) return candidate;
	}
	throw new Error(
		`Runtime 测试需要 Bun ${REQUIRED_RUNTIME_BUN_VERSION}（当前进程为 ${Bun.version}，未找到匹配的可执行文件）。` +
			`请把 ${REQUIRED_RUNTIME_BUN_VERSION} 前置到 PATH，或设置 NOVELFORK_RUNTIME_BUN 指向它。`,
	);
}

assertRuntimeMigrationAssets();
const runtimeBun = resolveRuntimeBun();
const runtimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");
if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
	throw new Error(
		`Private Runtime is missing: ${runtimeRoot}. Materialize the Runtime tree before running tests.`,
	);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// Do not use `pnpm -r test` here: Bun/pnpm can discover the local reference copy
// under 酒馆预设兼容/ and execute every public package twice. Keep this list
// explicit so the canonical root entry runs each current public package once.
const publicWorkspaceFilters = [
	"@vivy1024/novelfork-core",
	"@vivy1024/novelfork-novel-plugin",
	"@vivy1024/novelfork-product-runtime",
	"@vivy1024/novelfork-studio",
] as const;
// Bun's isolated linker records the installation path in its package links. Keep
// the short Runtime junction alive for public packages too, because they import
// Runtime modules through the canonical product path.
const runtimeExecutionRoot = prepareRuntimeExecutionRoot(runtimeRoot);
let publicExitCode = 1;
let runtimeExitCode = 0;
try {
	const publicTests = Bun.spawn(
		[
			pnpm,
			...publicWorkspaceFilters.flatMap((filter) => ["--filter", filter]),
			"run",
			"test",
		],
		{
			cwd: repositoryRoot,
			env: testEnvironment("public"),
			stdio: ["inherit", "inherit", "inherit"],
		},
	);
	publicExitCode = await publicTests.exited;
	if (publicExitCode === 0) {
		// Keep Runtime's real-timer recovery tests deterministic on Windows while
		// retaining fresh globals for every test file.
		const runtimeEnvironment = testEnvironment("runtime");
		// 测试内部还会按 PATH 再起 bun 子进程，必须同样落在要求的版本上。
		runtimeEnvironment.PATH = [dirname(runtimeBun), runtimeEnvironment.PATH].filter(Boolean).join(delimiter);
		const runtimeTests = Bun.spawn(
			[runtimeBun, "test", "--isolate", "--parallel=1", "--timeout=30000"],
			{
				// Keep Runtime module resolution on its canonical materialized path; the
				// short junction remains alive above only for public-package imports.
				cwd: runtimeRoot,
				env: runtimeEnvironment,
				stdio: ["inherit", "inherit", "inherit"],
			},
		);
		runtimeExitCode = await runtimeTests.exited;
	}
} finally {
	runtimeExecutionRoot.cleanup();
	rmSync(workspaceTestTempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
if (publicExitCode !== 0) process.exit(publicExitCode);
if (runtimeExitCode !== 0) process.exit(runtimeExitCode);
