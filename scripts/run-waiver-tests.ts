import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REQUIRED_RUNTIME_BUN_VERSION } from "./lib/isolated-runtime-build.ts";
import { createBunJUnitRunner } from "./lib/windows-ebusy-waiver-runner.ts";
import { runWaiverGate } from "./lib/windows-ebusy-waiver-gate.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const runtimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");
const migrationsRoot = join(runtimeRoot, "runtime-migrations");
const migrationJournal = join(migrationsRoot, "meta", "_journal.json");

function assertRuntimeMigrationAssets(): void {
	if (!existsSync(migrationJournal) || !statSync(migrationJournal).isFile()) {
		throw new Error(
			`Runtime test migrations are missing: ${migrationJournal}. Materialize the derived private Runtime before running tests.`,
		);
	}
}

const baselinePath = join(repositoryRoot, "scripts", "lib", "windows-ebusy-waiver-baseline.json");
const candidatesPath = join(repositoryRoot, "tmp", "windows-ebusy-waiver-candidates.json");

/**
 * 读取人工审阅过的豁免名单（JSON 字符串数组，键为 file > classname > name）。
 * 名单不存在时为空：所有失败（含 EBUSY）都按真实失败处理，直到有人审阅候选并把名单入库。
 */
function loadAllowList(): Set<string> {
	if (!existsSync(baselinePath)) return new Set();
	const parsed = JSON.parse(readFileSync(baselinePath, "utf8")) as unknown;
	if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
		throw new Error(`豁免名单格式错误：${baselinePath} 应为字符串数组`);
	}
	return new Set(parsed as string[]);
}

function resolvePinnedBun(): string {
	if (Bun.version === REQUIRED_RUNTIME_BUN_VERSION) return process.execPath;
	const executableName = process.platform === "win32" ? "bun.exe" : "bun";
	const extracted = join(repositoryRoot, "tmp", `bun-${REQUIRED_RUNTIME_BUN_VERSION}`, "extracted");
	const candidates = [
		process.env.NOVELFORK_RUNTIME_BUN?.trim(),
		...(existsSync(extracted)
			? readdirSync(extracted).map((entry) => join(extracted, entry, executableName))
			: []),
	].filter((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
	const match = candidates.find((candidate) => {
		const probe = Bun.spawnSync([candidate, "--version"], { stdout: "pipe", stderr: "ignore" });
		return probe.exitCode === 0 && probe.stdout.toString().trim() === REQUIRED_RUNTIME_BUN_VERSION;
	});
	if (!match) {
		throw new Error(
			`test:waiver 需要 Bun ${REQUIRED_RUNTIME_BUN_VERSION}：请解压到 tmp/bun-${REQUIRED_RUNTIME_BUN_VERSION}，或设置 NOVELFORK_RUNTIME_BUN。`,
		);
	}
	return match;
}

assertRuntimeMigrationAssets();
if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
	throw new Error(`Private Runtime is missing: ${runtimeRoot}. Materialize the Runtime tree before running tests.`);
}

const runSuite = createBunJUnitRunner({
	bunExecutable: resolvePinnedBun(),
	cwd: runtimeRoot,
	testPaths: ["."],
	migrationsDir: migrationsRoot,
});

const evaluation = await runWaiverGate({ runSuite, allowList: loadAllowList() });
for (const name of evaluation.waived) console.log(`waived (listed, EBUSY in every run): ${name}`);
for (const name of evaluation.unwaivedFailures) console.error(`unwaived failure: ${name}`);
// 候选只写到 tmp/ 供人工审阅；确认是环境问题后再手工并入名单文件并提交，不自动写名单。
writeFileSync(candidatesPath, `${JSON.stringify(evaluation.ebusyCandidates, null, 2)}
`);
console.log(`EBUSY candidates (${evaluation.ebusyCandidates.length}) written to ${candidatesPath} for review`);
process.exit(evaluation.exitCode);
