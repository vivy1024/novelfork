import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * NovelFork 发版身份：Runtime 更新器按这些编译期常量找本产品自己的 GitHub Release，
 * 不再指向上游 NarraFork。常量名与 Runtime fork 的 shared/build-repository.ts、
 * shared/build-product.ts 一一对应；未注入时 Runtime 回落上游行为。
 */
export const PRODUCT_RELEASE_REPOSITORY = "vivy1024/novelfork";
export const PRODUCT_UPDATE_ID = "novelfork";
/** 发布资产名 = 前缀 + 版本 + "-" + 平台后缀，例如 novelfork-v0.1.0-windows-x64.exe。 */
export const PRODUCT_RELEASE_ASSET_PREFIX = "novelfork-v";
/**
 * rg / zstd / 远程执行器等辅助组件仍取上游公开 Release（helpers-v*、executor-v* 标签）；
 * NovelFork 的 Release 只发主程序。
 */
export const PRODUCT_HELPER_REPOSITORY = "NarraFork/NarraFork";

export function productReleaseArtifactName(version: string, suffix: string): string {
	return `${PRODUCT_RELEASE_ASSET_PREFIX}${version}-${suffix}`;
}

/** Bun.build / Vite 共用的 define；值是 JSON 字面量。 */
export function productBuildDefines(): Record<string, string> {
	return {
		__NARRAFORK_BUILD_REPOSITORY__: JSON.stringify(PRODUCT_RELEASE_REPOSITORY),
		__NARRAFORK_BUILD_PRODUCT__: JSON.stringify(PRODUCT_UPDATE_ID),
		__NARRAFORK_RELEASE_ASSET_PREFIX__: JSON.stringify(PRODUCT_RELEASE_ASSET_PREFIX),
		__NARRAFORK_HELPER_REPOSITORY__: JSON.stringify(PRODUCT_HELPER_REPOSITORY),
	};
}

type RuntimeBinaryMetadataModule = {
	computeBinaryMetadata(
		filePath: string,
		input: {
			version: string;
			platformId: string;
			target: string;
			commit: string;
			repository?: string;
			recoveryManifestVersions?: readonly number[];
			buildDate: string;
		},
	): Record<string, unknown>;
	formatMetadataJson(metadata: Record<string, unknown>): string;
};

type RuntimeUpdateIdentityModule = {
	CURRENT_RECOVERY_MANIFEST_VERSIONS: readonly number[];
};

/**
 * 在产物旁写 `<产物>.metadata.json`。格式与校验都以被编译的那棵 Runtime 树为准：
 * 直接复用其 scripts/lib/binary-metadata.ts 与 shared/update-identity.ts，
 * 不在产品侧另抄一份。更新器据此核对 name / platform / version / size / sha256 / sha512。
 */
export async function writeProductBinaryMetadata(options: {
	runtimeRoot: string;
	artifactPath: string;
	version: string;
	platformId: string;
	target: string;
	commit: string;
	buildDate: string;
}): Promise<{ path: string; metadata: Record<string, unknown> }> {
	const metadataModule = (await import(
		pathToFileURL(join(options.runtimeRoot, "scripts", "lib", "binary-metadata.ts")).href
	)) as RuntimeBinaryMetadataModule;
	const identityModule = (await import(
		pathToFileURL(join(options.runtimeRoot, "shared", "update-identity.ts")).href
	)) as RuntimeUpdateIdentityModule;
	const metadata = metadataModule.computeBinaryMetadata(options.artifactPath, {
		version: options.version,
		platformId: options.platformId,
		target: options.target,
		commit: options.commit,
		repository: PRODUCT_RELEASE_REPOSITORY,
		recoveryManifestVersions: identityModule.CURRENT_RECOVERY_MANIFEST_VERSIONS,
		buildDate: options.buildDate,
	});
	const path = `${options.artifactPath}.metadata.json`;
	writeFileSync(path, metadataModule.formatMetadataJson(metadata));
	return { path, metadata };
}
