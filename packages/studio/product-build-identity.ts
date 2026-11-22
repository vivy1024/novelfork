/**
 * NovelFork 发版身份：Runtime 更新器按这些编译期常量找本产品自己的 GitHub Release，
 * 不再指向上游 NarraFork。常量名与 Runtime fork 的 shared/build-repository.ts、
 * shared/build-product.ts 一一对应；未注入时 Runtime 回落上游行为。
 *
 * 放在 Studio 包内且不依赖任何模块：Studio 的 vite 配置与根编译脚本都要用它，
 * 而隔离编译工作区只复制各包，不复制根 scripts/。
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

/** Bun.build / Vite 共用的 define；值是 JSON 字面量。 */
export function productBuildDefines(): Record<string, string> {
	return {
		__NARRAFORK_BUILD_REPOSITORY__: JSON.stringify(PRODUCT_RELEASE_REPOSITORY),
		__NARRAFORK_BUILD_PRODUCT__: JSON.stringify(PRODUCT_UPDATE_ID),
		__NARRAFORK_RELEASE_ASSET_PREFIX__: JSON.stringify(PRODUCT_RELEASE_ASSET_PREFIX),
		__NARRAFORK_HELPER_REPOSITORY__: JSON.stringify(PRODUCT_HELPER_REPOSITORY),
	};
}
