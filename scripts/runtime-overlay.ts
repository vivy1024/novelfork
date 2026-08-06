import { createHash } from "node:crypto";
import {
	access,
	copyFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const RUNTIME_OVERLAY_MANIFEST_FILE = "runtime-overlay.manifest.json";

export interface RuntimeOverlayUpstream {
	readonly repository: string;
	readonly commit: string;
	readonly tree: string;
}

interface RuntimeOverlayOperationBase {
	readonly id: string;
	readonly reason: string;
	readonly dependsOn: readonly string[];
}

export interface RuntimeOverlayAddOperation
	extends RuntimeOverlayOperationBase {
	readonly type: "add";
	readonly target: string;
	readonly source: string;
	readonly sha256: string;
}

export interface RuntimeOverlayPatchOperation
	extends RuntimeOverlayOperationBase {
	readonly type: "patch";
	readonly target: string;
	readonly patch: string;
	readonly patchSha256: string;
	readonly baseSha256: string;
	readonly resultSha256: string;
}

export interface RuntimeOverlayCopyOperation
	extends RuntimeOverlayOperationBase {
	readonly type: "copy";
	readonly target: "runtime-migrations";
	readonly source: string;
	readonly sha256: string;
	readonly role: "external-migration-assets";
}

export type RuntimeOverlayOperation =
	| RuntimeOverlayAddOperation
	| RuntimeOverlayPatchOperation
	| RuntimeOverlayCopyOperation;

export interface RuntimeOverlayManifest {
	readonly schemaVersion: 1;
	readonly upstream: RuntimeOverlayUpstream;
	readonly operations: readonly RuntimeOverlayOperation[];
	readonly exclude?: readonly string[];
}

export interface RuntimeOverlayReplayOptions {
	readonly overlayRoot: string;
	readonly stagingRoot: string;
	readonly upstream: RuntimeOverlayUpstream;
}

export interface RuntimeOverlayReplayOperationResult {
	readonly id: string;
	readonly type: RuntimeOverlayOperation["type"];
	readonly target: string;
	readonly sha256: string;
}

export interface RuntimeOverlayReplayResult {
	readonly manifest: RuntimeOverlayManifest;
	readonly operations: readonly RuntimeOverlayReplayOperationResult[];
}

const sha256Pattern = /^[0-9a-f]{64}$/i;
const gitObjectIdPattern = /^[0-9a-f]{40}$/i;

/**
 * These paths are the complete, deliberately narrow Runtime source allowlist.
 * Product UI, manifests, aliases, product persistence, and all generated output
 * must stay outside this overlay.
 */
const allowedAddTargets = new Set([
	"server/lib/product-host/contracts.ts",
	"server/lib/product-host/index.ts",
	"server/lib/product-host/null-integration.ts",
	"server/lib/product-host/registry.ts",
	"server/lib/product-host/__tests__/registry.test.ts",
	// 上游 v0.5.18 起自带 server/types/generated-modules.d.ts，overlay 改用独立
	// 文件名只补上游未声明的模块，避免替换 Runtime 树时与上游文件冲突。
	"server/types/novelfork-generated-modules.d.ts",
	"shared/learning-contract.ts",
	"frontend/components/host/RuntimeFrontendHostProviders.tsx",
	"frontend/components/host/RuntimeFrontendHostProviders.test.tsx",
	// Generic Runtime-owned Provider settings host exposed through the narrow host SPI.
	"frontend/components/providers/EmbeddedProviderSettingsHost.tsx",
	"frontend/components/narrator/RuntimeToolResultRendererContext.tsx",
	"frontend/components/narrator/EmbeddedNarratorDockHost.tsx",
	// Regenerates the Runtime's ignored TanStack route tree before standalone
	// typecheck and test gates; it carries no product behavior or product imports.
	"scripts/generate-route-tree.ts",
]);

const allowedPatchTargets = new Set([
	// Private Runtime dependency metadata: make isolated Bun resolution explicit without
	// pulling this local Runtime tree back into the root workspace.
	"package.json",
	"bun.lock",
	"frontend/components/AppRootLayout.tsx",
	"frontend/components/narrator/ToolCallCard.tsx",
	// Generic Runtime Provider page export used by the embedded host, with no product imports.
	"frontend/routes/settings/providers.tsx",
	"frontend/lib/narrator-ws-manager.ts",
	"frontend/lib/narrator-ws-manager.test.ts",
	// Runtime-only test portability fixes; no product code may enter these patches.
	"frontend/lib/shiki-language-aliases.test.ts",
	"frontend/lib/app-shell-scroll.test.tsx",
	"tests/preload.ts",
	"tests/frontend/narrator-foreground-recovery.test.ts",
	"server/db/run-migrations.test.ts",
	"tsconfig.json",
	"server/app.ts",
	"server/main.ts",
	"server/services/narrator-prompt.ts",
	"server/services/narrator-session.ts",
	"server/websocket/narrator-ws.ts",
	"server/lib/agent/tools/index.ts",
	"server/routes/learning.ts",
	"server/db/run-migrations.ts",
	"shared/learning-content.ts",
	// 通用宿主生成能力：在 ToolExecutionContext 上声明并实现 model/generateText，
	// 让工具能在交互式 agent loop 之外做非交互生成。不含任何产品标识。
	"server/lib/agent/types.ts",
	"server/lib/agent/tool-executor.ts",
	// 导出可复用的项目拆除逻辑，避免宿主侧重复实现删除流程。
	"server/routes/projects.ts",
	// Keep Runtime settings documentation synchronized with DEFAULTS without
	// coupling the replaceable Runtime tree to product code.
	"server/lib/settings/defaults.ts",
	// 让 Runtime 的版本模块消费 build-info 里的 buildProduct 并导出 BUILD_PRODUCT，
	// 启动横幅与启动日志据此显示宿主产品名。Runtime 内不出现任何产品字面量，
	// 产品名只来自编译期生成的 build-info；缺失时回退到 Runtime 自身默认值。
	"server/lib/version.ts",
]);

const forbiddenOverlayContent = [
	/@vivy1024\/novelfork-(?:core|novel-plugin)/i,
	/@product\/novelfork/i,
	/book_runtime_bindings/i,
	/book_provision_operations/i,
	/novelfork_legacy_session_imports/i,
] as const;

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
}

function assertSha256(value: unknown, label: string): asserts value is string {
	assertNonEmptyString(value, label);
	if (!sha256Pattern.test(value))
		throw new Error(`${label} must be a SHA-256 digest`);
}

function assertGitObjectId(
	value: unknown,
	label: string,
): asserts value is string {
	assertNonEmptyString(value, label);
	if (!gitObjectIdPattern.test(value))
		throw new Error(`${label} must be a full Git object id`);
}

function normalizeRelativePath(value: unknown, label: string): string {
	assertNonEmptyString(value, label);
	if (isAbsolute(value) || /^[a-z]:/i.test(value))
		throw new Error(`${label} must be a relative path`);
	const normalized = value.replaceAll("\\", "/");
	if (
		normalized.startsWith("/") ||
		normalized
			.split("/")
			.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new Error(
			`${label} must not contain absolute, empty, dot, or parent segments`,
		);
	}
	return normalized;
}

function parseDependsOn(value: unknown, index: number): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(
			`operations[${index}].dependsOn must be an array of strings`,
		);
	}
	const dependsOn: string[] = [];
	const seen = new Set<string>();
	for (const [dependencyIndex, dependency] of value.entries()) {
		assertNonEmptyString(
			dependency,
			`operations[${index}].dependsOn[${dependencyIndex}]`,
		);
		if (seen.has(dependency)) {
			throw new Error(
				`operations[${index}].dependsOn contains a duplicate: ${dependency}`,
			);
		}
		seen.add(dependency);
		dependsOn.push(dependency);
	}
	return dependsOn;
}

function assertAllowedOperation(operation: RuntimeOverlayOperation): void {
	if (operation.type === "add" && !allowedAddTargets.has(operation.target)) {
		throw new Error(
			`overlay add target is not allowlisted: ${operation.target}`,
		);
	}
	if (
		operation.type === "patch" &&
		!allowedPatchTargets.has(operation.target)
	) {
		throw new Error(
			`overlay patch target is not allowlisted: ${operation.target}`,
		);
	}
	if (operation.type === "copy" && operation.target !== "runtime-migrations") {
		throw new Error(
			`overlay copy target must remain external migration assets: ${operation.target}`,
		);
	}
}

function parseOperation(
	value: unknown,
	index: number,
): RuntimeOverlayOperation {
	if (!value || typeof value !== "object")
		throw new Error(`operations[${index}] must be an object`);
	const candidate = value as Record<string, unknown>;
	const id = candidate.id;
	const type = candidate.type;
	const reason = candidate.reason;
	assertNonEmptyString(id, `operations[${index}].id`);
	assertNonEmptyString(reason, `operations[${index}].reason`);
	const dependsOn = parseDependsOn(candidate.dependsOn, index);
	if (type === "add") {
		const operation: RuntimeOverlayAddOperation = {
			id,
			type,
			reason,
			dependsOn,
			target: normalizeRelativePath(
				candidate.target,
				`operations[${index}].target`,
			),
			source: normalizeRelativePath(
				candidate.source,
				`operations[${index}].source`,
			),
			sha256: (() => {
				assertSha256(candidate.sha256, `operations[${index}].sha256`);
				return candidate.sha256;
			})(),
		};
		if (!operation.source.startsWith("files/")) {
			throw new Error(
				`overlay add source must live under files/: ${operation.source}`,
			);
		}
		assertAllowedOperation(operation);
		return operation;
	}
	if (type === "patch") {
		const operation: RuntimeOverlayPatchOperation = {
			id,
			type,
			reason,
			dependsOn,
			target: normalizeRelativePath(
				candidate.target,
				`operations[${index}].target`,
			),
			patch: normalizeRelativePath(
				candidate.patch,
				`operations[${index}].patch`,
			),
			patchSha256: (() => {
				assertSha256(candidate.patchSha256, `operations[${index}].patchSha256`);
				return candidate.patchSha256;
			})(),
			baseSha256: (() => {
				assertSha256(candidate.baseSha256, `operations[${index}].baseSha256`);
				return candidate.baseSha256;
			})(),
			resultSha256: (() => {
				assertSha256(
					candidate.resultSha256,
					`operations[${index}].resultSha256`,
				);
				return candidate.resultSha256;
			})(),
		};
		if (!operation.patch.startsWith("patches/")) {
			throw new Error(
				`overlay patch must live under patches/: ${operation.patch}`,
			);
		}
		assertAllowedOperation(operation);
		return operation;
	}
	if (type === "copy") {
		const target = normalizeRelativePath(
			candidate.target,
			`operations[${index}].target`,
		);
		const source = normalizeRelativePath(
			candidate.source,
			`operations[${index}].source`,
		);
		if (candidate.role !== "external-migration-assets") {
			throw new Error(
				`operations[${index}].role must be external-migration-assets`,
			);
		}
		assertSha256(candidate.sha256, `operations[${index}].sha256`);
		const operation: RuntimeOverlayCopyOperation = {
			id,
			type,
			reason,
			dependsOn,
			target: target as RuntimeOverlayCopyOperation["target"],
			source,
			sha256: candidate.sha256,
			role: candidate.role,
		};
		if (
			operation.source !== "runtime-migrations" &&
			!operation.source.startsWith("runtime-migrations/")
		) {
			throw new Error(
				`overlay copy source must live under runtime-migrations/: ${operation.source}`,
			);
		}
		assertAllowedOperation(operation);
		return operation;
	}
	throw new Error(`operations[${index}].type is unsupported: ${String(type)}`);
}

function assertNoProductContent(content: string, label: string): void {
	for (const pattern of forbiddenOverlayContent) {
		if (pattern.test(content)) {
			throw new Error(
				`${label} contains product-specific Runtime content (${pattern.source})`,
			);
		}
	}
}

async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

async function resolveExistingPathInside(
	root: string,
	value: string,
	label: string,
): Promise<string> {
	const rootRealPath = await realpath(root);
	const candidate = resolve(rootRealPath, value);
	if (
		candidate !== rootRealPath &&
		!candidate.startsWith(`${rootRealPath}${sep}`)
	) {
		throw new Error(`${label} escapes its root: ${value}`);
	}
	if (!(await pathExists(candidate)))
		throw new Error(`${label} does not exist: ${value}`);
	const actual = await realpath(candidate);
	if (actual !== rootRealPath && !actual.startsWith(`${rootRealPath}${sep}`)) {
		throw new Error(`${label} resolves outside its root: ${value}`);
	}
	return actual;
}

function resolveOutputPathInside(
	root: string,
	value: string,
	label: string,
): string {
	const rootAbsolute = resolve(root);
	const candidate = resolve(rootAbsolute, value);
	if (
		candidate !== rootAbsolute &&
		!candidate.startsWith(`${rootAbsolute}${sep}`)
	) {
		throw new Error(`${label} escapes its root: ${value}`);
	}
	return candidate;
}

async function sha256File(path: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

async function sha256Tree(root: string): Promise<string> {
	const rootRealPath = await realpath(root);
	const entries: string[] = [];

	async function walk(directory: string): Promise<void> {
		const children = await readdir(directory, { withFileTypes: true });
		children.sort((left, right) => left.name.localeCompare(right.name));
		for (const child of children) {
			const childPath = join(directory, child.name);
			if (child.isDirectory()) {
				await walk(childPath);
				continue;
			}
			if (!child.isFile())
				throw new Error(
					`external migration asset must be a regular file: ${childPath}`,
				);
			const normalized = relative(rootRealPath, childPath).replaceAll(sep, "/");
			entries.push(`${normalized}\0${await sha256File(childPath)}\n`);
		}
	}

	await walk(rootRealPath);
	return createHash("sha256").update(entries.join("")).digest("hex");
}

export function validateSingleTargetPatch(patch: string, target: string): void {
	const diffHeaders = [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)];
	if (diffHeaders.length !== 1) {
		throw new Error(
			`overlay patch must contain exactly one diff target: ${target}`,
		);
	}
	const [, oldPath, newPath] = diffHeaders[0] ?? [];
	if (oldPath !== target || newPath !== target) {
		throw new Error(
			`overlay patch target does not match manifest target: ${target}`,
		);
	}
	const oldFileHeaders = [...patch.matchAll(/^--- a\/(.+)$/gm)].map(
		(match) => match[1],
	);
	const newFileHeaders = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
		(match) => match[1],
	);
	if (
		oldFileHeaders.length !== 1 ||
		newFileHeaders.length !== 1 ||
		oldFileHeaders[0] !== target ||
		newFileHeaders[0] !== target
	) {
		throw new Error(
			`overlay patch file headers do not match manifest target: ${target}`,
		);
	}
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
		throw new Error(
			`overlay patch failed: ${(stderr || stdout || `git apply exit ${exitCode}`).trim()}`,
		);
	}
}

/**
 * git apply searches parent directories for .git. Import staging is deliberately
 * nested under the host repository for an atomic same-volume replacement, so
 * make the staging root a temporary Git root before applying patches. The
 * metadata is removed before replay returns and never reaches the Runtime.
 */
async function initializePatchWorkspace(stagingRoot: string): Promise<void> {
	const gitDirectory = join(stagingRoot, ".git");
	if (await pathExists(gitDirectory)) {
		throw new Error("overlay staging root unexpectedly already contains .git");
	}
	const process = Bun.spawn(["git", "init", "--quiet"], {
		cwd: stagingRoot,
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
	if (exitCode !== 0 || !(await pathExists(gitDirectory))) {
		const detail = (stderr || stdout || `git init exit ${exitCode}`).trim();
		throw new Error(`overlay patch workspace initialization failed: ${detail}`);
	}
}

export async function readRuntimeOverlayManifest(
	overlayRoot: string,
): Promise<RuntimeOverlayManifest> {
	const root = await realpath(overlayRoot);
	const manifestPath = await resolveExistingPathInside(
		root,
		RUNTIME_OVERLAY_MANIFEST_FILE,
		"overlay manifest",
	);
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(
			`overlay manifest is not valid JSON: ${describeError(error)}`,
		);
	}
	if (!parsed || typeof parsed !== "object")
		throw new Error("overlay manifest must be an object");
	const candidate = parsed as Record<string, unknown>;
	if (candidate.schemaVersion !== 1)
		throw new Error("overlay manifest schemaVersion must be 1");
	if (!candidate.upstream || typeof candidate.upstream !== "object")
		throw new Error("overlay manifest upstream is required");
	const upstreamCandidate = candidate.upstream as Record<string, unknown>;
	assertNonEmptyString(
		upstreamCandidate.repository,
		"overlay manifest upstream.repository",
	);
	assertGitObjectId(
		upstreamCandidate.commit,
		"overlay manifest upstream.commit",
	);
	assertGitObjectId(upstreamCandidate.tree, "overlay manifest upstream.tree");
	if (
		!Array.isArray(candidate.operations) ||
		candidate.operations.length === 0
	) {
		throw new Error("overlay manifest operations must be a non-empty array");
	}
	const operations = candidate.operations.map(parseOperation);
	const ids = new Set<string>();
	const targets = new Set<string>();
	for (const operation of operations) {
		if (ids.has(operation.id))
			throw new Error(`overlay operation id is duplicated: ${operation.id}`);
		if (targets.has(operation.target))
			throw new Error(`overlay target is duplicated: ${operation.target}`);
		ids.add(operation.id);
		targets.add(operation.target);
	}
	for (const operation of operations) {
		for (const dependency of operation.dependsOn) {
			if (!ids.has(dependency)) {
				throw new Error(
					`overlay operation dependency does not exist: ${operation.id} -> ${dependency}`,
				);
			}
			if (dependency === operation.id) {
				throw new Error(
					`overlay operation must not depend on itself: ${operation.id}`,
				);
			}
		}
	}
	const dependenciesById = new Map(
		operations.map((operation) => [operation.id, operation.dependsOn] as const),
	);
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(`overlay operation dependency cycle detected at: ${id}`);
		}
		visiting.add(id);
		for (const dependency of dependenciesById.get(id) ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const operation of operations) visit(operation.id);
	if (
		candidate.exclude !== undefined &&
		(!Array.isArray(candidate.exclude) ||
			candidate.exclude.some((item) => typeof item !== "string"))
	) {
		throw new Error(
			"overlay manifest exclude must be an array of strings when present",
		);
	}

	return {
		schemaVersion: 1,
		upstream: {
			repository: upstreamCandidate.repository,
			commit: upstreamCandidate.commit,
			tree: upstreamCandidate.tree,
		},
		operations,
		...(candidate.exclude === undefined ? {} : { exclude: candidate.exclude }),
	};
}

/** Validate source assets, hashes, and product-boundary constraints without mutating a Runtime tree. */
export async function verifyRuntimeOverlay(
	overlayRoot: string,
): Promise<RuntimeOverlayManifest> {
	const root = await realpath(overlayRoot);
	const manifest = await readRuntimeOverlayManifest(root);
	for (const operation of manifest.operations) {
		if (operation.type === "add") {
			const source = await resolveExistingPathInside(
				root,
				operation.source,
				`overlay add source ${operation.id}`,
			);
			if (!(await stat(source)).isFile())
				throw new Error(
					`overlay add source must be a file: ${operation.source}`,
				);
			const content = await readFile(source, "utf8");
			assertNoProductContent(content, `overlay add source ${operation.source}`);
			if ((await sha256File(source)) !== operation.sha256) {
				throw new Error(`overlay add source hash mismatch: ${operation.id}`);
			}
			continue;
		}
		if (operation.type === "patch") {
			const patch = await resolveExistingPathInside(
				root,
				operation.patch,
				`overlay patch ${operation.id}`,
			);
			if (!(await stat(patch)).isFile())
				throw new Error(`overlay patch must be a file: ${operation.patch}`);
			const content = await readFile(patch, "utf8");
			assertNoProductContent(content, `overlay patch ${operation.patch}`);
			validateSingleTargetPatch(content, operation.target);
			if ((await sha256File(patch)) !== operation.patchSha256) {
				throw new Error(`overlay patch hash mismatch: ${operation.id}`);
			}
			continue;
		}
		const source = await resolveExistingPathInside(
			root,
			operation.source,
			`external migration asset ${operation.id}`,
		);
		if (!(await stat(source)).isDirectory())
			throw new Error(
				`external migration asset must be a directory: ${operation.source}`,
			);
		if ((await sha256Tree(source)) !== operation.sha256) {
			throw new Error(
				`external migration asset hash mismatch: ${operation.id}`,
			);
		}
	}
	return manifest;
}

/**
 * Applies only a verified overlay to an already-extracted upstream staging tree.
 * Every patch starts from an exact raw-file SHA-256; therefore a changed upstream
 * file cannot be accepted through hunk offset or fuzzy matching.
 */
export async function replayRuntimeOverlay(
	options: RuntimeOverlayReplayOptions,
): Promise<RuntimeOverlayReplayResult> {
	const overlayRoot = await realpath(options.overlayRoot);
	const stagingRoot = await realpath(options.stagingRoot);
	const manifest = await verifyRuntimeOverlay(overlayRoot);
	if (
		manifest.upstream.repository !== options.upstream.repository ||
		manifest.upstream.commit !== options.upstream.commit ||
		manifest.upstream.tree !== options.upstream.tree
	) {
		throw new Error(
			`overlay upstream mismatch: expected ${manifest.upstream.repository}@${manifest.upstream.commit.slice(0, 12)} (${manifest.upstream.tree.slice(0, 12)}), received ${options.upstream.repository}@${options.upstream.commit.slice(0, 12)} (${options.upstream.tree.slice(0, 12)})`,
		);
	}

	const results: RuntimeOverlayReplayOperationResult[] = [];
	const patchWorkspace = join(stagingRoot, ".git");
	const needsPatchWorkspace = manifest.operations.some(
		(operation) => operation.type === "patch",
	);
	if (needsPatchWorkspace) await initializePatchWorkspace(stagingRoot);

	try {
		for (const operation of manifest.operations) {
			if (operation.type === "copy") {
				// The migration bundle is intentionally external: it is validated here but
				// never copied into Runtime/drizzle during an upstream replacement.
				results.push({
					id: operation.id,
					type: operation.type,
					target: operation.target,
					sha256: operation.sha256,
				});
				continue;
			}

			const target = resolveOutputPathInside(
				stagingRoot,
				operation.target,
				`overlay target ${operation.id}`,
			);
			if (operation.type === "add") {
				if (await pathExists(target))
					throw new Error(
						`overlay add target already exists: ${operation.target}`,
					);
				const source = await resolveExistingPathInside(
					overlayRoot,
					operation.source,
					`overlay add source ${operation.id}`,
				);
				await mkdir(dirname(target), { recursive: true });
				await copyFile(source, target);
				const actualHash = await sha256File(target);
				if (actualHash !== operation.sha256)
					throw new Error(`overlay add result hash mismatch: ${operation.id}`);
				results.push({
					id: operation.id,
					type: operation.type,
					target: operation.target,
					sha256: actualHash,
				});
				continue;
			}

			if (!(await pathExists(target)))
				throw new Error(
					`overlay patch target does not exist: ${operation.target}`,
				);
			if (!(await stat(target)).isFile())
				throw new Error(
					`overlay patch target is not a file: ${operation.target}`,
				);
			const baseHash = await sha256File(target);
			if (baseHash !== operation.baseSha256) {
				throw new Error(
					`overlay patch base hash mismatch: ${operation.id}; upstream requires an explicit rebase`,
				);
			}
			const patch = await resolveExistingPathInside(
				overlayRoot,
				operation.patch,
				`overlay patch ${operation.id}`,
			);
			// Patch input is bound to an exact base SHA-256. `--unidiff-zero` avoids
			// platform encoding/line-context ambiguity while preserving fail-closed
			// behavior: a different upstream byte sequence never reaches git apply.
			await runGitApply(
				["--check", "--unidiff-zero", "--whitespace=nowarn", patch],
				stagingRoot,
			);
			await runGitApply(
				["--unidiff-zero", "--whitespace=nowarn", patch],
				stagingRoot,
			);
			const resultHash = await sha256File(target);
			if (resultHash !== operation.resultSha256) {
				throw new Error(
					`overlay patch result hash mismatch: ${operation.id}; expected ${operation.resultSha256}, received ${resultHash}`,
				);
			}
			results.push({
				id: operation.id,
				type: operation.type,
				target: operation.target,
				sha256: resultHash,
			});
		}

		return { manifest, operations: results };
	} finally {
		if (needsPatchWorkspace) {
			await rm(patchWorkspace, { recursive: true, force: true });
		}
	}
}

export const runtimeOverlayAllowlist = Object.freeze({
	add: [...allowedAddTargets].sort(),
	patch: [...allowedPatchTargets].sort(),
	copy: ["runtime-migrations"],
});
