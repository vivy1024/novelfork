import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	prepareRuntimeReleaseArtifacts,
	REQUIRED_PARCEL_WATCHER_PLATFORMS,
} from "./lib/prepare-runtime-release-artifacts.ts";

let runtimeRoot: string;

async function write(path: string, content: string | Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

async function createRuntimeFixture(): Promise<void> {
	await write(join(runtimeRoot, "dist", "frontend", "index.html"), "<!doctype html>");
	await write(join(runtimeRoot, "dist", "frontend", "assets", "a.js"), "export const a = 1;");
	await write(join(runtimeRoot, "dist", "frontend", "assets", "b.js"), "export const b = 2;");
	await write(
		join(runtimeRoot, "drizzle", "meta", "_journal.json"),
		JSON.stringify({ entries: [{ tag: "0000_initial" }] }),
	);
	await write(join(runtimeRoot, "drizzle", "0000_initial.sql"), "CREATE TABLE example (id integer);");
	await write(
		join(runtimeRoot, "changelogs", "v1.2.0.json"),
		JSON.stringify({ version: "1.2.0", date: "2026-01-01", en: "Older", "zh-CN": "旧版" }),
	);
	await write(
		join(runtimeRoot, "changelogs", "v2.0.0.json"),
		JSON.stringify({ version: "v2.0.0", date: "2026-02-01", en: "Newest" }),
	);
	await write(
		join(runtimeRoot, "changelogs", "invalid.json"),
		JSON.stringify({ version: "not-semver", date: "2026-03-01", en: "Ignored" }),
	);
}

async function materializeParcelWatcher(): Promise<void> {
	const generatedRoot = join(runtimeRoot, "server", "generated");
	const imports = REQUIRED_PARCEL_WATCHER_PLATFORMS.map(
		(platform) => `// watcher-${platform}.node`,
	).join("\n");
	await write(join(generatedRoot, "parcel-native-loader.ts"), `${imports}\n`);
	for (const platform of REQUIRED_PARCEL_WATCHER_PLATFORMS) {
		await write(
			join(generatedRoot, "parcel-watcher-binaries", `watcher-${platform}.node`),
			new Uint8Array([1]),
		);
	}
}

beforeEach(async () => {
	runtimeRoot = await mkdtemp(join(tmpdir(), "novelfork-runtime-release-artifacts-test-"));
	await createRuntimeFixture();
	await materializeParcelWatcher();
});

afterEach(async () => {
	await rm(runtimeRoot, { recursive: true, force: true });
});

describe("Runtime release artifact preparation", () => {
	test("generates deterministic embedded assets, migrations, changelogs, and build metadata", async () => {
		const result = prepareRuntimeReleaseArtifacts(
			{
				runtimeRoot,
				productName: "NovelFork",
				productVersion: "3.2.0",
				buildCommit: "abcdef0",
				buildPlatform: "win-x64",
			},
			{
				generateParcelWatcher: () => undefined,
			},
		);

		expect(result.frontendAssetCount).toBe(3);
		expect(result.migrationCount).toBe(1);
		expect(result.changelogCount).toBe(2);
		expect(result.generatedFiles).toHaveLength(4);

		const generatedRoot = join(runtimeRoot, "server", "generated");
		const frontend = await readFile(join(generatedRoot, "embedded-frontend.ts"), "utf8");
		expect(frontend.indexOf("assets/a.js")).toBeLessThan(frontend.indexOf("assets/b.js"));
		expect(frontend).toContain('"/index.html": _asset2');

		const migrations = await readFile(join(generatedRoot, "embedded-migrations-data.ts"), "utf8");
		expect(migrations).toContain("0000_initial.sql");
		expect(migrations).toContain("CREATE TABLE example");

		const changelog = await readFile(join(generatedRoot, "embedded-changelog.ts"), "utf8");
		expect(changelog.indexOf('"v2.0.0"')).toBeLessThan(changelog.indexOf('"1.2.0"'));
		expect(changelog).not.toContain("not-semver");

		const buildInfo = await readFile(join(generatedRoot, "build-info.ts"), "utf8");
		expect(buildInfo).toContain('buildProduct = "NovelFork"');
		expect(buildInfo).toContain('buildVersion = "3.2.0"');
		expect(buildInfo).toContain('buildCommit = "abcdef0"');
		expect(buildInfo).toContain('buildPlatform = "win-x64"');
	});

	test("embeds checked-in migration history without invoking an interactive schema generator", () => {
		let generatorCalls = 0;

		prepareRuntimeReleaseArtifacts(
			{
				runtimeRoot,
				productName: "NovelFork",
				productVersion: "3.2.0",
				buildCommit: "abcdef0",
				buildPlatform: "win-x64",
			},
			{
				generateParcelWatcher: () => undefined,
				runBun: () => {
					generatorCalls += 1;
					throw new Error("release build must not generate a migration from an interactive schema diff");
				},
			},
		);

		expect(generatorCalls).toBe(0);
	});

	test("fails before compile when any required parcel watcher target is absent", async () => {
		await rm(
			join(runtimeRoot, "server", "generated", "parcel-watcher-binaries", "watcher-win32-arm64.node"),
		);

		expect(() =>
			prepareRuntimeReleaseArtifacts(
				{
					runtimeRoot,
					productName: "NovelFork",
					productVersion: "3.2.0",
					buildCommit: "abcdef0",
					buildPlatform: "win-x64",
				},
				{
					generateParcelWatcher: () => undefined,
				},
			),
		).toThrow(/Parcel watcher binary \(win32-arm64\) is missing/);
	});
});
