#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type RuntimeOverlayReplayOperationResult,
	replayRuntimeOverlay,
} from "./runtime-overlay";

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_TARGET = join(
	DEFAULT_REPOSITORY_ROOT,
	"packages",
	"narrafork-runtime-private",
);
const DEFAULT_OVERLAY = join(
	DEFAULT_REPOSITORY_ROOT,
	"packages",
	"narrafork-runtime-overlay",
);
const PRIVATE_TEMP_ROOT_RELATIVE = join(
	"packages",
	".narrafork-runtime-import",
);
const LOCK_FILE_NAME = "UPSTREAM.lock.json";
const sha256Pattern = /^[0-9a-f]{64}$/i;

export interface ImportRuntimeOptions {
	readonly source: string;
	readonly target?: string;
	/** Versioned, product-agnostic Runtime overlay applied to the archive staging tree. */
	readonly overlayRoot?: string;
	readonly dryRun?: boolean;
	/** @deprecated Replacement is allowed only when target still exactly matches its UPSTREAM.lock baseline. */
	readonly replace?: boolean;
	readonly reportOnly?: boolean;
	/** Test seam; the CLI always uses the actual NovelFork repository root. */
	readonly repositoryRoot?: string;
}

export interface RuntimeManagedOverlayOperation {
	readonly id: string;
	readonly target: string;
	readonly sha256: string;
}

/** Exact add/patch outputs produced by the overlay during this import. */
export interface RuntimeManagedOverlay {
	readonly operations: readonly RuntimeManagedOverlayOperation[];
}

export interface UpstreamLock {
	readonly schemaVersion: 1;
	readonly repository: string;
	readonly remote: string;
	readonly commit: string;
	readonly tree: string;
	readonly branch: string;
	readonly version: string;
	readonly importedAt: string;
	readonly trackedFileCount: number;
	readonly importMethod: "git-archive";
	/** Optional for backward compatibility with locks written before overlay tracking. */
	readonly managedOverlay?: RuntimeManagedOverlay;
}

export interface ImportRuntimeResult {
	readonly source: string;
	readonly target: string;
	readonly dryRun: boolean;
	readonly replaced: boolean;
	readonly lock: UpstreamLock;
	readonly overlayOperations: readonly RuntimeOverlayReplayOperationResult[];
}

export type RuntimeCapability =
	| "agent-runtime"
	| "security-permissions"
	| "context-prompt"
	| "realtime-recovery"
	| "tool-execution"
	| "persistence-database"
	| "terminal-pty"
	| "product-integration"
	| "build-packaging"
	| "tests"
	| "documentation"
	| "other";

export interface RuntimeChangedFile {
	readonly status: string;
	readonly path: string;
	readonly previousPath?: string;
	readonly capability: RuntimeCapability;
}

export interface RuntimeImpactReport {
	readonly source: string;
	readonly target: string;
	readonly previousLock: UpstreamLock;
	readonly nextLock: UpstreamLock;
	readonly changedFiles: readonly RuntimeChangedFile[];
	readonly capabilityFiles: Readonly<
		Partial<Record<RuntimeCapability, readonly string[]>>
	>;
	readonly targetModifications: readonly RuntimeChangedFile[];
}

interface CommandResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

async function runCommand(
	command: readonly string[],
	cwd: string,
): Promise<CommandResult> {
	const process = Bun.spawn(command, {
		cwd,
		env: globalThis.process.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { exitCode, stdout, stderr };
}

async function requireCommand(
	command: readonly string[],
	cwd: string,
	purpose: string,
): Promise<string> {
	const result = await runCommand(command, cwd);
	if (result.exitCode !== 0) {
		const detail =
			result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
		throw new Error(`${purpose}失败：${detail}`);
	}
	return result.stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function normalizeForComparison(path: string): string {
	const normalized = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSameOrInside(path: string, parent: string): boolean {
	const childKey = normalizeForComparison(path);
	const parentKey = normalizeForComparison(parent);
	return childKey === parentKey || childKey.startsWith(`${parentKey}/`);
}

async function canonicalTargetPath(target: string): Promise<string> {
	if (await pathExists(target)) return realpath(target);
	const parent = await realpath(dirname(target));
	return join(parent, basename(target));
}

function repositoryName(remote: string): string {
	const scpMatch = remote.match(/^[^@]+@[^:]+:(.+)$/);
	const withoutScheme =
		scpMatch?.[1] ?? remote.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "");
	return withoutScheme.replace(/^\/+/, "").replace(/\.git$/i, "") || remote;
}

async function assertCleanSource(source: string): Promise<void> {
	const status = await requireCommand(
		["git", "status", "--porcelain", "--untracked-files=all"],
		source,
		"读取 source 状态",
	);
	if (status.length > 0) throw new Error("source 不是 clean Git checkout");
	await requireCommand(
		["git", "diff", "--exit-code", "--"],
		source,
		"检查 source 工作树",
	);
	await requireCommand(
		["git", "diff", "--cached", "--exit-code", "--"],
		source,
		"检查 source 暂存区",
	);
}

async function assertPrivatePathsIgnored(
	target: string,
	repositoryRoot: string,
): Promise<{ root: string; tempRoot: string }> {
	const root = await realpath(repositoryRoot);
	const topLevel = await requireCommand(
		["git", "rev-parse", "--show-toplevel"],
		root,
		"验证 NovelFork Git 仓库",
	);
	if (
		normalizeForComparison(await realpath(topLevel)) !==
		normalizeForComparison(root)
	) {
		throw new Error("repositoryRoot 不是 NovelFork Git toplevel");
	}
	if (!isSameOrInside(target, root)) {
		throw new Error("target 必须位于 NovelFork Git 仓库内，才能验证忽略规则");
	}

	const tempRoot = join(root, PRIVATE_TEMP_ROOT_RELATIVE);
	const probes = [
		{ name: "target", path: join(target, ".novelfork-private-import-probe") },
		{ name: "临时根", path: join(tempRoot, ".novelfork-private-import-probe") },
	];
	for (const probe of probes) {
		const result = await runCommand(
			["git", "check-ignore", "--quiet", "--no-index", "--", probe.path],
			root,
		);
		if (result.exitCode !== 0) {
			const relativePath = relative(root, dirname(probe.path)).replaceAll(
				sep,
				"/",
			);
			throw new Error(
				`${probe.name}未被 NovelFork Git ignore：${relativePath}`,
			);
		}
	}
	return { root, tempRoot };
}

async function readUpstreamLock(
	source: string,
): Promise<{ lock: UpstreamLock; trackedPaths: string[] }> {
	// Resolve HEAD once, then bind every content-derived metadata field to that immutable commit.
	const commit = await requireCommand(
		["git", "rev-parse", "HEAD"],
		source,
		"读取 HEAD",
	);
	const [tree, remote, branchResult, packageJson, trackedOutput] =
		await Promise.all([
			requireCommand(
				["git", "rev-parse", `${commit}^{tree}`],
				source,
				"读取 Git tree hash",
			),
			requireCommand(
				["git", "remote", "get-url", "origin"],
				source,
				"读取 remote origin",
			),
			runCommand(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], source),
			requireCommand(
				["git", "show", `${commit}:package.json`],
				source,
				"读取 package.json",
			),
			requireCommand(
				["git", "ls-tree", "-r", "--name-only", "-z", commit],
				source,
				"读取 tracked 文件清单",
			),
		]);

	let parsedPackage: { version?: unknown };
	try {
		parsedPackage = JSON.parse(packageJson) as { version?: unknown };
	} catch {
		throw new Error("HEAD:package.json 不是有效 JSON");
	}
	if (
		typeof parsedPackage.version !== "string" ||
		parsedPackage.version.length === 0
	) {
		throw new Error("HEAD:package.json 缺少 version");
	}

	const trackedPaths = trackedOutput.split("\0").filter(Boolean);
	if (trackedPaths.includes(LOCK_FILE_NAME)) {
		throw new Error(`source 已跟踪保留文件 ${LOCK_FILE_NAME}`);
	}

	return {
		lock: {
			schemaVersion: 1,
			repository: repositoryName(remote),
			remote,
			commit,
			tree,
			branch:
				branchResult.exitCode === 0 ? branchResult.stdout.trim() : "DETACHED",
			version: parsedPackage.version,
			importedAt: new Date().toISOString(),
			trackedFileCount: trackedPaths.length,
			importMethod: "git-archive",
		},
		trackedPaths,
	};
}

function isManagedOverlay(value: unknown): value is RuntimeManagedOverlay {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<RuntimeManagedOverlay>;
	if (!Array.isArray(candidate.operations)) return false;
	const ids = new Set<string>();
	return candidate.operations.every((operation) => {
		if (!operation || typeof operation !== "object") return false;
		const entry = operation as Partial<RuntimeManagedOverlayOperation>;
		if (
			typeof entry.id !== "string" ||
			entry.id.length === 0 ||
			ids.has(entry.id) ||
			typeof entry.target !== "string" ||
			entry.target.length === 0 ||
			typeof entry.sha256 !== "string" ||
			!sha256Pattern.test(entry.sha256)
		)
			return false;
		ids.add(entry.id);
		return true;
	});
}

function isUpstreamLock(value: unknown): value is UpstreamLock {
	if (!value || typeof value !== "object") return false;
	const lock = value as Partial<UpstreamLock>;
	return (
		lock.schemaVersion === 1 &&
		typeof lock.repository === "string" &&
		typeof lock.remote === "string" &&
		typeof lock.commit === "string" &&
		/^[0-9a-f]{40}$/i.test(lock.commit) &&
		typeof lock.tree === "string" &&
		/^[0-9a-f]{40}$/i.test(lock.tree) &&
		typeof lock.branch === "string" &&
		typeof lock.version === "string" &&
		typeof lock.importedAt === "string" &&
		typeof lock.trackedFileCount === "number" &&
		lock.importMethod === "git-archive" &&
		(lock.managedOverlay === undefined || isManagedOverlay(lock.managedOverlay))
	);
}

async function readInstalledLock(target: string): Promise<UpstreamLock> {
	const lockPath = join(target, LOCK_FILE_NAME);
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(lockPath, "utf8"));
	} catch (error) {
		throw new Error(
			`target 缺少有效 ${LOCK_FILE_NAME}，不能证明其上游基线或安全替换：${String(error)}`,
		);
	}
	if (!isUpstreamLock(parsed))
		throw new Error(`target 的 ${LOCK_FILE_NAME} 格式无效`);
	return parsed;
}

export function classifyRuntimeCapability(filePath: string): RuntimeCapability {
	const value = filePath.toLowerCase().replaceAll("\\", "/");
	if (
		/(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
			value,
		)
	)
		return "tests";
	if (/\.md$|(^|\/)docs?\//.test(value)) return "documentation";
	if (
		/(^|\/)(?:package\.json|bun\.lock|tsconfig[^/]*\.json)$|(^|\/)(?:scripts?|build|release|docker)(\/|$)/.test(
			value,
		)
	)
		return "build-packaging";
	if (/(?:pty|terminal|shell|process-manager)/.test(value))
		return "terminal-pty";
	if (
		/(?:sqlite|database|storage|drizzle|migration|repository|store)/.test(value)
	)
		return "persistence-database";
	if (/(?:permission|auth|security|sandbox|secret|trust)/.test(value))
		return "security-permissions";
	if (
		/(?:websocket|(^|\/)ws(?:\.|\/)|recovery|transport|stream|sse)/.test(value)
	)
		return "realtime-recovery";
	if (/(?:compact|prompt|context|token|memory)/.test(value))
		return "context-prompt";
	if (/(?:tool|mcp|skill|browser|bash|executor)/.test(value))
		return "tool-execution";
	if (/(?:novel|product|contract|route|binding)/.test(value))
		return "product-integration";
	if (/(?:agent|session|message|provider|model|narrator)/.test(value))
		return "agent-runtime";
	return "other";
}

function parseNameStatus(output: string): RuntimeChangedFile[] {
	if (!output) return [];
	const fields = output.split("\0").filter((field) => field.length > 0);
	const changed: RuntimeChangedFile[] = [];
	for (let index = 0; index < fields.length; ) {
		const status = fields[index];
		index += 1;
		if (!status) throw new Error("无法解析 Git 状态输出");
		if (status.startsWith("R") || status.startsWith("C")) {
			const previousPath = fields[index++];
			const filePath = fields[index++];
			if (!previousPath || !filePath)
				throw new Error("无法解析 Git rename/copy 差异输出");
			changed.push({
				status,
				previousPath,
				path: filePath,
				capability: classifyRuntimeCapability(filePath),
			});
			continue;
		}
		const filePath = fields[index++];
		if (!filePath) throw new Error("无法解析 Git 差异输出");
		changed.push({
			status,
			path: filePath,
			capability: classifyRuntimeCapability(filePath),
		});
	}
	return changed;
}

async function changedFilesBetween(
	source: string,
	previousCommit: string,
	nextCommit: string,
): Promise<RuntimeChangedFile[]> {
	const commitCheck = await runCommand(
		["git", "cat-file", "-e", `${previousCommit}^{commit}`],
		source,
	);
	if (commitCheck.exitCode !== 0) {
		throw new Error(
			`新 source 不包含 UPSTREAM.lock 基线 commit ${previousCommit}；请获取完整历史后生成影响报告`,
		);
	}
	const output = await requireCommand(
		[
			"git",
			"diff",
			"--name-status",
			"-z",
			"--find-renames",
			previousCommit,
			nextCommit,
			"--",
		],
		source,
		"计算上游差异",
	);
	return parseNameStatus(output);
}

const RUNTIME_LOCAL_ARTIFACT_PREFIXES = [
	".git/",
	"node_modules/",
	"dist/",
	"drizzle/",
	"runtime-migrations/",
	"server/generated/",
	".worktrees/",
	".runtime-e2e/",
	".kiro-dumps/",
	".perf-analysis/",
	".narrafork/",
	"analyze/",
	"analyze2/",
	"mitm-dump/",
] as const;

function isRuntimeLocalArtifact(filePath: string): boolean {
	const normalized = filePath.replaceAll("\\", "/");
	if (
		RUNTIME_LOCAL_ARTIFACT_PREFIXES.some((prefix) =>
			normalized.startsWith(prefix),
		)
	)
		return true;
	if (
		normalized === "frontend/routeTree.gen.ts" ||
		normalized === "package-lock.json" ||
		normalized === "tsr.config.json" ||
		normalized === "docs/plugin-system/楠屾敹璁板綍.md"
	)
		return true;
	return /(?:^|\/)(?:\.tmp-narrafork-home\.|start-home-|test-home(?:\/|$))|(?:\.db(?:-journal|-wal|-shm)?|\.log|\.heapsnapshot)$/.test(
		normalized,
	);
}

async function collectFiles(
	root: string,
	current = "",
	options: {
		includeLocalArtifacts?: boolean;
		baselinePaths?: ReadonlySet<string>;
	} = {},
): Promise<string[]> {
	const directory = join(root, current);
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relativePath = current ? join(current, entry.name) : entry.name;
		const normalized = relativePath.replaceAll(sep, "/");
		if (entry.isDirectory()) {
			const prefix = `${normalized}/`;
			const containsBaselineFile = options.baselinePaths
				? [...options.baselinePaths].some((filePath) =>
						filePath.startsWith(prefix),
					)
				: false;
			if (
				options.includeLocalArtifacts ||
				!isRuntimeLocalArtifact(prefix) ||
				containsBaselineFile
			) {
				files.push(...(await collectFiles(root, relativePath, options)));
			}
		} else {
			files.push(normalized);
		}
	}
	return files;
}

async function sha256File(path: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

function buffersEqualIgnoringCrLf(left: Buffer, right: Buffer): boolean {
	if (left.equals(right)) return true;
	if (left.includes(0) || right.includes(0)) return false;
	try {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		return decoder.decode(left).replaceAll("\r\n", "\n") ===
			decoder.decode(right).replaceAll("\r\n", "\n");
	} catch {
		return false;
	}
}

async function targetChangesFromCommit(
	source: string,
	target: string,
	commit: string,
	managedOverlay?: RuntimeManagedOverlay,
	acceptedManagedOverlay?: RuntimeManagedOverlay,
): Promise<RuntimeChangedFile[]> {
	const runRoot = await mkdtemp(join(tmpdir(), "novelfork-runtime-baseline-"));
	const archive = join(runRoot, "baseline.tar");
	const baseline = join(runRoot, "baseline");
	await mkdir(baseline);
	try {
		const commitCheck = await runCommand(
			["git", "cat-file", "-e", `${commit}^{commit}`],
			source,
		);
		if (commitCheck.exitCode !== 0) {
			throw new Error(
				`新 source 不包含 target 基线 commit ${commit}；为避免覆盖本地修改，拒绝替换`,
			);
		}
		await requireCommand(
			[
				"git",
				"-c",
				"core.autocrlf=false",
				"archive",
				"--format=tar",
				"--output",
				archive,
				commit,
			],
			source,
			"导出 target 上游基线",
		);
		await requireCommand(
			["tar", "-xf", basename(archive), "-C", basename(baseline)],
			runRoot,
			"解压 target 上游基线",
		);

		const baselinePaths = await collectFiles(baseline, "", {
			includeLocalArtifacts: true,
		});
		const baselineSet = new Set(baselinePaths);
		const targetPaths = await collectFiles(target, "", {
			baselinePaths: baselineSet,
		});
		const targetSet = new Set(
			targetPaths.filter(
				(file) =>
					file !== LOCK_FILE_NAME &&
					(baselineSet.has(file) || !isRuntimeLocalArtifact(file)),
			),
		);
		const managedResults = new Map<string, string>(
			managedOverlay?.operations.map(
				(operation) => [operation.target, operation.sha256] as const,
			) ?? [],
		);
		const acceptedManagedResults = new Map<string, string>(
			acceptedManagedOverlay?.operations.map(
				(operation) => [operation.target, operation.sha256] as const,
			) ?? [],
		);
		// `acceptedManagedResults` is only a safe transition allowance for files
		// already present in target. Missing future add outputs are normal before the
		// replacement materializes them, so they must not be synthesized as deletions.
		const allPaths = [
			...new Set([...baselineSet, ...targetSet, ...managedResults.keys()]),
		].sort();
		const changes: RuntimeChangedFile[] = [];
		for (const filePath of allPaths) {
			if (targetSet.has(filePath)) {
				const actualHash = await sha256File(join(target, filePath));
				if (
					actualHash === managedResults.get(filePath) ||
					actualHash === acceptedManagedResults.get(filePath)
				)
					continue;
			}
			if (!baselineSet.has(filePath)) {
				changes.push({
					status: targetSet.has(filePath) ? "A" : "D",
					path: filePath,
					capability: classifyRuntimeCapability(filePath),
				});
				continue;
			}
			if (!targetSet.has(filePath)) {
				changes.push({
					status: "D",
					path: filePath,
					capability: classifyRuntimeCapability(filePath),
				});
				continue;
			}
			const [expected, actual] = await Promise.all([
				readFile(join(baseline, filePath)),
				readFile(join(target, filePath)),
			]);
			if (!buffersEqualIgnoringCrLf(expected, actual))
				changes.push({
					status: "M",
					path: filePath,
					capability: classifyRuntimeCapability(filePath),
				});
		}
		return changes;
	} finally {
		await rm(runRoot, { recursive: true, force: true });
	}
}

function groupCapabilityFiles(
	changedFiles: readonly RuntimeChangedFile[],
): Partial<Record<RuntimeCapability, readonly string[]>> {
	const grouped: Partial<Record<RuntimeCapability, string[]>> = {};
	for (const file of changedFiles) {
		const files = grouped[file.capability] ?? [];
		files.push(file.path);
		grouped[file.capability] = files;
	}
	return grouped;
}

export async function analyzeNarraForkRuntimeImpact(
	options: ImportRuntimeOptions,
): Promise<RuntimeImpactReport> {
	if (!options.source?.trim()) throw new Error("必须提供 --source <path>");
	const requestedSource = resolve(options.source);
	const requestedTarget = resolve(options.target ?? DEFAULT_TARGET);
	const requestedOverlayRoot = resolve(
		options.overlayRoot ??
			(options.repositoryRoot
				? join(resolve(options.repositoryRoot), "packages", "narrafork-runtime-overlay")
				: DEFAULT_OVERLAY),
	);
	const [sourceInfo, targetInfo, overlayInfo] = await Promise.all([
		stat(requestedSource).catch(() => null),
		stat(requestedTarget).catch(() => null),
		stat(requestedOverlayRoot).catch(() => null),
	]);
	if (!sourceInfo?.isDirectory()) throw new Error("source 不存在或不是目录");
	if (!targetInfo?.isDirectory())
		throw new Error("report-only 需要已导入的 target 目录和 UPSTREAM.lock");
	if (!overlayInfo?.isDirectory()) throw new Error("overlayRoot 不存在或不是目录");
	const [source, target, overlayRoot] = await Promise.all([
		realpath(requestedSource),
		realpath(requestedTarget),
		realpath(requestedOverlayRoot),
	]);
	const topLevel = await requireCommand(
		["git", "rev-parse", "--show-toplevel"],
		source,
		"验证 source Git 仓库",
	);
	if (
		normalizeForComparison(await realpath(topLevel)) !==
		normalizeForComparison(source)
	) {
		throw new Error("source 自身不是 Git toplevel（拒绝向上命中父仓库）");
	}
	await assertCleanSource(source);
	const [previousLock, next] = await Promise.all([
		readInstalledLock(target),
		readUpstreamLock(source),
	]);
	let acceptedManagedOverlay: RuntimeManagedOverlay | undefined;
	if (previousLock.commit === next.lock.commit) {
		const runRoot = await mkdtemp(join(tmpdir(), "novelfork-runtime-report-overlay-"));
		const staging = join(runRoot, "staging");
		const archive = join(runRoot, "runtime.tar");
		await mkdir(staging);
		try {
			const prepared = await prepareRuntimeStaging(
				source,
				next.lock,
				staging,
				archive,
				overlayRoot,
			);
			const acceptedOperations: RuntimeManagedOverlayOperation[] = [
				...(prepared.lock.managedOverlay?.operations ?? []),
			];
			for (const [index, filePath] of (await collectFiles(staging)).entries()) {
				const actualPath = join(target, filePath);
				if (!(await pathExists(actualPath))) continue;
				const [actual, expected] = await Promise.all([
					readFile(actualPath),
					readFile(join(staging, filePath)),
				]);
				if (!buffersEqualIgnoringCrLf(actual, expected)) continue;
				acceptedOperations.push({
					id: `report-verified-${index}`,
					target: filePath,
					sha256: createHash("sha256").update(actual).digest("hex"),
				});
			}
			acceptedManagedOverlay = { operations: acceptedOperations };
		} finally {
			await rm(runRoot, { recursive: true, force: true });
		}
	}
	const [changedFiles, targetModifications] = await Promise.all([
		changedFilesBetween(source, previousLock.commit, next.lock.commit),
		targetChangesFromCommit(
			source,
			target,
			previousLock.commit,
			previousLock.managedOverlay,
			acceptedManagedOverlay,
		),
	]);
	await assertSourceUnchanged(source, next.lock.commit);
	return {
		source,
		target,
		previousLock,
		nextLock: next.lock,
		changedFiles,
		capabilityFiles: groupCapabilityFiles(changedFiles),
		targetModifications,
	};
}

async function assertTargetSafeToReplace(
	source: string,
	target: string,
	acceptedManagedOverlay?: RuntimeManagedOverlay,
): Promise<void> {
	const lock = await readInstalledLock(target);
	const modifications = await targetChangesFromCommit(
		source,
		target,
		lock.commit,
		lock.managedOverlay,
		acceptedManagedOverlay,
	);
	if (modifications.length === 0) return;
	const preview = modifications
		.slice(0, 8)
		.map((file) => `${file.status} ${file.path}`)
		.join(", ");
	const suffix =
		modifications.length > 8 ? ` 等 ${modifications.length} 个文件` : "";
	throw new Error(
		`target 相对 UPSTREAM.lock 已修改，拒绝覆盖：${preview}${suffix}。请使用 --report-only 评估并手工迁移修改`,
	);
}

async function assertSourceUnchanged(
	source: string,
	expectedCommit: string,
): Promise<void> {
	await assertCleanSource(source);
	const currentCommit = await requireCommand(
		["git", "rev-parse", "HEAD"],
		source,
		"再次读取 source HEAD",
	);
	if (currentCommit !== expectedCommit) {
		throw new Error(
			`source HEAD 在导入期间发生变化：expected ${expectedCommit}, actual ${currentCommit}`,
		);
	}
}

async function replacePreparedTarget(
	staging: string,
	target: string,
	replaceExisting: boolean,
	backup: string,
	failedReplacement: string,
): Promise<boolean> {
	const targetExists = await pathExists(target);
	if (targetExists && !replaceExisting)
		throw new Error("target 已存在；如需替换请使用 --replace");
	if (!targetExists) {
		await rename(staging, target);
		return false;
	}

	await rename(target, backup);
	try {
		await rename(staging, target);
	} catch (error) {
		try {
			await rename(backup, target);
		} catch (restoreError) {
			throw new Error(
				`新 target 安装失败，旧 target 保留在受保护 backup：${backup}；恢复失败：${String(restoreError)}`,
			);
		}
		throw error;
	}

	try {
		await rm(backup, { recursive: true, force: true });
	} catch (error) {
		await rename(target, failedReplacement);
		try {
			await rename(backup, target);
			await rm(failedReplacement, { recursive: true, force: true });
		} catch (restoreError) {
			throw new Error(
				`旧 target 清理失败且自动回滚未完成；私有副本保留在受保护临时根：${String(restoreError)}`,
			);
		}
		throw new Error(`替换后无法清理旧 target，已回滚：${String(error)}`);
	}
	return true;
}

interface PreparedRuntimeStaging {
	readonly lock: UpstreamLock;
	readonly overlayOperations: readonly RuntimeOverlayReplayOperationResult[];
}

function lockWithManagedOverlay(
	lock: UpstreamLock,
	operations: readonly RuntimeOverlayReplayOperationResult[],
): UpstreamLock {
	const managedOperations = operations
		.filter(
			(operation) => operation.type === "add" || operation.type === "patch",
		)
		.map((operation) => ({
			id: operation.id,
			target: operation.target,
			sha256: operation.sha256,
		}));
	return {
		...lock,
		managedOverlay: { operations: managedOperations },
	};
}

async function prepareRuntimeStaging(
	source: string,
	lock: UpstreamLock,
	staging: string,
	archive: string,
	overlayRoot: string,
): Promise<PreparedRuntimeStaging> {
	await requireCommand(
		[
			"git",
			"-c",
			"core.autocrlf=false",
			"archive",
			"--format=tar",
			"--output",
			archive,
			lock.commit,
		],
		source,
		"导出 tracked 文件",
	);
	// Use run-root-relative paths: GNU tar treats a Windows drive colon as a remote archive separator.
	await requireCommand(
		["tar", "-xf", basename(archive), "-C", basename(staging)],
		dirname(archive),
		"解压 Git archive",
	);
	await rm(archive, { force: true });
	const replay = await replayRuntimeOverlay({
		overlayRoot,
		stagingRoot: staging,
		upstream: {
			repository: lock.repository,
			commit: lock.commit,
			tree: lock.tree,
		},
	});
	const installedLock = lockWithManagedOverlay(lock, replay.operations);
	await writeFile(
		join(staging, LOCK_FILE_NAME),
		`${JSON.stringify(installedLock, null, 2)}\n`,
		{ encoding: "utf8", flag: "wx" },
	);
	await assertSourceUnchanged(source, lock.commit);
	return { lock: installedLock, overlayOperations: replay.operations };
}

export async function importNarraForkRuntime(
	options: ImportRuntimeOptions,
): Promise<ImportRuntimeResult> {
	if (options.reportOnly)
		throw new Error(
			"report-only 不执行导入；请调用 analyzeNarraForkRuntimeImpact",
		);
	if (!options.source?.trim()) throw new Error("必须提供 --source <path>");

	const repositoryRoot = resolve(
		options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
	);
	const requestedSource = resolve(options.source);
	const requestedTarget = resolve(options.target ?? DEFAULT_TARGET);
	const requestedOverlayRoot = resolve(
		options.overlayRoot ??
			(options.repositoryRoot
				? join(repositoryRoot, "packages", "narrafork-runtime-overlay")
				: DEFAULT_OVERLAY),
	);
	const [sourceInfo, overlayInfo] = await Promise.all([
		stat(requestedSource).catch(() => null),
		stat(requestedOverlayRoot).catch(() => null),
	]);
	if (!sourceInfo?.isDirectory()) throw new Error("source 不存在或不是目录");
	if (!overlayInfo?.isDirectory())
		throw new Error("overlayRoot 不存在或不是目录");
	const [source, overlayRoot] = await Promise.all([
		realpath(requestedSource),
		realpath(requestedOverlayRoot),
	]);
	const target = await canonicalTargetPath(requestedTarget);

	const topLevel = await requireCommand(
		["git", "rev-parse", "--show-toplevel"],
		source,
		"验证 source Git 仓库",
	);
	const canonicalTopLevel = await realpath(topLevel);
	if (
		normalizeForComparison(canonicalTopLevel) !== normalizeForComparison(source)
	) {
		throw new Error("source 自身不是 Git toplevel（拒绝向上命中父仓库）");
	}
	if (isSameOrInside(target, source) || isSameOrInside(source, target)) {
		throw new Error("source 与 target 不能相同或互相包含");
	}
	const targetExists = await pathExists(target);
	if (targetExists && !options.replace && !options.dryRun) {
		throw new Error("target 已存在；如需替换请使用 --replace");
	}

	await assertCleanSource(source);
	const { lock } = await readUpstreamLock(source);

	const { tempRoot } = await assertPrivatePathsIgnored(target, repositoryRoot);
	await mkdir(tempRoot, { recursive: true });
	const runRoot = await mkdtemp(join(tempRoot, "run-"));
	const staging = join(runRoot, "staging");
	const archive = join(runRoot, "upstream.tar");
	const backup = join(runRoot, "backup");
	const failedReplacement = join(runRoot, "failed-replacement");
	await mkdir(staging);

	try {
		const prepared = await prepareRuntimeStaging(
			source,
			lock,
			staging,
			archive,
			overlayRoot,
		);
		if (!options.dryRun && targetExists) {
			await assertTargetSafeToReplace(
				source,
				target,
				prepared.lock.managedOverlay,
			);
		}
		if (options.dryRun) {
			return {
				source,
				target,
				dryRun: true,
				replaced: false,
				lock: prepared.lock,
				overlayOperations: prepared.overlayOperations,
			};
		}
		const replaced = await replacePreparedTarget(
			staging,
			target,
			options.replace === true,
			backup,
			failedReplacement,
		);
		return {
			source,
			target,
			dryRun: false,
			replaced,
			lock: prepared.lock,
			overlayOperations: prepared.overlayOperations,
		};
	} finally {
		// Never delete the only surviving old target if an exceptional rollback itself failed.
		if (!(await pathExists(backup))) {
			await rm(runRoot, { recursive: true, force: true }).catch(
				() => undefined,
			);
			await rmdir(tempRoot).catch(() => undefined);
		}
	}
}

export interface CliOptions extends ImportRuntimeOptions {}

export function parseCliArgs(args: readonly string[]): CliOptions {
	let source: string | undefined;
	let target: string | undefined;
	let overlayRoot: string | undefined;
	let dryRun = false;
	let replace = false;
	let reportOnly = false;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (
			argument === "--source" ||
			argument === "--target" ||
			argument === "--overlay"
		) {
			const value = args[index + 1];
			if (!value || value.startsWith("--"))
				throw new Error(`${argument} 需要路径参数`);
			if (argument === "--source") source = value;
			else if (argument === "--target") target = value;
			else overlayRoot = value;
			index += 1;
			continue;
		}
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (argument === "--replace") {
			replace = true;
			continue;
		}
		if (argument === "--report-only" || argument === "--impact-report") {
			reportOnly = true;
			continue;
		}
		throw new Error(`未知参数：${argument}`);
	}

	if (!source) throw new Error("必须提供 --source <path>");
	if (reportOnly && (dryRun || replace))
		throw new Error(
			"--report-only/--impact-report 不能与 --dry-run 或 --replace 同时使用",
		);
	return {
		source,
		target,
		...(overlayRoot ? { overlayRoot } : {}),
		dryRun,
		replace,
		...(reportOnly ? { reportOnly: true } : {}),
	};
}

function printImpactReport(report: RuntimeImpactReport): void {
	console.log(`impact report: ${report.previousLock.repository}`);
	console.log(
		`upstream: ${report.previousLock.commit.slice(0, 12)} -> ${report.nextLock.commit.slice(0, 12)}`,
	);
	console.log(`changed files (${report.changedFiles.length}):`);
	for (const file of report.changedFiles) {
		const rename = file.previousPath ? `${file.previousPath} -> ` : "";
		console.log(`- ${file.status} ${rename}${file.path} [${file.capability}]`);
	}
	console.log("capabilities:");
	for (const [capability, files] of Object.entries(report.capabilityFiles)) {
		console.log(`- ${capability}: ${files?.length ?? 0}`);
	}
	console.log(
		`target local modifications (${report.targetModifications.length}):`,
	);
	for (const file of report.targetModifications)
		console.log(`- ${file.status} ${file.path} [${file.capability}]`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
	const options = parseCliArgs(args);
	if (options.reportOnly) {
		printImpactReport(await analyzeNarraForkRuntimeImpact(options));
		return;
	}
	if (options.replace)
		console.warn(
			"警告：--replace 已废弃；仅当 target 与 UPSTREAM.lock 基线完全一致时才允许安全替换",
		);
	const result = await importNarraForkRuntime(options);
	const action = result.dryRun
		? "dry-run 通过"
		: result.replaced
			? "已安全替换"
			: "导入完成";
	console.log(
		`${action}: ${result.lock.repository}@${result.lock.commit.slice(0, 12)}`,
	);
	console.log(`target: ${result.target}`);
	console.log(
		`version=${result.lock.version} tree=${result.lock.tree.slice(0, 12)} tracked=${result.lock.trackedFileCount}`,
	);
	console.log(
		`overlay operations=${result.overlayOperations.map((operation) => operation.id).join(", ")}`,
	);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(
			`导入失败：${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	});
}
