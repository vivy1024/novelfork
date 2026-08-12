import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dir, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
type CheckMode = "all" | "tests" | "typecheck";

function gitOutput(args: string[], cwd = repositoryRoot): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return "";
	}
}

function lines(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim().replaceAll("\\", "/"))
		.filter(Boolean);
}

function collectChangedFiles(): string[] {
	const trackedChanges = gitOutput(["diff", "--name-only", "--diff-filter=ACMRTD", "HEAD"]);
	const stagedChanges = gitOutput(["diff", "--cached", "--name-only", "--diff-filter=ACMRTD"]);
	const untrackedChanges = gitOutput(["ls-files", "--others", "--exclude-standard"]);
	return [...new Set([...lines(trackedChanges), ...lines(stagedChanges), ...lines(untrackedChanges)])];
}

function hasDirtySubmodule(path: string): boolean {
	return Boolean(gitOutput(["status", "--porcelain"], join(repositoryRoot, path)));
}

function packageNameForDirectory(directory: string, root = repositoryRoot): string | null {
	const manifestPath = join(root, "packages", directory, "package.json");
	if (!existsSync(manifestPath)) return null;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };
		return typeof manifest.name === "string" ? manifest.name : null;
	} catch {
		return null;
	}
}

export function changedPackageDirectories(files: readonly string[]): string[] {
	return [...new Set(files.flatMap((file) => {
		const match = /^packages\/([^/]+)(?:\/|$)/.exec(file);
		return match ? [match[1]] : [];
	}))];
}

export function changedPackageNames(files: readonly string[], root = repositoryRoot): string[] {
	return changedPackageDirectories(files)
		.map((directory) => packageNameForDirectory(directory, root))
		.filter((name): name is string => Boolean(name));
}

export function fullCheckReasons(files: readonly string[], dirtyOverlay = false): string[] {
	const reasons = new Set<string>();
	for (const file of files) {
		if (/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(file) || /(^|\/)package\.json$/.test(file)) {
			reasons.add("工作区依赖或包清单变更");
		}
		if (/(^|\/)tsconfig[^/]*\.json$/.test(file)) reasons.add("TypeScript 配置变更");
		if (/^scripts\/(run-workspace|run-changed|runtime|import-narrafork-runtime|materialize-runtime-overlay|compile)/.test(file)) {
			reasons.add("测试、Runtime 或编译基础设施变更");
		}
		if (/^packages\/narrafork-runtime-(private|overlay)(\/|$)/.test(file)) {
			reasons.add("Runtime 或 overlay 变更");
		}
		if (file === "main.ts") reasons.add("产品启动入口变更");
	}
	if (dirtyOverlay) reasons.add("overlay 子仓库存在未提交改动");
	return [...reasons];
}

async function runScript(script: string, filters: string[], dryRun: boolean): Promise<void> {
	const commandArgs = filters.flatMap((filter) => ["--filter", filter]);
	commandArgs.push("--if-present", script);
	if (dryRun) {
		console.log(`将执行：pnpm ${commandArgs.join(" ")}`);
		return;
	}
	const child = Bun.spawn([pnpm, ...commandArgs], {
		cwd: repositoryRoot,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) process.exit(exitCode);
}

async function runFull(script: "test:full" | "typecheck:full", dryRun: boolean): Promise<void> {
	if (dryRun) {
		console.log(`将执行：pnpm run ${script}`);
		return;
	}
	const child = Bun.spawn([pnpm, "run", script], {
		cwd: repositoryRoot,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) process.exit(exitCode);
}

async function main(): Promise<void> {
	const args = new Set(Bun.argv.slice(2));
	const mode: CheckMode = args.has("--tests-only") ? "tests" : args.has("--typecheck-only") ? "typecheck" : "all";
	const dryRun = args.has("--dry-run");
	const files = collectChangedFiles();
	const packageNames = changedPackageNames(files).filter(
		(name) => !name.includes("narrafork-runtime-private") && !name.includes("narrafork-runtime-overlay"),
	);
	const fullReasons = fullCheckReasons(files, hasDirtySubmodule("packages/narrafork-runtime-overlay"));
	const hasRelevantPackageChange = packageNames.length > 0;

	if (fullReasons.length > 0) {
		console.log(`检测到需要全量验证的改动：${fullReasons.join("；")}`);
		if (mode !== "tests") await runFull("typecheck:full", dryRun);
		if (mode !== "typecheck") await runFull("test:full", dryRun);
	} else if (!hasRelevantPackageChange) {
		console.log("当前没有需要执行包级测试的改动，跳过验证。");
	} else {
		console.log(`增量验证包：${packageNames.join(", ")}`);
		if (mode !== "tests") await runScript("typecheck", packageNames.map((name) => `...${name}`), dryRun);
		if (mode !== "typecheck") await runScript("test", packageNames, dryRun);
	}

	if (args.has("--build")) {
		if (dryRun) {
			console.log("将执行：pnpm build");
			return;
		}
		const child = Bun.spawn([pnpm, "build"], {
			cwd: repositoryRoot,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await child.exited;
		if (exitCode !== 0) process.exit(exitCode);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
