import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	PRODUCT_HELPER_REPOSITORY,
	PRODUCT_RELEASE_ASSET_PREFIX,
	PRODUCT_RELEASE_REPOSITORY,
	PRODUCT_UPDATE_ID,
	productBuildDefines,
	productReleaseArtifactName,
	writeProductBinaryMetadata,
} from "./lib/product-release-identity.ts";

function findRepositoryRoot(start: string): string {
	let directory = start;
	while (true) {
		if (
			existsSync(join(directory, "main.ts")) &&
			existsSync(join(directory, "packages", "narrafork-runtime-private", "server"))
		) {
			return directory;
		}
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Unable to locate NovelFork repository root");
		directory = parent;
	}
}

const repositoryRoot = findRepositoryRoot(import.meta.dir);
const runtimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");
const compileScript = readFileSync(join(repositoryRoot, "scripts", "compile-product-runtime.ts"), "utf8");
const studioViteConfig = readFileSync(join(repositoryRoot, "packages", "studio", "vite.config.ts"), "utf8");

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("NovelFork 发版身份", () => {
	test("编译期常量指向本产品仓库，辅助组件仍取上游公开 Release", () => {
		expect(productBuildDefines()).toEqual({
			__NARRAFORK_BUILD_REPOSITORY__: JSON.stringify("vivy1024/novelfork"),
			__NARRAFORK_BUILD_PRODUCT__: JSON.stringify("novelfork"),
			__NARRAFORK_RELEASE_ASSET_PREFIX__: JSON.stringify("novelfork-v"),
			__NARRAFORK_HELPER_REPOSITORY__: JSON.stringify("NarraFork/NarraFork"),
		});
		expect(PRODUCT_RELEASE_REPOSITORY).toBe("vivy1024/novelfork");
		expect(PRODUCT_UPDATE_ID).toBe("novelfork");
		expect(PRODUCT_HELPER_REPOSITORY).toBe("NarraFork/NarraFork");
	});

	test("编译产物名与 Runtime 更新器按平台拼出的资产名一致", async () => {
		const { UPDATE_INDEX_PLATFORMS } = (await import(
			join(runtimeRoot, "shared", "update-index-types.ts")
		)) as { UPDATE_INDEX_PLATFORMS: Record<string, string> };
		const pairs = [
			...compileScript.matchAll(
				/buildPlatform: "([^"]+)",\s*artifactName: `novelfork-v\$\{version\}-([^`]+)`/g,
			),
		];
		expect(pairs.length).toBe(7);
		for (const [, buildPlatform, suffix] of pairs) {
			expect(UPDATE_INDEX_PLATFORMS[buildPlatform]).toBe(suffix);
			expect(`${PRODUCT_RELEASE_ASSET_PREFIX}9.9.9-${suffix}`).toBe(
				productReleaseArtifactName("9.9.9", suffix),
			);
		}
	});

	test("后端编译与 Studio 前端构建都注入同一份 define，并为每个产物写 metadata", () => {
		expect(compileScript).toContain("define: productBuildDefines()");
		expect(compileScript).toContain("writeProductBinaryMetadata({");
		expect(compileScript).toContain("runtimeRoot: isolatedRuntime.root");
		expect(compileScript).toContain("platformId: platform.buildPlatform");
		expect(studioViteConfig).toContain("define: productBuildDefines()");
	});

	test("metadata sidecar 字段满足 Runtime 更新器的校验", async () => {
		const root = mkdtempSync(join(tmpdir(), "novelfork-release-metadata-"));
		roots.push(root);
		const artifactPath = join(root, "novelfork-v0.2.0-windows-x64.exe");
		const payload = Buffer.from("novelfork test executable");
		writeFileSync(artifactPath, payload);
		const { path, metadata } = await writeProductBinaryMetadata({
			runtimeRoot,
			artifactPath,
			version: "0.2.0",
			platformId: "win-x64",
			target: "bun-windows-x64",
			commit: "0123abc",
			buildDate: "2026-11-22T00:00:00.000Z",
		});
		expect(path).toBe(`${artifactPath}.metadata.json`);
		const written = JSON.parse(readFileSync(path, "utf8"));
		expect(written).toEqual(metadata);
		const { CURRENT_RECOVERY_MANIFEST_VERSIONS } = (await import(
			join(runtimeRoot, "shared", "update-identity.ts")
		)) as { CURRENT_RECOVERY_MANIFEST_VERSIONS: readonly number[] };
		expect(written).toMatchObject({
			name: "novelfork-v0.2.0-windows-x64.exe",
			platform: "win-x64",
			target: "bun-windows-x64",
			version: "0.2.0",
			commit: "0123abc",
			repository: "vivy1024/novelfork",
			recoveryManifestVersions: [...CURRENT_RECOVERY_MANIFEST_VERSIONS],
			size: payload.length,
			sha256: createHash("sha256").update(payload).digest("hex"),
			sha512: createHash("sha512").update(payload).digest("base64"),
		});
		expect(written.sha512).toMatch(/^[A-Za-z0-9+/]{86}==$/);
		// 辅助组件依赖不随本产品声明：build-info 未内嵌它，sidecar 不能凭空声称。
		expect(written).not.toHaveProperty("helperDistribution");
	});
});
