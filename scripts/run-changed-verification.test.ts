import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	changedPackageDirectories,
	changedPackageNames,
	fullCheckReasons,
} from "./run-changed-verification.ts";

const repositoryRoot = join(import.meta.dir, "..");

describe("改动范围分层验证选择器", () => {
	test("按路径提取去重后的改动包目录", () => {
		expect(changedPackageDirectories([
			"README.md",
			"packages/novel-plugin/src/index.ts",
			"packages/novel-plugin/src/index.ts",
			"packages/novelfork-product-runtime/src/routes/books.ts",
		])).toEqual([
			"novel-plugin",
			"novelfork-product-runtime",
		]);
	});

	test("读取实际包清单并返回 PNPM 包名", () => {
		expect(changedPackageNames([
			"packages/novel-plugin/src/index.ts",
			"packages/novelfork-product-runtime/src/routes/books.ts",
		], repositoryRoot)).toEqual([
			"@vivy1024/novelfork-novel-plugin",
			"@vivy1024/novelfork-product-runtime",
		]);
	});

	test("普通文档改动不触发全量门禁", () => {
		expect(fullCheckReasons(["README.md", "docs/learning/05-story-jingwei.md"])).toEqual([]);
	});

	test("高影响改动触发明确的全量原因", () => {
		expect(fullCheckReasons([
			"package.json",
			"packages/studio/tsconfig.json",
			"scripts/run-workspace-tests.ts",
			"packages/narrafork-runtime-private/server/index.ts",
			"main.ts",
		], true)).toEqual([
			"工作区依赖或包清单变更",
			"TypeScript 配置变更",
			"测试、Runtime 或编译基础设施变更",
			"Runtime 或 overlay 变更",
			"产品启动入口变更",
			"overlay 子仓库存在未提交改动",
		]);
	});
});
