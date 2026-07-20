import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	assertSufficientTemporaryDiskSpace,
	configureSandboxRootDependencies,
	createIsolatedRuntimeResolverPlugin,
	createRuntimeBuildEnvironment,
	ensureSandboxRuntimeDependencies,
	MINIMUM_ISOLATED_RUNTIME_FREE_BYTES,
	resolveIsolatedRuntimeDependencyImport,
	resolveIsolatedRuntimeImport,
	resolvePrebundledZodImport,
	resolveRuntimeBridgeImport,
	RUNTIME_BRIDGE_PACKAGE,
	seedSandboxRuntimeMigrationHistory,
	shouldCopyRuntimePath,
	withIsolatedRuntimeEnvironment,
} from "./lib/isolated-runtime-build.ts";

async function createDirectory(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}

describe("isolated Runtime build", () => {
	test("excludes transient Runtime artifacts from the source copy", () => {
		const root = "C:/runtime";
		expect(shouldCopyRuntimePath(root, join(root, "package.json"))).toBe(true);
		expect(shouldCopyRuntimePath(root, join(root, "drizzle", "0000_initial.sql"))).toBe(true);
		expect(shouldCopyRuntimePath(root, join(root, "node_modules", "zod", "index.js"))).toBe(false);
		expect(
			shouldCopyRuntimePath(root, join(root, ".narrafork-runtime-backups", "runtime.bun-build")),
		).toBe(false);
		expect(shouldCopyRuntimePath(root, join(root, "dist", "frontend", "index.html"))).toBe(false);
		expect(shouldCopyRuntimePath(root, join(root, "server", "generated", "build-info.ts"))).toBe(false);
		expect(shouldCopyRuntimePath(root, join(root, "state.db-wal"))).toBe(false);
	});

	test("seeds verified external migration history into the disposable Runtime", async () => {
		const root = await createDirectory("novelfork-runtime-migration-history-");
		const workspaceRoot = join(root, "workspace");
		const runtimeRoot = join(workspaceRoot, "packages", "narrafork-runtime-private");
		const migrationsRoot = join(
			workspaceRoot,
			"packages",
			"narrafork-runtime-overlay",
			"runtime-migrations",
		);

		try {
			await mkdir(join(migrationsRoot, "meta"), { recursive: true });
			await mkdir(join(runtimeRoot, "drizzle"), { recursive: true });
			await writeFile(
				join(migrationsRoot, "meta", "_journal.json"),
				JSON.stringify({ entries: [{ tag: "0000_initial" }] }),
			);
			await writeFile(join(migrationsRoot, "0000_initial.sql"), "CREATE TABLE example (id text);\n");
			await writeFile(join(migrationsRoot, "meta", "0000_snapshot.json"), "{}\n");
			await writeFile(join(runtimeRoot, "drizzle", "stale.sql"), "SELECT 'stale';\n");

			seedSandboxRuntimeMigrationHistory(workspaceRoot, runtimeRoot);

			expect(await readFile(join(runtimeRoot, "drizzle", "0000_initial.sql"), "utf8")).toBe(
				"CREATE TABLE example (id text);\n",
			);
			expect(await readFile(join(runtimeRoot, "drizzle", "meta", "0000_snapshot.json"), "utf8")).toBe(
				"{}\n",
			);
			await expect(readFile(join(runtimeRoot, "drizzle", "stale.sql"))).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects incomplete external migration history before compilation", async () => {
		const root = await createDirectory("novelfork-runtime-migration-history-incomplete-");
		const workspaceRoot = join(root, "workspace");
		const runtimeRoot = join(workspaceRoot, "packages", "narrafork-runtime-private");
		const migrationsRoot = join(
			workspaceRoot,
			"packages",
			"narrafork-runtime-overlay",
			"runtime-migrations",
		);

		try {
			await mkdir(join(migrationsRoot, "meta"), { recursive: true });
			await mkdir(runtimeRoot, { recursive: true });
			await writeFile(
				join(migrationsRoot, "meta", "_journal.json"),
				JSON.stringify({ entries: [{ tag: "0000_initial" }] }),
			);
			await writeFile(join(migrationsRoot, "0000_initial.sql"), "CREATE TABLE example (id text);\n");

			expect(() => seedSandboxRuntimeMigrationHistory(workspaceRoot, runtimeRoot)).toThrow(
				"Verified Runtime migration snapshot is missing",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("removes workspace-resolution variables from the Runtime environment", () => {
		const environment = createRuntimeBuildEnvironment(
			{
				PATH: "preserve-me",
				NODE_PATH: "workspace-node-modules",
				BUN_INSTALL: "workspace-bun",
				BUN_CONFIG_REGISTRY: "https://example.invalid",
				NPM_CONFIG_WORKSPACE: "runtime",
			},
			"C:/temporary/runtime",
		);

		expect(environment.PATH).toBe("preserve-me");
		expect(environment.NODE_PATH).toBeUndefined();
		expect(environment.BUN_INSTALL).toBeUndefined();
		expect(environment.BUN_CONFIG_REGISTRY).toBeUndefined();
		expect(environment.NPM_CONFIG_WORKSPACE).toBeUndefined();
		expect(environment.BUN_INSTALL_CACHE_DIR).toBe(join("C:/temporary/runtime", ".bun-cache"));
		expect(environment.NOVELFORK_PRODUCT_RUNTIME_ROOT).toBe("C:/temporary/runtime");
	});

	test("pins the Runtime Zod version only in the disposable sandbox manifest", async () => {
		const root = await createDirectory("novelfork-runtime-dependency-pin-");
		const manifestPath = join(root, "package.json");

		try {
			await writeFile(
				manifestPath,
				JSON.stringify({ dependencies: { zod: "^4.3.6", retained: "^1.0.0" } }),
			);

			ensureSandboxRuntimeDependencies(root);

			const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
				dependencies: Record<string, string>;
			};
			expect(manifest.dependencies).toEqual({
				jose: "^6.1.3",
				retained: "^1.0.0",
				zod: "4.3.6",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("pins the disposable workspace through a direct Zod dependency without source overrides", async () => {
		const root = await createDirectory("novelfork-workspace-dependency-pin-");
		const manifestPath = join(root, "package.json");

		try {
			await writeFile(
				manifestPath,
				JSON.stringify({
					dependencies: { retained: "^1.0.0" },
					overrides: { "@tiptap/core": "2.27.2", zod: "^4.3.6" },
				}),
			);

			configureSandboxRootDependencies(root);

			const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
				dependencies: Record<string, string>;
				overrides?: Record<string, string>;
			};
			expect(manifest.dependencies).toEqual({ retained: "^1.0.0", zod: "4.3.6" });
			expect(manifest.overrides).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("requires 10 GiB before creating an isolated Runtime workspace", () => {
		expect(MINIMUM_ISOLATED_RUNTIME_FREE_BYTES).toBe(10 * 1024 ** 3);
		expect(() =>
			assertSufficientTemporaryDiskSpace(tmpdir(), Number.MAX_SAFE_INTEGER),
		).toThrow("Insufficient temporary disk space");
	});

	test("redirects public Zod entrypoints to the flat prebundle", async () => {
		const root = await createDirectory("novelfork-zod-prebundle-");
		const prebundle = join(root, "prebundled-zod-v4.js");

		try {
			await writeFile(prebundle, "export const z = {};\n");

			expect(resolvePrebundledZodImport(prebundle, "zod")).toBe(prebundle);
			expect(resolvePrebundledZodImport(prebundle, "zod/v4")).toBe(prebundle);
			expect(resolvePrebundledZodImport(prebundle, "zod/v4/core")).toBeUndefined();
			expect(resolvePrebundledZodImport(prebundle, "unrelated-package")).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("compiler resolver imports Zod through the flat prebundle", async () => {
		const root = await createDirectory("novelfork-zod-prebundle-resolver-");
		const runtimeRoot = join(root, "runtime");
		const prebundle = join(root, "prebundled-zod-v4.js");
		const entrypoint = join(root, "entry.ts");
		const output = join(root, "compiled.mjs");

		try {
			await mkdir(runtimeRoot, { recursive: true });
			await writeFile(prebundle, 'export const z = { source: "prebundled" };\n');
			await writeFile(
				entrypoint,
				'import { z } from "zod/v4";\nconsole.log(z.source);\n',
			);

			const result = await Bun.build({
				entrypoints: [entrypoint],
				target: "bun",
				format: "esm",
				plugins: [
					createIsolatedRuntimeResolverPlugin(runtimeRoot, runtimeRoot, root, prebundle),
				],
			});
			expect(result.success).toBe(true);
			expect(result.outputs).toHaveLength(1);
			await Bun.write(output, result.outputs[0]);

			const execution = Bun.spawnSync([process.execPath, output], { stdout: "pipe", stderr: "pipe" });
			expect(execution.exitCode).toBe(0);
			expect(new TextDecoder().decode(execution.stdout).trim()).toBe("prebundled");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("resolves the Runtime bridge without a workspace node_modules link", async () => {
		const root = await createDirectory("novelfork-runtime-bridge-resolver-");
		const sourceRuntimeRoot = join(root, "packages", "narrafork-runtime-private");
		const bridgeEntry = join(root, "packages", "narrafork-runtime-bridge", "src", "index.ts");
		const runtimeDatabaseEntry = join(root, "packages", "narrafork-runtime-bridge", "src", "runtime-db.ts");

		try {
			await mkdir(dirname(bridgeEntry), { recursive: true });
			await writeFile(bridgeEntry, "export {};\n");
			await writeFile(runtimeDatabaseEntry, "export {};\n");

			expect(resolveRuntimeBridgeImport(sourceRuntimeRoot, RUNTIME_BRIDGE_PACKAGE)).toBe(bridgeEntry);
			expect(resolveRuntimeBridgeImport(sourceRuntimeRoot, `${RUNTIME_BRIDGE_PACKAGE}/runtime-db`)).toBe(
				runtimeDatabaseEntry,
			);
			expect(resolveRuntimeBridgeImport(sourceRuntimeRoot, "unrelated-package")).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("resolves third-party imports from the isolated Runtime installation", async () => {
		const root = await createDirectory("novelfork-isolated-runtime-dependency-");
		const isolatedRoot = join(root, "isolated-runtime");
		const productSource = join(root, "product-source");
		const packageRoot = join(isolatedRoot, "node_modules", "example-runtime-dependency");
		const entry = join(packageRoot, "index.js");

		try {
			await mkdir(packageRoot, { recursive: true });
			await writeFile(
				join(packageRoot, "package.json"),
				'{"name":"example-runtime-dependency","main":"./index.js"}\n',
			);
			await writeFile(entry, "export const dependency = true;\n");

			expect(
				resolveIsolatedRuntimeDependencyImport(
					isolatedRoot,
					"example-runtime-dependency",
					productSource,
				),
			).toBe(entry);
			expect(
				resolveIsolatedRuntimeDependencyImport(isolatedRoot, "node:fs", productSource),
			).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("redirects source Runtime imports into the isolated copy", async () => {
		const root = await createDirectory("novelfork-isolated-runtime-resolver-");
		const sourceRoot = join(root, "source-runtime");
		const isolatedRoot = join(root, "isolated-runtime");
		const importer = join(root, "packages", "runtime-bridge", "src", "index.ts");

		try {
			await mkdir(join(sourceRoot, "server", "lib", "product-host"), { recursive: true });
			await mkdir(join(isolatedRoot, "server", "lib", "product-host"), { recursive: true });
			await mkdir(dirname(importer), { recursive: true });
			await writeFile(join(sourceRoot, "server", "lib", "product-host", "index.ts"), "export {};\n");
			await writeFile(join(isolatedRoot, "server", "lib", "product-host", "index.ts"), "export {};\n");
			await writeFile(importer, "export {};\n");

			expect(
				resolveIsolatedRuntimeImport(
					sourceRoot,
					isolatedRoot,
					"../../../source-runtime/server/lib/product-host",
					join(root, "packages", "runtime-bridge", "src"),
				),
			).toBe(join(isolatedRoot, "server", "lib", "product-host", "index.ts"));
			expect(
				resolveIsolatedRuntimeImport(sourceRoot, isolatedRoot, "./index.ts", join(root, "outside")),
			).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("embeds generated frontend artifacts as opaque file assets", async () => {
		const root = await createDirectory("novelfork-embedded-frontend-resolver-");
		const runtimeRoot = join(root, "runtime");
		const generatedEntry = join(runtimeRoot, "server", "generated", "embedded-frontend.ts");
		const frontendAsset = join(runtimeRoot, "dist", "frontend", "assets", "entry.js");
		const entrypoint = join(runtimeRoot, "server", "entry.ts");

		try {
			await mkdir(dirname(generatedEntry), { recursive: true });
			await mkdir(dirname(frontendAsset), { recursive: true });
			await writeFile(frontendAsset, "export const frontendBundle = true;\n");
			await writeFile(
				generatedEntry,
				[
					'import frontendAsset from "../../dist/frontend/assets/entry.js" with { type: "file" };',
					"export { frontendAsset };",
					"",
				].join("\n"),
			);
			await writeFile(
				entrypoint,
				'import { frontendAsset } from "./generated/embedded-frontend.ts";\nconsole.log(frontendAsset);\n',
			);

			const artifact = join(root, "embedded-frontend-smoke.exe");
			const result = await Bun.build({
				entrypoints: [entrypoint],
				compile: {
					target: "bun-windows-x64",
					outfile: artifact,
				},
				minify: true,
				plugins: [createIsolatedRuntimeResolverPlugin(runtimeRoot, runtimeRoot, root)],
			});
			expect(result.success).toBe(true);

			if (process.platform === "win32") {
				const execution = Bun.spawnSync([artifact], { stdout: "pipe", stderr: "pipe" });
				expect(execution.exitCode).toBe(0);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("scopes and restores Runtime resolver environment variables", async () => {
		const previousNodePath = process.env.NODE_PATH;
		const previousBunConfig = process.env.BUN_CONFIG_REGISTRY;
		const previousRuntimeRoot = process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT;
		process.env.NODE_PATH = "workspace-node-modules";
		process.env.BUN_CONFIG_REGISTRY = "https://workspace.invalid";
		delete process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT;

		try {
			const environment = createRuntimeBuildEnvironment(process.env, "C:/temporary/runtime");
			await withIsolatedRuntimeEnvironment(environment, async () => {
				expect(process.env.NODE_PATH).toBeUndefined();
				expect(process.env.BUN_CONFIG_REGISTRY).toBeUndefined();
				expect(process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT).toBe("C:/temporary/runtime");
			});
			expect(process.env.NODE_PATH).toBe("workspace-node-modules");
			expect(process.env.BUN_CONFIG_REGISTRY).toBe("https://workspace.invalid");
			expect(process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT).toBeUndefined();
		} finally {
			if (previousNodePath === undefined) delete process.env.NODE_PATH;
			else process.env.NODE_PATH = previousNodePath;
			if (previousBunConfig === undefined) delete process.env.BUN_CONFIG_REGISTRY;
			else process.env.BUN_CONFIG_REGISTRY = previousBunConfig;
			if (previousRuntimeRoot === undefined) delete process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT;
			else process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT = previousRuntimeRoot;
		}
	});
});
