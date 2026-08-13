import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	readRuntimeOverlayManifest,
	replayRuntimeOverlay,
} from "../runtime-overlay.ts";

export const REQUIRED_RUNTIME_BUN_VERSION = "1.3.13";
export const MINIMUM_ISOLATED_RUNTIME_FREE_BYTES = 10 * 1024 ** 3;

function formatGiB(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/**
 * Avoid beginning a full Runtime workspace copy when the temporary volume cannot
 * safely hold it. This runs before mkdtempSync so a rejected compilation leaves
 * no new novelfork-product-runtime-* directory behind.
 */
export function assertSufficientTemporaryDiskSpace(
	temporaryDirectory = tmpdir(),
	minimumFreeBytes = MINIMUM_ISOLATED_RUNTIME_FREE_BYTES,
): void {
	const filesystem = statfsSync(temporaryDirectory);
	const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
	if (!Number.isFinite(availableBytes) || availableBytes < minimumFreeBytes) {
		throw new Error(
			`Insufficient temporary disk space for isolated Runtime build at ${temporaryDirectory}: ` +
				`available ${formatGiB(availableBytes)}, requires at least ${formatGiB(minimumFreeBytes)}.`,
		);
	}
}

const runtimeCopyExcludedDirectories = new Set([
	".git",
	".worktrees",
	".narrafork-runtime-backups",
	"dist",
	"node_modules",
]);

const runtimeCopyExcludedFiles = [
	/\.db(?:-(?:journal|wal|shm))?$/i,
	/\.tmp$/i,
] as const;

const runtimeEnvironmentNames = new Set([
	"NODE_PATH",
	"BUN_INSTALL",
	"BUN_INSTALL_BIN",
	"BUN_INSTALL_GLOBAL_DIR",
	"BUN_INSTALL_CACHE_DIR",
	"BUN_RUNTIME_TRANSPILER_CACHE_PATH",
	"BUNFIG",
	"NPM_CONFIG_WORKSPACE",
	"NPM_CONFIG_WORKSPACES",
]);

const nodeBuiltinModules = new Set(
	builtinModules.flatMap((specifier) => [specifier, specifier.replace(/^node:/, "")]),
);

export interface IsolatedRuntimeBuild {
	readonly sourceRoot: string;
	/** Runtime package root inside the temporary workspace. */
	readonly root: string;
	/** Complete temporary product workspace containing every build input. */
	readonly workspaceRoot: string;
	/** Flat Zod ESM module used to avoid the Bun compiled-linker re-export bug. */
	readonly prebundledZodPath: string;
	readonly environment: NodeJS.ProcessEnv;
	readonly resolverPlugin: Bun.BunPlugin;
	dispose(): void;
}

type RuntimePackageManifest = {
	readonly packageManager?: string;
};

function isRuntimeEnvironmentName(name: string): boolean {
	const normalized = name.toUpperCase();
	return runtimeEnvironmentNames.has(normalized) || normalized.startsWith("BUN_CONFIG_");
}

function isPathInside(root: string, candidate: string): boolean {
	const pathRelative = relative(root, candidate);
	return (
		pathRelative === "" ||
		(!pathRelative.startsWith(`..${sep}`) && pathRelative !== ".." && !isAbsolute(pathRelative))
	);
}

function readRuntimePackageManifest(runtimeRoot: string): RuntimePackageManifest {
	const packagePath = join(runtimeRoot, "package.json");
	if (!existsSync(packagePath)) {
		throw new Error(`Runtime package manifest is missing: ${packagePath}`);
	}
	try {
		return JSON.parse(readFileSync(packagePath, "utf8")) as RuntimePackageManifest;
	} catch (error) {
		throw new Error(`Runtime package manifest is invalid: ${packagePath} (${String(error)})`);
	}
}

function assertRuntimeSource(runtimeRoot: string): void {
	if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
		throw new Error(`Runtime source directory is missing: ${runtimeRoot}`);
	}

	const manifest = readRuntimePackageManifest(runtimeRoot);
	if (manifest.packageManager !== `bun@${REQUIRED_RUNTIME_BUN_VERSION}`) {
		throw new Error(
			`Runtime packageManager must be bun@${REQUIRED_RUNTIME_BUN_VERSION}; received ${manifest.packageManager ?? "<missing>"}`,
		);
	}

	const lockfile = join(runtimeRoot, "bun.lock");
	if (!existsSync(lockfile) || !statSync(lockfile).isFile()) {
		throw new Error(`Runtime Bun lockfile is missing: ${lockfile}`);
	}
}

export function shouldCopyRuntimePath(sourceRoot: string, sourcePath: string): boolean {
	const pathRelative = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
	if (pathRelative === "") return true;

	const segments = pathRelative.split("/");
	if (segments.some((segment) => runtimeCopyExcludedDirectories.has(segment))) return false;
	if (pathRelative === "server/generated" || pathRelative.startsWith("server/generated/")) return false;
	return !runtimeCopyExcludedFiles.some((pattern) => pattern.test(pathRelative));
}

const workspaceCopyExcludedDirectories = new Set([
	".git",
	".worktrees",
	".bun-cache",
	".narrafork-runtime-backups",
	"node_modules",
]);

function shouldCopyWorkspacePath(sourceRoot: string, sourcePath: string): boolean {
	const pathRelative = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
	if (pathRelative === "") return true;

	const segments = pathRelative.split("/");
	if (segments.some((segment) => workspaceCopyExcludedDirectories.has(segment))) return false;
	if (
		pathRelative === "packages/narrafork-runtime-private/server/generated" ||
		pathRelative.startsWith("packages/narrafork-runtime-private/server/generated/")
	) {
		return false;
	}
	return !runtimeCopyExcludedFiles.some((pattern) => pattern.test(pathRelative));
}

const SANDBOX_ROOT_DEPENDENCIES: Readonly<Record<string, string>> = {
	// A sandbox-only install must not float the product's direct Zod consumers
	// away from the Runtime baseline. Keep this a direct root dependency instead
	// of a global override so third-party Zod 3 dependency trees retain their own
	// compatible resolution.
	zod: "4.3.6",
};

export function configureSandboxRootDependencies(workspaceRoot: string): void {
	const manifestPath = join(workspaceRoot, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
	const currentDependencies =
		typeof manifest.dependencies === "object" && manifest.dependencies !== null
			? (manifest.dependencies as Record<string, unknown>)
			: {};

	// The product and the private Runtime intentionally retain different Tiptap
	// major versions. Never copy source-root overrides into the disposable
	// workspace: only the sandbox's direct dependencies participate in its
	// resolution baseline.
	manifest.dependencies = { ...currentDependencies, ...SANDBOX_ROOT_DEPENDENCIES };
	delete manifest.overrides;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

function copyIsolatedProductWorkspace(sourceRuntimeRoot: string, destinationRoot: string): string {
	const sourceWorkspaceRoot = dirname(dirname(sourceRuntimeRoot));
	const requiredRootFiles = [
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"tsconfig.json",
		"main.ts",
	] as const;
	for (const file of requiredRootFiles) {
		const source = join(sourceWorkspaceRoot, file);
		if (!existsSync(source) || !statSync(source).isFile()) {
			throw new Error(`Product workspace build input is missing: ${source}`);
		}
		cpSync(source, join(destinationRoot, file));
	}
	configureSandboxRootDependencies(destinationRoot);

	const sourcePackagesRoot = join(sourceWorkspaceRoot, "packages");
	if (!existsSync(sourcePackagesRoot) || !statSync(sourcePackagesRoot).isDirectory()) {
		throw new Error(`Product workspace packages directory is missing: ${sourcePackagesRoot}`);
	}
	cpSync(sourcePackagesRoot, join(destinationRoot, "packages"), {
		recursive: true,
		filter: (sourcePath) => shouldCopyWorkspacePath(sourceWorkspaceRoot, sourcePath),
	});

	const runtimeRoot = join(destinationRoot, "packages", basename(sourceRuntimeRoot));
	assertRuntimeSource(runtimeRoot);
	// Generated Runtime output must always be built from the sandbox source.
	rmSync(join(runtimeRoot, "dist"), { recursive: true, force: true });
	rmSync(join(runtimeRoot, "server", "generated"), { recursive: true, force: true });
	return runtimeRoot;
}

const SANDBOX_RUNTIME_DEPENDENCIES: Readonly<Record<string, string>> = {
	// Runtime imports jose directly for OIDC and authentication, but the upstream
	// package currently receives it only transitively through MCP. Declare it in
	// the disposable build manifest so Bun can resolve it during root compilation.
	jose: "^6.1.3",
};

const SANDBOX_RUNTIME_DEPENDENCY_PINS: Readonly<Record<string, string>> = {
	// Keep the Runtime's direct dependency on the same product baseline when its
	// disposable lockfile is rebuilt. The compiled-executable linker workaround is
	// handled separately by the flat Zod prebundle below.
	zod: "4.3.6",
};

type RuntimeUpstreamIdentity = {
	readonly repository: string;
	readonly commit: string;
	readonly tree: string;
};

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function ensureSandboxRuntimeDependencies(runtimeRoot: string): void {
	const manifestPath = join(runtimeRoot, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		dependencies?: Record<string, string>;
	};
	const dependencies = { ...(manifest.dependencies ?? {}) };
	let changed = false;
	for (const [name, version] of Object.entries(SANDBOX_RUNTIME_DEPENDENCIES)) {
		if (dependencies[name]) continue;
		dependencies[name] = version;
		changed = true;
	}
	for (const [name, version] of Object.entries(SANDBOX_RUNTIME_DEPENDENCY_PINS)) {
		if (dependencies[name] === version) continue;
		dependencies[name] = version;
		changed = true;
	}
	if (!changed) return;
	manifest.dependencies = dependencies;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

function readRuntimeUpstreamIdentity(runtimeRoot: string): RuntimeUpstreamIdentity {
	const lockPath = join(runtimeRoot, "UPSTREAM.lock.json");
	if (!existsSync(lockPath) || !statSync(lockPath).isFile()) {
		throw new Error(`Runtime upstream lock is missing: ${lockPath}`);
	}
	const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<RuntimeUpstreamIdentity>;
	if (
		typeof lock.repository !== "string" ||
		typeof lock.commit !== "string" ||
		typeof lock.tree !== "string"
	) {
		throw new Error(`Runtime upstream lock is incomplete: ${lockPath}`);
	}
	return { repository: lock.repository, commit: lock.commit, tree: lock.tree };
}

/**
 * A checked-in Runtime source may already contain earlier overlay operations,
 * while a newly-added generic host operation is still pending. Reconcile the
 * disposable copy only: verified applied operations stay untouched; operations
 * still at their exact base revision are replayed through the normal fail-closed
 * overlay implementation.
 */
async function reconcileSandboxRuntimeOverlay(
	workspaceRoot: string,
	runtimeRoot: string,
): Promise<void> {
	const overlayRoot = join(workspaceRoot, "packages", "narrafork-runtime-overlay");
	const manifestPath = join(overlayRoot, "runtime-overlay.manifest.json");
	if (!existsSync(overlayRoot) || !statSync(overlayRoot).isDirectory()) {
		throw new Error(`Runtime overlay directory is missing: ${overlayRoot}`);
	}
	const originalManifest = readFileSync(manifestPath, "utf8");
	const manifest = await readRuntimeOverlayManifest(overlayRoot);
	const upstream = readRuntimeUpstreamIdentity(runtimeRoot);
	if (
		manifest.upstream.repository !== upstream.repository ||
		manifest.upstream.commit !== upstream.commit ||
		manifest.upstream.tree !== upstream.tree
	) {
		throw new Error(
			`Runtime overlay identity does not match the isolated Runtime source: ${upstream.repository}@${upstream.commit.slice(0, 12)}`,
		);
	}

	// A target may have an exact dependency-ordered patch chain. Inspect the
	// materialized file once per target and treat a later operation's result as an
	// already-applied prefix, rather than rejecting the earlier operation because the
	// file has advanced beyond its own result hash.
	const patchOperationsByTarget = new Map<
		string,
		Array<Extract<(typeof manifest.operations)[number], { type: "patch" }>>
	>();
	for (const operation of manifest.operations) {
		if (operation.type !== "patch") continue;
		const operations = patchOperationsByTarget.get(operation.target) ?? [];
		operations.push(operation);
		patchOperationsByTarget.set(operation.target, operations);
	}

	const patchPendingFromByTarget = new Map<string, number>();
	for (const [targetName, operations] of patchOperationsByTarget) {
		const target = join(runtimeRoot, targetName);
		if (!existsSync(target) || !statSync(target).isFile()) {
			throw new Error(`Isolated Runtime overlay patch target is missing: ${targetName}`);
		}
		const actualHash = sha256File(target);
		let pendingFrom: number | undefined;
		for (const [index, operation] of operations.entries()) {
			if (actualHash === operation.baseSha256) {
				pendingFrom = pendingFrom === undefined ? index : Math.min(pendingFrom, index);
			}
			if (actualHash === operation.resultSha256) {
				const nextIndex = index + 1;
				pendingFrom = pendingFrom === undefined ? nextIndex : Math.max(pendingFrom, nextIndex);
			}
		}
		if (pendingFrom === undefined) {
			throw new Error(
				`Isolated Runtime overlay patch target has unexpected content: ${targetName}`,
			);
		}
		patchPendingFromByTarget.set(targetName, pendingFrom);
	}

	const pendingOperations = manifest.operations.filter((operation) => {
		if (operation.type === "copy") return false;
		const target = join(runtimeRoot, operation.target);
		if (operation.type === "add") {
			if (!existsSync(target)) return true;
			if (sha256File(target) === operation.sha256) return false;
			throw new Error(
				`Isolated Runtime overlay add target has unexpected content: ${operation.target}`,
			);
		}

		const operations = patchOperationsByTarget.get(operation.target) ?? [];
		const pendingFrom = patchPendingFromByTarget.get(operation.target);
		return operations.indexOf(operation) >= (pendingFrom ?? operations.length);
	});
	if (pendingOperations.length === 0) return;

	try {
		// Replay accepts a source archive. The sandbox instead contains a verified
		// mix of pre-applied and pending operations, so temporarily expose only the
		// pending subset to preserve the same exact-hash application guarantees.
		writeFileSync(
			manifestPath,
			`${JSON.stringify({ ...manifest, operations: pendingOperations }, null, 2)}\n`,
		);
		await replayRuntimeOverlay({
			overlayRoot,
			stagingRoot: runtimeRoot,
			upstream,
		});
	} finally {
		writeFileSync(manifestPath, originalManifest);
	}
}

type DrizzleMigrationJournal = {
	readonly entries: ReadonlyArray<{ readonly tag?: unknown }>;
};

/**
 * Seed the disposable Runtime's migration directory with the verified product
 * history before Drizzle generates its next delta. Without this, a clean
 * sandbox generates a new full-schema `0000` migration on every release. That
 * migration conflicts with pre-existing user databases whose stable history is
 * already recorded, and its index creation can expose columns that a previous
 * partial migration never added.
 */
export function seedSandboxRuntimeMigrationHistory(workspaceRoot: string, runtimeRoot: string): void {
	const sourceRoot = join(
		workspaceRoot,
		"packages",
		"narrafork-runtime-overlay",
		"runtime-migrations",
	);
	const journalPath = join(sourceRoot, "meta", "_journal.json");
	if (!existsSync(journalPath) || !statSync(journalPath).isFile()) {
		throw new Error(`Verified Runtime migration journal is missing: ${journalPath}`);
	}

	let journal: DrizzleMigrationJournal;
	try {
		journal = JSON.parse(readFileSync(journalPath, "utf8")) as DrizzleMigrationJournal;
	} catch (error) {
		throw new Error(`Verified Runtime migration journal is invalid: ${journalPath} (${String(error)})`);
	}
	if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
		throw new Error(`Verified Runtime migration journal has no entries: ${journalPath}`);
	}

	for (const entry of journal.entries) {
		if (typeof entry?.tag !== "string" || entry.tag.length === 0) {
			throw new Error(`Verified Runtime migration journal contains an invalid tag: ${journalPath}`);
		}
		const snapshotId = entry.tag.match(/^(\d+)_/)?.[1];
		if (!snapshotId) {
			throw new Error(`Verified Runtime migration tag has no numeric prefix: ${entry.tag}`);
		}
		const sqlPath = join(sourceRoot, `${entry.tag}.sql`);
		const snapshotPath = join(sourceRoot, "meta", `${snapshotId}_snapshot.json`);
		if (!existsSync(sqlPath) || !statSync(sqlPath).isFile()) {
			throw new Error(`Verified Runtime migration SQL is missing: ${sqlPath}`);
		}
		if (!existsSync(snapshotPath) || !statSync(snapshotPath).isFile()) {
			throw new Error(`Verified Runtime migration snapshot is missing: ${snapshotPath}`);
		}
	}

	const destinationRoot = join(runtimeRoot, "drizzle");
	rmSync(destinationRoot, { recursive: true, force: true });
	cpSync(sourceRoot, destinationRoot, { recursive: true });
}

export const RUNTIME_BRIDGE_PACKAGE = "@vivy1024/narrafork-runtime-bridge";

function resolveRuntimeSourceFile(candidate: string): string | undefined {
	const candidates = [
		candidate,
		`${candidate}.ts`,
		`${candidate}.tsx`,
		`${candidate}.js`,
		`${candidate}.mjs`,
		`${candidate}.cjs`,
		`${candidate}.json`,
		join(candidate, "index.ts"),
		join(candidate, "index.tsx"),
		join(candidate, "index.js"),
		join(candidate, "index.mjs"),
		join(candidate, "index.cjs"),
	];

	for (const path of candidates) {
		if (existsSync(path) && statSync(path).isFile()) return path;
	}
	return undefined;
}

/**
 * Avoids Bun's Windows workspace-link resolution path during product compilation.
 * The bridge remains a product-side package, but the compiler loads its source
 * entry directly so it never receives a backslash-bearing node_modules link.
 */
export function resolveRuntimeBridgeImport(
	sourceRuntimeRoot: string,
	path: string,
): string | undefined {
	const subpath =
		path === RUNTIME_BRIDGE_PACKAGE
			? "index"
			: path.startsWith(`${RUNTIME_BRIDGE_PACKAGE}/`)
				? path.slice(RUNTIME_BRIDGE_PACKAGE.length + 1)
				: undefined;
	if (!subpath || subpath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
		return undefined;
	}

	const bridgeSourceRoot = join(dirname(resolve(sourceRuntimeRoot)), "narrafork-runtime-bridge", "src");
	const bridgeEntry = resolveRuntimeSourceFile(join(bridgeSourceRoot, subpath));
	if (!bridgeEntry || !isPathInside(bridgeSourceRoot, bridgeEntry)) {
		throw new Error(`Runtime bridge source entry is missing: ${join(bridgeSourceRoot, subpath)}`);
	}
	return bridgeEntry;
}

function toBunFilePath(path: string): string {
	return path.replaceAll("\\", "/");
}

export const PREBUNDLED_ZOD_FILENAME = "prebundled-zod-v4.js";

function isZodRuntimeImport(path: string): boolean {
	return path === "zod" || path === "zod/v4";
}

/**
 * Redirect public Zod entrypoints to the flat ESM bundle created inside the
 * isolated workspace. This bypasses Bun 1.3.13's compiled-executable linker
 * path through Zod's core re-export chain.
 */
export function resolvePrebundledZodImport(
	prebundledZodPath: string | undefined,
	path: string,
): string | undefined {
	if (!prebundledZodPath || !isZodRuntimeImport(path)) return undefined;
	if (!existsSync(prebundledZodPath) || !statSync(prebundledZodPath).isFile()) {
		throw new Error(`Prebundled Zod module is missing: ${prebundledZodPath}`);
	}
	return prebundledZodPath;
}

async function prebundleZodForCompiledRuntime(workspaceRoot: string): Promise<string> {
	const zodEntry = Bun.resolveSync("zod/v4", workspaceRoot);
	const prebundleDirectory = join(workspaceRoot, ".novelfork-prebundles");
	const prebundlePath = join(prebundleDirectory, PREBUNDLED_ZOD_FILENAME);
	mkdirSync(prebundleDirectory, { recursive: true });

	const result = await Bun.build({
		entrypoints: [zodEntry],
		target: "bun",
		format: "esm",
		splitting: false,
		minify: false,
		sourcemap: "none",
	});
	if (!result.success || result.outputs.length !== 1) {
		throw new Error(`Failed to prebundle Zod 4.3.6 for isolated Runtime compilation: ${prebundlePath}`);
	}
	await Bun.write(prebundlePath, result.outputs[0]);
	if (!existsSync(prebundlePath) || statSync(prebundlePath).size === 0) {
		throw new Error(`Zod prebundle was not written: ${prebundlePath}`);
	}
	return prebundlePath;
}

function isBareDependencySpecifier(path: string): boolean {
	return (
		!path.startsWith(".") &&
		!path.startsWith("#") &&
		!path.includes(":") &&
		!isAbsolute(path) &&
		!nodeBuiltinModules.has(path)
	);
}

/**
 * Resolves third-party imports through the isolated Runtime installation rather
 * than the product source tree. Returning the physical, slash-normalized file
 * path keeps Bun 1.3.13 away from Windows workspace-link resolution.
 */
export function resolveIsolatedRuntimeDependencyImport(
	isolatedWorkspaceRoot: string,
	path: string,
	resolveDir: string,
	fallbackResolveRoots: readonly string[] = [],
): string | undefined {
	if (!isBareDependencySpecifier(path)) return undefined;

	const workspaceRoot = resolve(isolatedWorkspaceRoot);
	const parents = [
		isPathInside(workspaceRoot, resolveDir) ? resolveDir : workspaceRoot,
		...fallbackResolveRoots.map((root) => resolve(root)),
	];
	const seen = new Set<string>();
	for (const parent of parents) {
		const normalizedParent = resolve(parent);
		if (seen.has(normalizedParent)) continue;
		seen.add(normalizedParent);
		try {
			const resolvedDependency = Bun.resolveSync(path, normalizedParent);
			if (
				isAbsolute(resolvedDependency) &&
				isPathInside(workspaceRoot, resolvedDependency)
			) {
				return resolvedDependency;
			}
		} catch {
			// Try the next isolated root (e.g. Runtime package node_modules).
		}
	}
	return undefined;
}

/**
 * Resolves an import only when it lands in the source Runtime tree. The compiler
 * uses this to replace the source Runtime graph with its isolated copy while
 * leaving NovelFork's product graph rooted in the current repository.
 */
export function resolveIsolatedRuntimeImport(
	sourceRuntimeRoot: string,
	isolatedRuntimeRoot: string,
	path: string,
	resolveDir: string,
): string | undefined {
	if (!path.startsWith(".") && !isAbsolute(path)) return undefined;

	const sourceCandidate = resolve(resolveDir, path);
	const sourceFile = resolveRuntimeSourceFile(sourceCandidate);
	if (!sourceFile || !isPathInside(sourceRuntimeRoot, sourceFile)) return undefined;

	const isolatedFile = join(isolatedRuntimeRoot, relative(sourceRuntimeRoot, sourceFile));
	if (!existsSync(isolatedFile) || !statSync(isolatedFile).isFile()) {
		throw new Error(
			`Isolated Runtime copy is missing mapped import: ${relative(sourceRuntimeRoot, sourceFile)}`,
		);
	}
	return isolatedFile;
}

function resolveIsolatedRuntimeFrontendAsset(
	isolatedRuntimeRoot: string,
	path: string,
	resolveDir: string,
): string | undefined {
	if (!path.startsWith(".") && !isAbsolute(path)) return undefined;

	const assetPath = resolve(resolveDir, path);
	const frontendRoot = join(isolatedRuntimeRoot, "dist", "frontend");
	return existsSync(assetPath) &&
		statSync(assetPath).isFile() &&
		isPathInside(frontendRoot, assetPath)
		? assetPath
		: undefined;
}

export function createIsolatedRuntimeResolverPlugin(
	sourceRuntimeRoot: string,
	isolatedRuntimeRoot: string,
	isolatedWorkspaceRoot = isolatedRuntimeRoot,
	prebundledZodPath?: string,
): Bun.BunPlugin {
	const sourceRoot = resolve(sourceRuntimeRoot);
	const isolatedRoot = resolve(isolatedRuntimeRoot);
	const workspaceRoot = resolve(isolatedWorkspaceRoot);

	return {
		name: "novelfork-isolated-runtime",
		setup(build) {
			build.onLoad({ filter: /.*/, namespace: "novelfork-isolated-runtime-file" }, (args) => ({
				contents: readFileSync(args.path),
				loader: "file",
			}));

			build.onResolve({ filter: /.*/ }, (args) => {
				if (args.namespace !== "file" || !args.resolveDir) return;
				// `Bun.plugin` does not expose import attributes to onResolve callbacks.
				// Detect the generated Runtime frontend tree directly and load every one
				// of its Vite artifacts as an opaque Bun file asset, including .js chunks.
				const frontendAsset = resolveIsolatedRuntimeFrontendAsset(
					isolatedRoot,
					args.path,
					args.resolveDir,
				);
				if (frontendAsset) {
					return {
						path: toBunFilePath(frontendAsset),
						namespace: "novelfork-isolated-runtime-file",
					};
				}

				const prebundledZod = resolvePrebundledZodImport(prebundledZodPath, args.path);
				if (prebundledZod) return { path: toBunFilePath(prebundledZod) };

				const bridgeEntry = resolveRuntimeBridgeImport(sourceRoot, args.path);
				if (bridgeEntry) return { path: toBunFilePath(bridgeEntry) };

				const mapped = resolveIsolatedRuntimeImport(
					sourceRoot,
					isolatedRoot,
					args.path,
					args.resolveDir,
				);
				if (mapped) return { path: toBunFilePath(mapped) };

				const dependency = resolveIsolatedRuntimeDependencyImport(
					workspaceRoot,
					args.path,
					args.resolveDir,
					// Bridge source is loaded from the product tree (outside the isolated
					// workspace) so bare deps must still resolve via isolated Runtime /
					// package installs rather than the host repo node_modules graph.
					[isolatedRoot, join(isolatedRoot, "node_modules")],
				);
				return dependency ? { path: toBunFilePath(dependency) } : undefined;
			});
		},
	};
}

export function createRuntimeBuildEnvironment(
	baseEnvironment: NodeJS.ProcessEnv,
	isolatedRuntimeRoot: string,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
	for (const name of Object.keys(environment)) {
		if (isRuntimeEnvironmentName(name)) delete environment[name];
	}

	environment.BUN_INSTALL_CACHE_DIR = join(isolatedRuntimeRoot, ".bun-cache");
	environment.NOVELFORK_PRODUCT_RUNTIME_ROOT = isolatedRuntimeRoot;
	return environment;
}

const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runPnpm(
	workspaceRoot: string,
	arguments_: readonly string[],
	environment: NodeJS.ProcessEnv,
	purpose: string,
): void {
	const result = Bun.spawnSync([PNPM_COMMAND, ...arguments_], {
		cwd: workspaceRoot,
		env: environment,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (result.exitCode !== 0) {
		throw new Error(`${purpose} failed with exit code ${result.exitCode ?? "unknown"}`);
	}
}

function runBun(
	workspaceRoot: string,
	arguments_: readonly string[],
	environment: NodeJS.ProcessEnv,
	purpose: string,
): void {
	const result = Bun.spawnSync([process.execPath, ...arguments_], {
		cwd: workspaceRoot,
		env: environment,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (result.exitCode !== 0) {
		throw new Error(`${purpose} failed with exit code ${result.exitCode ?? "unknown"}`);
	}
}

function runSandboxInstall(
	workspaceRoot: string,
	runtimeRoot: string,
	environment: NodeJS.ProcessEnv,
): void {
	// The sandbox mutates only its copied manifests to add compiler-only pins.
	// Refresh its private PNPM lock before using a frozen install; source lockfiles
	// and the Runtime's upstream Bun lock remain untouched.
	console.log("→ Refreshing the sandbox-only PNPM lockfile...");
	runPnpm(workspaceRoot, ["install", "--lockfile-only"], environment, "Sandbox PNPM lockfile refresh");
	console.log("→ Installing the isolated product workspace from its frozen PNPM lockfile...");
	runPnpm(
		workspaceRoot,
		["install", "--frozen-lockfile"],
		environment,
		"Isolated product workspace PNPM install",
	);
	// The local Runtime is deliberately excluded from pnpm-workspace.yaml. Install
	// its copied dependencies through its own frozen Bun lock before asserting that
	// compiler-required packages can resolve from the isolated Runtime.
	console.log("→ Installing the isolated Runtime from its frozen Bun lockfile...");
	runBun(runtimeRoot, ["install", "--frozen-lockfile"], environment, "Isolated Runtime Bun install");
}

function assertWorkspaceInstallation(workspaceRoot: string): void {
	const packageRoots = [
		workspaceRoot,
		...readdirSync(join(workspaceRoot, "packages"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(workspaceRoot, "packages", entry.name)),
	];
	const requiredPackages = ["@mantine/core", "drizzle-kit", "openai", "zod"] as const;
	for (const packageName of requiredPackages) {
		const installed = packageRoots.some((root) => {
			const manifest = join(root, "node_modules", packageName, "package.json");
			return existsSync(manifest) && statSync(manifest).isFile();
		});
		if (!installed) {
			throw new Error(`Isolated workspace dependency is missing after install: ${packageName}`);
		}
	}
}

export function assertRequiredRuntimeBunVersion(): void {
	if (Bun.version !== REQUIRED_RUNTIME_BUN_VERSION) {
		throw new Error(
			`NovelFork product compilation requires Bun ${REQUIRED_RUNTIME_BUN_VERSION}; received ${Bun.version}`,
		);
	}
}

function cleanupIsolatedRuntimeWorkspace(workspaceRoot: string): void {
	// Bun's Windows linker can briefly retain handles to files it just compiled.
	// Retry once per lock window, then fail closed rather than accumulating another
	// full workspace on the temporary volume.
	rmSync(workspaceRoot, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
	if (existsSync(workspaceRoot)) {
		throw new Error(`Isolated Runtime workspace cleanup left a temporary directory: ${workspaceRoot}`);
	}
}

/**
 * 隔离 Runtime 构建的临时工作目录。
 * 默认使用仓库内 .build-tmp/（与代码同盘，避免系统盘空间不足）；
 * 可用 NOVELFORK_BUILD_TEMP_DIR 覆盖（测试与特殊环境用）。
 */
export function isolatedRuntimeBuildTempDir(): string {
	const override = process.env.NOVELFORK_BUILD_TEMP_DIR?.trim();
	if (override) return resolve(override);
	// 脚本位于 scripts/lib/，向上两级即仓库根。
	return resolve(join(import.meta.dir, "..", "..", ".build-tmp"));
}

export async function createIsolatedRuntimeBuild(
	sourceRuntimeRoot: string,
): Promise<IsolatedRuntimeBuild> {
	assertRequiredRuntimeBunVersion();
	const sourceRoot = resolve(sourceRuntimeRoot);
	assertRuntimeSource(sourceRoot);
	const buildTempDir = isolatedRuntimeBuildTempDir();
	assertSufficientTemporaryDiskSpace(buildTempDir);

	const workspaceRoot = mkdtempSync(join(buildTempDir, "novelfork-product-runtime-"));
	let disposed = false;
	try {
		const root = copyIsolatedProductWorkspace(sourceRoot, workspaceRoot);
		// Overlay reconciliation compares package.json against exact overlay hashes,
		// so it must run before any sandbox-only dependency injection rewrites that
		// file. Injecting first makes the hash unrecognizable and fails the check.
		await reconcileSandboxRuntimeOverlay(workspaceRoot, root);
		ensureSandboxRuntimeDependencies(root);
		seedSandboxRuntimeMigrationHistory(workspaceRoot, root);
		const environment = createRuntimeBuildEnvironment(process.env, root);
		runSandboxInstall(workspaceRoot, root, environment);
		assertWorkspaceInstallation(workspaceRoot);
		const prebundledZodPath = await prebundleZodForCompiledRuntime(workspaceRoot);

		return {
			sourceRoot,
			root,
			workspaceRoot,
			prebundledZodPath,
			environment,
			resolverPlugin: createIsolatedRuntimeResolverPlugin(
				root,
				root,
				workspaceRoot,
				prebundledZodPath,
			),
			dispose() {
				if (disposed) return;
				disposed = true;
				cleanupIsolatedRuntimeWorkspace(workspaceRoot);
			},
		};
	} catch (error) {
		disposed = true;
		try {
			cleanupIsolatedRuntimeWorkspace(workspaceRoot);
		} catch (cleanupError) {
			throw new Error(
				`Isolated Runtime build failed and cleanup also failed for ${workspaceRoot}: ${String(cleanupError)}. Original error: ${String(error)}`,
			);
		}
		throw error;
	}
}

/**
 * Bun.build has no environment option. Scope its process-visible resolution
 * settings to the isolated Runtime build, then restore the caller environment.
 */
export async function withIsolatedRuntimeEnvironment<T>(
	environment: NodeJS.ProcessEnv,
	operation: () => Promise<T>,
): Promise<T> {
	const affectedNames = new Set<string>([
		...Object.keys(process.env).filter(isRuntimeEnvironmentName),
		...Object.keys(environment).filter(isRuntimeEnvironmentName),
		"NOVELFORK_PRODUCT_RUNTIME_ROOT",
	]);
	const previous = new Map<string, string | undefined>();

	for (const name of affectedNames) {
		previous.set(name, process.env[name]);
		const value = environment[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}

	try {
		return await operation();
	} finally {
		for (const name of affectedNames) {
			const value = previous.get(name);
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}
