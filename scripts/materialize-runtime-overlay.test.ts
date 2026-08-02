import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpstreamLock } from "./import-narrafork-runtime.ts";
import {
	type MaterializeRuntimeOverlayOptions,
	materializeRuntimeOverlay,
	parseCliArgs,
} from "./materialize-runtime-overlay.ts";

const upstream = {
	repository: "example/private-runtime",
	commit: "1".repeat(40),
	tree: "2".repeat(40),
};

interface Fixture {
	readonly root: string;
	readonly target: string;
	readonly overlay: string;
	readonly addPrevious: string;
	readonly addResult: string;
	readonly patchBase: string;
	readonly patchResult: string;
	readonly newAddResult: string;
}

let fixture: Fixture;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function write(path: string, content: string): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, content);
}

async function readLock(target: string): Promise<UpstreamLock> {
	return JSON.parse(
		await readFile(join(target, "UPSTREAM.lock.json"), "utf8"),
	) as UpstreamLock;
}

async function createFixture(): Promise<Fixture> {
	const root = await mkdtemp(
		join(tmpdir(), "novelfork-materialize-overlay-test-"),
	);
	const target = join(root, "runtime");
	const overlay = join(root, "overlay");
	const addPrevious = "export const contract = 'previous-overlay';\n";
	const addResult = "export const contract = 'current-overlay';\n";
	const newAddResult = 'declare module "@server/generated/current" {}\n';
	const patchBase = 'export const mode = "upstream";\n';
	const patchResult = 'export const mode = "overlay";\n';
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

	await write(join(target, "server", "app.ts"), patchBase);
	await write(
		join(target, "server", "lib", "product-host", "contracts.ts"),
		addPrevious,
	);
	await write(
		join(target, "frontend", "local-dirty.ts"),
		"keep this dirty change\n",
	);
	await write(
		join(overlay, "files", "server", "lib", "product-host", "contracts.ts"),
		addResult,
	);
	await write(
		join(overlay, "files", "server", "types", "novelfork-generated-modules.d.ts"),
		newAddResult,
	);
	await write(join(overlay, "patches", "server-app.patch"), patch);

	const lock: UpstreamLock = {
		schemaVersion: 1,
		repository: upstream.repository,
		remote: "git@github.com:example/private-runtime.git",
		commit: upstream.commit,
		tree: upstream.tree,
		branch: "main",
		version: "1.0.0",
		importedAt: "2026-07-20T00:00:00.000Z",
		trackedFileCount: 2,
		importMethod: "git-archive",
		managedOverlay: {
			operations: [
				{
					id: "previous-product-contract",
					target: "server/lib/product-host/contracts.ts",
					sha256: sha256(addPrevious),
				},
				{
					id: "unselected-managed-output",
					target: "shared/learning-contract.ts",
					sha256: sha256("previous-unselected-output\n"),
				},
			],
		},
	};
	await write(
		join(target, "UPSTREAM.lock.json"),
		`${JSON.stringify(lock, null, 2)}\n`,
	);
	await write(
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
						sha256: sha256(addResult),
						reason: "Update a previously managed generic Runtime contract.",
					},
					{
						id: "generated-module-declaration",
						type: "add",
						target: "server/types/novelfork-generated-modules.d.ts",
						source: "files/server/types/novelfork-generated-modules.d.ts",
						sha256: sha256(newAddResult),
						reason: "Add a new generic Runtime generated-module declaration.",
					},
					{
						id: "product-route-hooks",
						type: "patch",
						target: "server/app.ts",
						patch: "patches/server-app.patch",
						patchSha256: sha256(patch),
						baseSha256: sha256(patchBase),
						resultSha256: sha256(patchResult),
						reason: "Mount generic optional host hooks.",
					},
				],
			},
			null,
			2,
		)}\n`,
	);

	return {
		root,
		target,
		overlay,
		addPrevious,
		addResult,
		patchBase,
		patchResult,
		newAddResult,
	};
}

function options(
	operationIds: readonly string[],
): MaterializeRuntimeOverlayOptions {
	return {
		target: fixture.target,
		overlayRoot: fixture.overlay,
		operationIds,
	};
}

beforeEach(async () => {
	fixture = await createFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

describe("materializeRuntimeOverlay", () => {
	test("物化已管理 add、新 add 和精确 patch，并保留无关 Runtime 脏改动", async () => {
		const result = await materializeRuntimeOverlay(
			options([
				"product-host-contract",
				"generated-module-declaration",
				"product-route-hooks",
			]),
		);

		expect(result.operations.map((operation) => operation.id)).toEqual([
			"product-host-contract",
			"generated-module-declaration",
			"product-route-hooks",
		]);
		expect(
			await readFile(
				join(fixture.target, "server", "lib", "product-host", "contracts.ts"),
				"utf8",
			),
		).toBe(fixture.addResult);
		expect(
			await readFile(
				join(fixture.target, "server", "types", "novelfork-generated-modules.d.ts"),
				"utf8",
			),
		).toBe(fixture.newAddResult);
		expect(
			await readFile(join(fixture.target, "server", "app.ts"), "utf8"),
		).toBe(fixture.patchResult);
		expect(
			await readFile(
				join(fixture.target, "frontend", "local-dirty.ts"),
				"utf8",
			),
		).toBe("keep this dirty change\n");
		expect((await readLock(fixture.target)).managedOverlay?.operations).toEqual(
			[
				expect.objectContaining({
					id: "unselected-managed-output",
					target: "shared/learning-contract.ts",
				}),
				expect.objectContaining({
					id: "product-host-contract",
					target: "server/lib/product-host/contracts.ts",
					sha256: sha256(fixture.addResult),
				}),
				expect.objectContaining({
					id: "generated-module-declaration",
					target: "server/types/novelfork-generated-modules.d.ts",
					sha256: sha256(fixture.newAddResult),
				}),
				expect.objectContaining({
					id: "product-route-hooks",
					target: "server/app.ts",
					sha256: sha256(fixture.patchResult),
				}),
			],
		);
	});

	test("拒绝缺少显式选择依赖的 operation，并按依赖顺序物化", async () => {
		const manifestPath = join(fixture.overlay, "runtime-overlay.manifest.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			operations: Array<{ id: string; dependsOn?: string[] }>;
		};
		const patch = manifest.operations.find(
			(operation) => operation.id === "product-route-hooks",
		);
		if (!patch) throw new Error("fixture patch operation is missing");
		patch.dependsOn = ["product-host-contract"];
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

		await expect(
			materializeRuntimeOverlay(options(["product-route-hooks"])),
		).rejects.toThrow(/缺少显式选择的依赖/);

		const result = await materializeRuntimeOverlay(
			options(["product-route-hooks", "product-host-contract"]),
		);
		expect(result.operations.map((operation) => operation.id)).toEqual([
			"product-host-contract",
			"product-route-hooks",
		]);
	});

	test("patch 在 lock 与输出匹配时安全幂等重跑", async () => {
		await materializeRuntimeOverlay(options(["product-route-hooks"]));
		const lockAfterFirstRun = await readFile(
			join(fixture.target, "UPSTREAM.lock.json"),
			"utf8",
		);

		const secondRun = await materializeRuntimeOverlay(
			options(["product-route-hooks"]),
		);

		expect(secondRun.operations).toEqual([
			expect.objectContaining({
				id: "product-route-hooks",
				sha256: sha256(fixture.patchResult),
			}),
		]);
		expect(
			await readFile(join(fixture.target, "server", "app.ts"), "utf8"),
		).toBe(fixture.patchResult);
		expect(
			await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8"),
		).toBe(lockAfterFirstRun);
	});

	test("已有物化锁时拒绝执行", async () => {
		const lockDirectory = join(
			fixture.root,
			".runtime-overlay-materialize.lock",
		);
		await mkdir(lockDirectory);

		await expect(
			materializeRuntimeOverlay(options(["product-route-hooks"])),
		).rejects.toThrow(/物化锁已存在/);
		expect(
			await readFile(join(fixture.target, "server", "app.ts"), "utf8"),
		).toBe(fixture.patchBase);
	});

	test("拒绝已改动且不再匹配 managedOverlay 旧 SHA 的 add target", async () => {
		const lockBefore = await readFile(
			join(fixture.target, "UPSTREAM.lock.json"),
			"utf8",
		);
		await writeFile(
			join(fixture.target, "server", "lib", "product-host", "contracts.ts"),
			"tampered target\n",
		);

		await expect(
			materializeRuntimeOverlay(options(["product-host-contract"])),
		).rejects.toThrow(/managedOverlay.*旧 SHA|旧 SHA/);
		expect(
			await readFile(
				join(fixture.target, "server", "lib", "product-host", "contracts.ts"),
				"utf8",
			),
		).toBe("tampered target\n");
		expect(
			await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8"),
		).toBe(lockBefore);
	});

	test("拒绝与 overlay manifest 上游身份不匹配的 target", async () => {
		const lockPath = join(fixture.target, "UPSTREAM.lock.json");
		const lock = await readLock(fixture.target);
		await writeFile(
			lockPath,
			`${JSON.stringify({ ...lock, commit: "3".repeat(40) }, null, 2)}\n`,
		);

		await expect(
			materializeRuntimeOverlay(options(["product-route-hooks"])),
		).rejects.toThrow(/上游身份.*不一致/);
		expect(
			await readFile(join(fixture.target, "server", "app.ts"), "utf8"),
		).toBe(fixture.patchBase);
	});
});

describe("parseCliArgs", () => {
	test("支持重复和逗号分隔的 --operation", () => {
		expect(
			parseCliArgs([
				"--target",
				"runtime",
				"--overlay",
				"overlay",
				"--operation",
				"first,second",
				"--operation",
				"third",
			]),
		).toEqual({
			target: "runtime",
			overlayRoot: "overlay",
			operationIds: ["first", "second", "third"],
		});
	});
});
