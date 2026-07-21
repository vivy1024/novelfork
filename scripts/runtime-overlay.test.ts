import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	replayRuntimeOverlay,
	verifyRuntimeOverlay,
} from "./runtime-overlay.ts";

const upstream = {
	repository: "example/private-runtime",
	commit: "1".repeat(40),
	tree: "2".repeat(40),
};

let root: string;

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

async function write(path: string, content: string): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, content);
}

async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

async function initializeGitRepository(path: string): Promise<void> {
	const process = Bun.spawn(["git", "init", "--quiet"], {
		cwd: path,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0)
		throw new Error(`git init failed: ${(stderr || stdout).trim()}`);
}

async function createOverlayFixture(): Promise<{
	overlay: string;
	staging: string;
	base: string;
	result: string;
}> {
	const overlay = join(root, "overlay");
	const staging = join(root, "staging");
	const base = 'export const mode = "upstream";\n';
	const result = 'export const mode = "overlay";\n';
	const addSource = join(
		overlay,
		"files",
		"server",
		"lib",
		"product-host",
		"contracts.ts",
	);
	const patchPath = join(overlay, "patches", "server-app.product-host.patch");
	const migrationPath = join(
		overlay,
		"runtime-migrations",
		"meta",
		"_journal.json",
	);
	const patch = [
		"diff --git a/server/app.ts b/server/app.ts",
		"index 1111111..2222222 100644",
		"--- a/server/app.ts",
		"+++ b/server/app.ts",
		"@@ -1 +1 @@",
		'-export const mode = "upstream";',
		'+export const mode = "overlay";',
		"",
	].join("\n");
	const addContent =
		"export interface RuntimeProductIntegration { readonly id: string; }\n";
	const migrationContent = '{"entries":[]}\n';

	await write(addSource, addContent);
	await write(patchPath, patch);
	await write(migrationPath, migrationContent);
	await write(join(staging, "server", "app.ts"), base);

	const migrationTreeHash = createHash("sha256")
		.update(`meta/_journal.json\0${sha256(migrationContent)}\n`)
		.digest("hex");
	await writeFile(
		join(overlay, "runtime-overlay.manifest.json"),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				upstream,
				operations: [
					{
						id: "product-host-contract",
						type: "add",
						target: "server/lib/product-host/contracts.ts",
						source: "files/server/lib/product-host/contracts.ts",
						sha256: sha256(addContent),
						reason:
							"Expose the product-neutral Runtime product integration contract.",
					},
					{
						id: "product-route-hooks",
						type: "patch",
						target: "server/app.ts",
						patch: "patches/server-app.product-host.patch",
						patchSha256: sha256(patch),
						baseSha256: sha256(base),
						resultSha256: sha256(result),
						reason:
							"Mount optional authenticated routes through the generic host integration.",
					},
					{
						id: "runtime-migrations",
						type: "copy",
						target: "runtime-migrations",
						source: "runtime-migrations",
						sha256: migrationTreeHash,
						role: "external-migration-assets",
						reason:
							"Keep immutable Runtime migration assets outside the replaceable Runtime tree.",
					},
				],
				exclude: [
					"frontend/**",
					"package.json",
					"tsconfig.json",
					"drizzle/**",
					"dist/**",
				],
			},
			null,
			2,
		)}\n`,
	);

	return { overlay, staging, base, result };
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "novelfork-runtime-overlay-test-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Runtime overlay replay", () => {
	test("applies verified add and exact patch operations without copying external migrations into Runtime", async () => {
		const fixture = await createOverlayFixture();

		const replay = await replayRuntimeOverlay({
			overlayRoot: fixture.overlay,
			stagingRoot: fixture.staging,
			upstream,
		});

		expect(replay.operations.map((operation) => operation.id)).toEqual([
			"product-host-contract",
			"product-route-hooks",
			"runtime-migrations",
		]);
		expect(
			await readFile(join(fixture.staging, "server", "app.ts"), "utf8"),
		).toBe(fixture.result);
		expect(
			await readFile(
				join(fixture.staging, "server", "lib", "product-host", "contracts.ts"),
				"utf8",
			),
		).toContain("RuntimeProductIntegration");
		expect(
			await Bun.file(
				join(fixture.staging, "runtime-migrations", "meta", "_journal.json"),
			).exists(),
		).toBe(false);
	});

	test("patches a staging tree nested below another Git worktree and removes temporary metadata", async () => {
		const fixture = await createOverlayFixture();
		await initializeGitRepository(root);

		await replayRuntimeOverlay({
			overlayRoot: fixture.overlay,
			stagingRoot: fixture.staging,
			upstream,
		});

		expect(
			await readFile(join(fixture.staging, "server", "app.ts"), "utf8"),
		).toBe(fixture.result);
		expect(await pathExists(join(fixture.staging, ".git"))).toBe(false);
	});

	test("fails closed before patching when the upstream base hash differs", async () => {
		const fixture = await createOverlayFixture();
		await writeFile(
			join(fixture.staging, "server", "app.ts"),
			'export const mode = "new-upstream";\n',
		);

		await expect(
			replayRuntimeOverlay({
				overlayRoot: fixture.overlay,
				stagingRoot: fixture.staging,
				upstream,
			}),
		).rejects.toThrow(/base hash mismatch|explicit rebase/);
		expect(
			await readFile(join(fixture.staging, "server", "app.ts"), "utf8"),
		).toBe('export const mode = "new-upstream";\n');
	});

	test("rejects a non-allowlisted overlay target before staging replay", async () => {
		const fixture = await createOverlayFixture();
		const manifestPath = join(fixture.overlay, "runtime-overlay.manifest.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			operations: Array<{ target: string }>;
		};
		const firstOperation = manifest.operations[0];
		if (!firstOperation)
			throw new Error("fixture manifest unexpectedly has no operations");
		firstOperation.target = "frontend/routes/books/index.tsx";
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

		await expect(verifyRuntimeOverlay(fixture.overlay)).rejects.toThrow(
			/not allowlisted/,
		);
	});

	test("rejects an overlay whose upstream identity does not match the staged archive", async () => {
		const fixture = await createOverlayFixture();

		await expect(
			replayRuntimeOverlay({
				overlayRoot: fixture.overlay,
				stagingRoot: fixture.staging,
				upstream: { ...upstream, commit: "3".repeat(40) },
			}),
		).rejects.toThrow(/upstream mismatch/);
		expect(
			await readFile(join(fixture.staging, "server", "app.ts"), "utf8"),
		).toBe(fixture.base);
	});

	test("rejects malformed, missing, self-referential, and cyclic dependencies", async () => {
		const fixture = await createOverlayFixture();
		const manifestPath = join(fixture.overlay, "runtime-overlay.manifest.json");
		const readManifest = async () =>
			JSON.parse(await readFile(manifestPath, "utf8")) as {
				operations: Array<{ id: string; dependsOn?: unknown }>;
			};
		const writeManifest = async (manifest: unknown) =>
			writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		const operationAt = (
			manifest: Awaited<ReturnType<typeof readManifest>>,
			index: number,
		) => {
			const operation = manifest.operations[index];
			if (!operation)
				throw new Error(
					`fixture manifest is missing operation at index ${index}`,
				);
			return operation;
		};

		let manifest = await readManifest();
		operationAt(manifest, 0).dependsOn = [""];
		await writeManifest(manifest);
		await expect(verifyRuntimeOverlay(fixture.overlay)).rejects.toThrow(
			/dependsOn\[0\].*non-empty string/,
		);

		manifest = await readManifest();
		operationAt(manifest, 0).dependsOn = [
			"product-route-hooks",
			"product-route-hooks",
		];
		await writeManifest(manifest);
		await expect(verifyRuntimeOverlay(fixture.overlay)).rejects.toThrow(
			/contains a duplicate/,
		);

		manifest = await readManifest();
		operationAt(manifest, 0).dependsOn = ["missing-operation"];
		await writeManifest(manifest);
		await expect(verifyRuntimeOverlay(fixture.overlay)).rejects.toThrow(
			/dependency does not exist/,
		);

		manifest = await readManifest();
		operationAt(manifest, 0).dependsOn = ["product-host-contract"];
		await writeManifest(manifest);
		await expect(verifyRuntimeOverlay(fixture.overlay)).rejects.toThrow(
			/must not depend on itself/,
		);

		manifest = await readManifest();
		operationAt(manifest, 0).dependsOn = ["product-route-hooks"];
		operationAt(manifest, 1).dependsOn = ["product-host-contract"];
		await writeManifest(manifest);
		await expect(verifyRuntimeOverlay(fixture.overlay)).rejects.toThrow(
			/dependency cycle detected/,
		);
	});

	test("accepts the generic generated-module declaration in the production overlay", async () => {
		const overlayRoot = join(
			import.meta.dir,
			"..",
			"packages",
			"narrafork-runtime-overlay",
		);
		const manifest = await verifyRuntimeOverlay(overlayRoot);
		const generatedModules = manifest.operations.find(
			(operation) =>
				operation.id === "add-runtime-generated-module-declarations",
		);

		expect(generatedModules).toMatchObject({
			type: "add",
			target: "server/generated-modules.d.ts",
		});
	});

	test("declares generic embedded narrator transport operations", async () => {
		const overlayRoot = join(
			import.meta.dir,
			"..",
			"packages",
			"narrafork-runtime-overlay",
		);
		const manifest = await verifyRuntimeOverlay(overlayRoot);
		const byId = new Map(
			manifest.operations.map((operation) => [operation.id, operation]),
		);

		expect(
			byId.get("patch-runtime-narrator-ws-manager-connection-lease"),
		).toMatchObject({
			type: "patch",
			target: "frontend/lib/narrator-ws-manager.ts",
		});
		expect(byId.get("add-runtime-frontend-host-providers")).toMatchObject({
			dependsOn: ["patch-runtime-narrator-ws-manager-connection-lease"],
		});
		expect(
			byId.get("patch-runtime-app-root-layout-connection-lease"),
		).toMatchObject({
			type: "patch",
			target: "frontend/components/AppRootLayout.tsx",
			dependsOn: ["patch-runtime-narrator-ws-manager-connection-lease"],
		});
		expect(
			byId.get("patch-runtime-narrator-ws-manager-connection-lease-test"),
		).toMatchObject({
			dependsOn: ["patch-runtime-narrator-ws-manager-connection-lease"],
		});
		expect(byId.get("add-runtime-frontend-host-providers-test")).toMatchObject({
			type: "add",
			target: "frontend/components/host/RuntimeFrontendHostProviders.test.tsx",
			dependsOn: [
				"add-runtime-frontend-host-providers",
				"patch-runtime-narrator-ws-manager-connection-lease",
			],
		});
	});
});
