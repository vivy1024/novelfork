import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	PRODUCT_HELPER_REPOSITORY,
	PRODUCT_RELEASE_ASSET_PREFIX,
	PRODUCT_RELEASE_REPOSITORY,
	PRODUCT_UPDATE_ID,
	productBuildDefines,
} from "../../packages/studio/product-build-identity";

// 常量的唯一定义在 Studio 包内（见该文件说明）；这里转出，编译脚本与测试照旧从本模块取。
export {
	PRODUCT_HELPER_REPOSITORY,
	PRODUCT_RELEASE_ASSET_PREFIX,
	PRODUCT_RELEASE_REPOSITORY,
	PRODUCT_UPDATE_ID,
	productBuildDefines,
};

export function productReleaseArtifactName(version: string, suffix: string): string {
	return `${PRODUCT_RELEASE_ASSET_PREFIX}${version}-${suffix}`;
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
