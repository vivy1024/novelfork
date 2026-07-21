#!/usr/bin/env bun
import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import type {
	RuntimeManagedOverlay,
	RuntimeManagedOverlayOperation,
	UpstreamLock,
} from "./import-narrafork-runtime.ts";
import {
	type RuntimeOverlayAddOperation,
	type RuntimeOverlayOperation,
	type RuntimeOverlayPatchOperation,
	validateSingleTargetPatch,
	verifyRuntimeOverlay,
} from "./runtime-overlay.ts";

const LOCK_FILE_NAME = "UPSTREAM.lock.json";
const sha256Pattern = /^[0-9a-f]{64}$/i;
const gitObjectIdPattern = /^[0-9a-f]{40}$/i;

export interface MaterializeRuntimeOverlayOptions {
	readonly target: string;
	readonly overlayRoot: string;
	readonly operationIds: readonly string[];
}

export interface MaterializedRuntimeOverlayOperation {
	readonly id: string;
	readonly type: "add" | "patch";
	readonly target: string;
	readonly sha256: string;
}

export interface MaterializeRuntimeOverlayResult {
	readonly target: string;
	readonly overlayRoot: string;
	readonly operations: readonly MaterializedRuntimeOverlayOperation[];
	readonly lock: UpstreamLock;
}

export interface CliOptions extends MaterializeRuntimeOverlayOptions {}

interface PreparedOperation {
	readonly operation: RuntimeOverlayAddOperation | RuntimeOverlayPatchOperation;
	readonly outputPath: string;
	readonly existed: boolean;
	readonly expectedActiveSha256?: string;
}

interface PreparedOperations {
	readonly toMaterialize: readonly PreparedOperation[];
	readonly noOps: readonly MaterializedRuntimeOverlayOperation[];
}

interface CommitEntry {
	readonly target: string;
	readonly staged: string;
	readonly existed: boolean;
	readonly expectedActiveSha256?: string;
	backup?: string;
	committed: boolean;
}

export class RecoveryRequiredError extends Error {
	readonly recoveryWorkspacePath: string;

	constructor(message: string, recoveryWorkspacePath: string) {
		super(`${message}；恢复工作区已保留：${recoveryWorkspacePath}`);
		this.name = "RecoveryRequiredError";
		this.recoveryWorkspacePath = recoveryWorkspacePath;
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0)
		throw new Error(`${label} 必须是非空字符串`);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

function isInside(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

function resolveOutputPath(
	root: string,
	relativePath: string,
	label: string,
): string {
	const candidate = resolve(root, relativePath);
	if (!isInside(candidate, root))
		throw new Error(`${label} 越出 target 根目录`);
	return candidate;
}

async function assertNearestExistingParentInside(
	root: string,
	path: string,
	label: string,
): Promise<void> {
	let current = dirname(path);
	while (!(await pathExists(current))) {
		const parent = dirname(current);
		if (parent === current) throw new Error(`${label} 找不到现有父目录`);
		current = parent;
	}
	const actualParent = await realpath(current);
	if (!isInside(actualParent, root))
		throw new Error(`${label} 经由符号链接越出 target 根目录`);
}

async function assertRegularFile(path: string, label: string): Promise<void> {
	const metadata = await lstat(path).catch(() => null);
	if (!metadata?.isFile()) throw new Error(`${label} 必须是常规文件`);
}

function sha256Contents(contents: Uint8Array): string {
	return createHash("sha256").update(contents).digest("hex");
}

async function sha256File(path: string): Promise<string> {
	return sha256Contents(await readFile(path));
}

async function resolveExistingPathInside(
	root: string,
	relativePath: string,
	label: string,
): Promise<string> {
	const candidate = resolve(root, relativePath);
	if (!isInside(candidate, root))
		throw new Error(`${label} 越出 overlay 根目录`);
	await assertRegularFile(candidate, label);
	const actual = await realpath(candidate);
	if (!isInside(actual, root))
		throw new Error(`${label} 经由符号链接越出 overlay 根目录`);
	return actual;
}

function isManagedOverlay(value: unknown): value is RuntimeManagedOverlay {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<RuntimeManagedOverlay>;
	if (!Array.isArray(candidate.operations)) return false;
	const targets = new Set<string>();
	return candidate.operations.every((operation) => {
		if (!operation || typeof operation !== "object") return false;
		const record = operation as Partial<RuntimeManagedOverlayOperation>;
		if (
			typeof record.id !== "string" ||
			record.id.length === 0 ||
			typeof record.target !== "string" ||
			record.target.length === 0 ||
			typeof record.sha256 !== "string" ||
			!sha256Pattern.test(record.sha256) ||
			targets.has(record.target)
		)
			return false;
		targets.add(record.target);
		return true;
	});
}

function isUpstreamLock(value: unknown): value is UpstreamLock {
	if (!value || typeof value !== "object") return false;
	const lock = value as Partial<UpstreamLock>;
	return (
		lock.schemaVersion === 1 &&
		typeof lock.repository === "string" &&
		lock.repository.length > 0 &&
		typeof lock.remote === "string" &&
		typeof lock.commit === "string" &&
		gitObjectIdPattern.test(lock.commit) &&
		typeof lock.tree === "string" &&
		gitObjectIdPattern.test(lock.tree) &&
		typeof lock.branch === "string" &&
		typeof lock.version === "string" &&
		typeof lock.importedAt === "string" &&
		typeof lock.trackedFileCount === "number" &&
		lock.importMethod === "git-archive" &&
		(lock.managedOverlay === undefined || isManagedOverlay(lock.managedOverlay))
	);
}

async function readInstalledLock(
	target: string,
): Promise<{ lock: UpstreamLock; contents: Buffer }> {
	const lockPath = join(target, LOCK_FILE_NAME);
	await assertRegularFile(lockPath, `target ${LOCK_FILE_NAME}`);
	const contents = await readFile(lockPath);
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents.toString("utf8"));
	} catch (error) {
		throw new Error(
			`target ${LOCK_FILE_NAME} 不是有效 JSON：${describeError(error)}`,
		);
	}
	if (!isUpstreamLock(parsed))
		throw new Error(`target ${LOCK_FILE_NAME} 格式无效`);
	return { lock: parsed, contents };
}

function assertMatchingUpstream(
	lock: UpstreamLock,
	manifest: Awaited<ReturnType<typeof verifyRuntimeOverlay>>,
): void {
	if (
		lock.repository !== manifest.upstream.repository ||
		lock.commit !== manifest.upstream.commit ||
		lock.tree !== manifest.upstream.tree
	) {
		throw new Error(
			`target ${LOCK_FILE_NAME} 的上游身份与 overlay manifest 不一致：expected ${manifest.upstream.repository}@${manifest.upstream.commit.slice(0, 12)} (${manifest.upstream.tree.slice(0, 12)})`,
		);
	}
}

async function acquireMaterializeLock(target: string): Promise<string> {
	const lockPath = join(dirname(target), ".runtime-overlay-materialize.lock");
	try {
		await mkdir(lockPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") {
			throw new Error(
				`Runtime overlay 物化锁已存在，拒绝并发写入：${lockPath}`,
			);
		}
		throw error;
	}
	return lockPath;
}

function selectOperations(
	operations: readonly RuntimeOverlayOperation[],
	requestedIds: readonly string[],
): Array<RuntimeOverlayAddOperation | RuntimeOverlayPatchOperation> {
	if (requestedIds.length === 0)
		throw new Error("至少需要一个 --operation <id>");
	const available = new Map(
		operations.map((operation) => [operation.id, operation]),
	);
	const requested = new Set<string>();
	for (const id of requestedIds) {
		const operation = available.get(id);
		if (!operation) throw new Error(`overlay operation 不存在：${id}`);
		if (operation.type !== "add" && operation.type !== "patch")
			throw new Error(`overlay operation 必须是 add 或 patch：${id}`);
		requested.add(id);
	}
	for (const id of requested) {
		const operation = available.get(id);
		if (!operation) throw new Error(`overlay operation 不存在：${id}`);
		for (const dependency of operation.dependsOn) {
			if (!requested.has(dependency)) {
				throw new Error(
					`overlay operation 缺少显式选择的依赖：${id} -> ${dependency}`,
				);
			}
		}
	}

	const selected: Array<
		RuntimeOverlayAddOperation | RuntimeOverlayPatchOperation
	> = [];
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		const operation = available.get(id);
		if (!operation) throw new Error(`overlay operation 不存在：${id}`);
		for (const dependency of operation.dependsOn) visit(dependency);
		visited.add(id);
		if (operation.type === "add" || operation.type === "patch") {
			selected.push(operation);
		}
	};
	for (const operation of operations) {
		if (requested.has(operation.id)) visit(operation.id);
	}
	return selected;
}

async function prepareOperations(
	target: string,
	operations: readonly (
		| RuntimeOverlayAddOperation
		| RuntimeOverlayPatchOperation
	)[],
	managedOverlay: RuntimeManagedOverlay | undefined,
): Promise<PreparedOperations> {
	const managedByTarget = new Map(
		managedOverlay?.operations.map(
			(record) => [record.target, record] as const,
		) ?? [],
	);
	const toMaterialize: PreparedOperation[] = [];
	const noOps: MaterializedRuntimeOverlayOperation[] = [];

	for (const operation of operations) {
		const outputPath = resolveOutputPath(
			target,
			operation.target,
			`overlay operation ${operation.id}`,
		);
		await assertNearestExistingParentInside(
			target,
			outputPath,
			`overlay operation ${operation.id}`,
		);
		const exists = await pathExists(outputPath);
		if (exists)
			await assertRegularFile(outputPath, `overlay target ${operation.id}`);
		const previous = managedByTarget.get(operation.target);
		const activeHash = exists ? await sha256File(outputPath) : undefined;
		const resultSha256 =
			operation.type === "add" ? operation.sha256 : operation.resultSha256;

		if (activeHash === resultSha256) {
			if (previous?.sha256 !== resultSha256) {
				throw new Error(
					`overlay target 已等于当前输出但 lock managedOverlay 不匹配：${operation.id}`,
				);
			}
			noOps.push({
				id: operation.id,
				type: operation.type,
				target: operation.target,
				sha256: resultSha256,
			});
			continue;
		}

		if (operation.type === "add") {
			if (!exists && previous) {
				throw new Error(
					`overlay add target 缺失但 lock 仍记录旧输出：${operation.id}`,
				);
			}
			if (exists && !previous) {
				throw new Error(
					`overlay add target 已存在但不是 lock 管理的旧输出：${operation.id}`,
				);
			}
			if (exists && previous && activeHash !== previous.sha256) {
				throw new Error(
					`overlay add target 与 lock managedOverlay 旧 SHA 不匹配：${operation.id}`,
				);
			}
			toMaterialize.push({
				operation,
				outputPath,
				existed: exists,
				...(exists && previous
					? { expectedActiveSha256: previous.sha256 }
					: {}),
			});
			continue;
		}

		if (!exists)
			throw new Error(`overlay patch target 不存在：${operation.target}`);
		if (activeHash !== operation.baseSha256) {
			throw new Error(
				`overlay patch base hash 不匹配：${operation.id}；需要显式 rebase`,
			);
		}
		if (previous && previous.sha256 !== activeHash) {
			throw new Error(
				`overlay patch target 与 lock managedOverlay 旧 SHA 不匹配：${operation.id}`,
			);
		}
		toMaterialize.push({
			operation,
			outputPath,
			existed: true,
			expectedActiveSha256: activeHash,
		});
	}
	return { toMaterialize, noOps };
}

async function runGitApply(
	args: readonly string[],
	cwd: string,
): Promise<void> {
	const process = Bun.spawn(
		["git", "-c", "core.autocrlf=false", "apply", ...args],
		{
			cwd,
			env: globalThis.process.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) {
		const detail = (stderr || stdout || `git apply exit ${exitCode}`).trim();
		throw new Error(`overlay patch 应用失败：${detail}`);
	}
}

async function initializePatchWorkspace(workspace: string): Promise<void> {
	const process = Bun.spawn(["git", "init", "--quiet"], {
		cwd: workspace,
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
	if (exitCode !== 0)
		throw new Error(
			`overlay patch 临时工作区初始化失败：${(stderr || stdout || `git init exit ${exitCode}`).trim()}`,
		);
}

async function copyVerifiedPatchInput(
	workspace: string,
	overlayRoot: string,
	item: PreparedOperation,
	index: number,
): Promise<string> {
	if (item.operation.type !== "patch") {
		throw new Error(`不是 patch operation：${item.operation.id}`);
	}
	const source = await resolveExistingPathInside(
		overlayRoot,
		item.operation.patch,
		`overlay patch ${item.operation.id}`,
	);
	const verifiedInput = join(
		workspace,
		"verified-inputs",
		`${index}-${basename(item.operation.patch)}`,
	);
	await mkdir(dirname(verifiedInput), { recursive: true });
	await copyFile(source, verifiedInput);
	if ((await sha256File(verifiedInput)) !== item.operation.patchSha256) {
		throw new Error(`overlay patch 输入 hash 不匹配：${item.operation.id}`);
	}
	validateSingleTargetPatch(
		await readFile(verifiedInput, "utf8"),
		item.operation.target,
	);
	return verifiedInput;
}

async function stageOutputs(
	workspace: string,
	overlayRoot: string,
	prepared: readonly PreparedOperation[],
): Promise<MaterializedRuntimeOverlayOperation[]> {
	const needsPatchWorkspace = prepared.some(
		({ operation }) => operation.type === "patch",
	);
	if (needsPatchWorkspace) await initializePatchWorkspace(workspace);
	const results: MaterializedRuntimeOverlayOperation[] = [];
	for (const [index, item] of prepared.entries()) {
		const staged = resolveOutputPath(
			workspace,
			item.operation.target,
			`staged overlay output ${item.operation.id}`,
		);
		await mkdir(dirname(staged), { recursive: true });
		if (item.operation.type === "add") {
			const source = await resolveExistingPathInside(
				overlayRoot,
				item.operation.source,
				`overlay add source ${item.operation.id}`,
			);
			await copyFile(source, staged);
			const actualHash = await sha256File(staged);
			if (actualHash !== item.operation.sha256)
				throw new Error(`overlay add result hash 不匹配：${item.operation.id}`);
			results.push({
				id: item.operation.id,
				type: "add",
				target: item.operation.target,
				sha256: actualHash,
			});
			continue;
		}

		await copyFile(item.outputPath, staged);
		const patch = await copyVerifiedPatchInput(
			workspace,
			overlayRoot,
			item,
			index,
		);
		await runGitApply(
			["--check", "--unidiff-zero", "--whitespace=nowarn", patch],
			workspace,
		);
		await runGitApply(
			["--unidiff-zero", "--whitespace=nowarn", patch],
			workspace,
		);
		const actualHash = await sha256File(staged);
		if (actualHash !== item.operation.resultSha256) {
			throw new Error(
				`overlay patch result hash 不匹配：${item.operation.id}；expected ${item.operation.resultSha256}, received ${actualHash}`,
			);
		}
		results.push({
			id: item.operation.id,
			type: "patch",
			target: item.operation.target,
			sha256: actualHash,
		});
	}
	for (const item of prepared) {
		const staged = resolveOutputPath(
			workspace,
			item.operation.target,
			`staged overlay output ${item.operation.id}`,
		);
		const expectedSha256 =
			item.operation.type === "add"
				? item.operation.sha256
				: item.operation.resultSha256;
		if ((await sha256File(staged)) !== expectedSha256) {
			throw new Error(
				`staged overlay output hash 不匹配：${item.operation.id}`,
			);
		}
	}
	return results;
}

function lockWithMaterializedOperations(
	lock: UpstreamLock,
	operations: readonly MaterializedRuntimeOverlayOperation[],
): UpstreamLock {
	const selectedTargets = new Set(
		operations.map((operation) => operation.target),
	);
	const remaining = (lock.managedOverlay?.operations ?? []).filter(
		(operation) => !selectedTargets.has(operation.target),
	);
	return {
		...lock,
		managedOverlay: {
			operations: [
				...remaining,
				...operations.map((operation) => ({
					id: operation.id,
					target: operation.target,
					sha256: operation.sha256,
				})),
			],
		},
	};
}

async function assertPreparedStateUnchanged(
	target: string,
	lockContents: Buffer,
	prepared: readonly PreparedOperation[],
): Promise<void> {
	const currentLock = await readFile(join(target, LOCK_FILE_NAME));
	if (!currentLock.equals(lockContents))
		throw new Error(`${LOCK_FILE_NAME} 在物化准备期间发生变化，拒绝写入`);
	for (const item of prepared) {
		const exists = await pathExists(item.outputPath);
		if (exists !== item.existed) {
			throw new Error(
				`overlay target 在物化准备期间发生变化：${item.operation.id}`,
			);
		}
		if (item.expectedActiveSha256) {
			await assertRegularFile(
				item.outputPath,
				`overlay target ${item.operation.id}`,
			);
			if ((await sha256File(item.outputPath)) !== item.expectedActiveSha256) {
				throw new Error(
					`overlay target 在物化准备期间发生变化：${item.operation.id}`,
				);
			}
		}
		await assertNearestExistingParentInside(
			target,
			item.outputPath,
			`overlay operation ${item.operation.id}`,
		);
	}
}

async function commitPreparedFiles(
	workspace: string,
	target: string,
	prepared: readonly PreparedOperation[],
	lockSha256: string,
): Promise<void> {
	const entries: CommitEntry[] = [
		...prepared.map((item) => ({
			target: item.outputPath,
			staged: resolveOutputPath(
				workspace,
				item.operation.target,
				"staged output",
			),
			existed: item.existed,
			...(item.existed
				? { expectedActiveSha256: item.expectedActiveSha256 }
				: {}),
			committed: false,
		})),
		{
			target: join(target, LOCK_FILE_NAME),
			staged: join(workspace, LOCK_FILE_NAME),
			existed: true,
			expectedActiveSha256: lockSha256,
			committed: false,
		},
	];
	const backups = join(workspace, ".backups");
	await mkdir(backups, { recursive: true });
	try {
		for (const [index, entry] of entries.entries()) {
			await mkdir(dirname(entry.target), { recursive: true });
			if (entry.existed) {
				await assertRegularFile(entry.target, `待替换目标 ${entry.target}`);
				if (
					!entry.expectedActiveSha256 ||
					(await sha256File(entry.target)) !== entry.expectedActiveSha256
				) {
					throw new Error(`overlay target 在替换前发生变化：${entry.target}`);
				}
				const backup = join(
					backups,
					`${index}-${basename(entry.target)}-${randomUUID()}`,
				);
				await rename(entry.target, backup);
				entry.backup = backup;
			}
			await rename(entry.staged, entry.target);
			entry.committed = true;
		}
	} catch (error) {
		const rollbackFailures: string[] = [];
		for (const entry of [...entries].reverse()) {
			try {
				if (entry.committed) await rm(entry.target, { force: true });
				if (entry.backup) await rename(entry.backup, entry.target);
			} catch (rollbackError) {
				rollbackFailures.push(
					`${entry.target}: ${describeError(rollbackError)}`,
				);
			}
		}
		if (rollbackFailures.length) {
			throw new RecoveryRequiredError(
				`overlay 原子写入失败：${describeError(error)}；回滚失败：${rollbackFailures.join("; ")}`,
				workspace,
			);
		}
		throw new Error(
			`overlay 原子写入失败：${describeError(error)}；已回滚已写入的文件`,
		);
	}
}

export async function materializeRuntimeOverlay(
	options: MaterializeRuntimeOverlayOptions,
): Promise<MaterializeRuntimeOverlayResult> {
	if (!options.target?.trim()) throw new Error("必须提供 --target <path>");
	if (!options.overlayRoot?.trim())
		throw new Error("必须提供 --overlay <path>");
	const [targetInfo, overlayInfo] = await Promise.all([
		stat(resolve(options.target)).catch(() => null),
		stat(resolve(options.overlayRoot)).catch(() => null),
	]);
	if (!targetInfo?.isDirectory()) throw new Error("target 不存在或不是目录");
	if (!overlayInfo?.isDirectory()) throw new Error("overlay 不存在或不是目录");
	const [target, overlayRoot] = await Promise.all([
		realpath(resolve(options.target)),
		realpath(resolve(options.overlayRoot)),
	]);

	const materializeLock = await acquireMaterializeLock(target);
	let workspace: string | undefined;
	let preserveWorkspace = false;
	try {
		const manifest = await verifyRuntimeOverlay(overlayRoot);
		const { lock, contents: lockContents } = await readInstalledLock(target);
		assertMatchingUpstream(lock, manifest);
		const operations = selectOperations(
			manifest.operations,
			options.operationIds,
		);
		const prepared = await prepareOperations(
			target,
			operations,
			lock.managedOverlay,
		);
		if (prepared.toMaterialize.length === 0) {
			return {
				target,
				overlayRoot,
				operations: prepared.noOps,
				lock,
			};
		}

		workspace = await mkdtemp(
			join(dirname(target), ".runtime-overlay-materialize-"),
		);
		const materialized = await stageOutputs(
			workspace,
			overlayRoot,
			prepared.toMaterialize,
		);
		const nextLock = lockWithMaterializedOperations(lock, materialized);
		await writeFile(
			join(workspace, LOCK_FILE_NAME),
			`${JSON.stringify(nextLock, null, 2)}\n`,
			{ encoding: "utf8", flag: "wx" },
		);
		await assertPreparedStateUnchanged(
			target,
			lockContents,
			prepared.toMaterialize,
		);
		await commitPreparedFiles(
			workspace,
			target,
			prepared.toMaterialize,
			sha256Contents(lockContents),
		);
		const byId = new Map(
			[...prepared.noOps, ...materialized].map(
				(operation) => [operation.id, operation] as const,
			),
		);
		return {
			target,
			overlayRoot,
			operations: operations.map((operation) => {
				const result = byId.get(operation.id);
				if (!result)
					throw new Error(`overlay operation 缺少物化结果：${operation.id}`);
				return result;
			}),
			lock: nextLock,
		};
	} catch (error) {
		preserveWorkspace = error instanceof RecoveryRequiredError;
		throw error;
	} finally {
		try {
			if (workspace && !preserveWorkspace) {
				await rm(workspace, { recursive: true, force: true });
			}
		} finally {
			await rm(materializeLock, { recursive: true, force: true });
		}
	}
}

export function parseCliArgs(args: readonly string[]): CliOptions {
	let target: string | undefined;
	let overlayRoot: string | undefined;
	const operationIds: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (
			argument === "--target" ||
			argument === "--overlay" ||
			argument === "--operation"
		) {
			const value = args[index + 1];
			if (!value || value.startsWith("--"))
				throw new Error(`${argument} 需要参数`);
			if (argument === "--target") target = value;
			else if (argument === "--overlay") overlayRoot = value;
			else {
				const ids = value.split(",").map((id) => id.trim());
				if (ids.some((id) => id.length === 0))
					throw new Error("--operation 不能包含空 operation id");
				operationIds.push(...ids);
			}
			index += 1;
			continue;
		}
		throw new Error(`未知参数：${argument}`);
	}
	assertNonEmptyString(target, "--target");
	assertNonEmptyString(overlayRoot, "--overlay");
	if (operationIds.length === 0)
		throw new Error("至少需要一个 --operation <id>");
	return { target, overlayRoot, operationIds };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
	const result = await materializeRuntimeOverlay(parseCliArgs(args));
	console.log(
		`已物化 ${result.operations.length} 个 Runtime overlay operation：${result.operations.map((operation) => operation.id).join(", ")}`,
	);
	console.log(`target: ${result.target}`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(`物化失败：${describeError(error)}`);
		process.exitCode = 1;
	});
}
