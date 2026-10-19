import { readFileSync, readdirSync, statSync as fsStatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as stubs from "./browser-node-stubs";

/**
 * 桩覆盖契约（本文件存在的唯一理由）。
 *
 * `browser-node-stubs.ts` 是纯导出模块，它的导出名必须覆盖 core / novel-plugin 里
 * **所有会进入前端模块图**的 node 内置引用。漏一个的后果分两种，都很糟：
 *
 * 1. 具名导入（`import { x } from "node:fs"`）漏了：rollup 直接构建失败——v0.0.3 期间
 *    实际发生两次，v0.0.5 又复发一次（commit `f19de77a`「补齐 16 个缺失导出，恢复产品
 *    前端构建」）。
 * 2. 命名空间成员访问（`import * as fs from "node:fs"` 后 `fs.lstatSync(...)`）漏了：
 *    rollup 无法静态判定属性是否存在，**不报错**，运行期得到 `undefined`。
 *    `packages/core/src/utils/chapter-path-guard.ts` 正属于这种写法，它用
 *    `fs.lstatSync` / `fs.realpathSync` 判定目录项与真实根。
 *
 *    实测更正（A1）：缺 `lstatSync` 时**不是** fail-open。`realpathSync` 桩抛出的 Error
 *    不带 `code`，`resolveRealRoot` 因此返回 `{ kind: "broken" }`，守卫直接拒绝。
 *    缺导出在这里的后果是「构建硬崩或运行期抛错」，不是「符号链接防线静默失效」——
 *    但仍必须补齐：它会让整个产品构建失败（正是 commit `f19de77a` 修的那次）。
 *
 * 因此本测试同时检查两种形态。具名导入只报**值导入**：`import type { FileHandle }`
 * 在编译期被抹除，不需要运行期导出。
 */

/** 仓库根：本文件位于 packages/studio/src/lib/，上溯四级。
 * vitest 下 `import.meta.dir` 可能为 undefined，用 import.meta.url 兜底。 */
const THIS_DIR = typeof import.meta.dir === "string" ? import.meta.dir : dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, "../../../..");

/** 会经 core / novel-plugin 进入前端模块图的 node 内置模块（与 vite.config 的 alias 一致）。 */
const STUBBED_MODULES = [
	"node:fs",
	"node:fs/promises",
	"node:crypto",
	"node:module",
	"node:os",
	"node:events",
	"node:zlib",
] as const;

/** 被检查的源码根：core 与 novel-plugin 是前端的传递依赖来源。 */
const SCANNED_ROOTS = ["packages/core/src", "packages/novel-plugin/src"] as const;

function listSourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...listSourceFiles(full));
			continue;
		}
		if (!/\.(?:ts|tsx)$/u.test(entry.name)) continue;
		// 测试与基准不进产品模块图。
		if (/\.(?:test|bench)\.(?:ts|tsx)$/u.test(entry.name)) continue;
		found.push(full);
	}
	return found;
}

interface MissingExports {
	/** 具名值导入缺失：`import { x as y } from "node:m"`。 */
	readonly named: Map<string, Set<string>>;
	/** 命名空间成员访问缺失：`import * as ns from "node:m"` 后 `ns.member`。 */
	readonly namespace: Map<string, Set<string>>;
}

function addMissing(bucket: Map<string, Set<string>>, mod: string, name: string): void {
	const set = bucket.get(mod) ?? new Set<string>();
	set.add(name);
	bucket.set(mod, set);
}

/**
 * 解析一条 import 语句的成员清单。返回 `null` 表示没有值导入需要运行期导出。
 * 处理 `type` 前缀（整条 or 单个成员）、`as` 别名。
 */
function valueMembers(clause: string): string[] {
	// `import type { A, B }` 整条是类型导入。
	if (/^\s*type\b/u.test(clause.replace(/^\{/u, ""))) return [];
	return clause
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		// 单个成员的类型前缀：`type FileHandle`
		.filter((part) => !/^type\s/u.test(part))
		.map((part) => part.split(/\s+as\s+/u)[0].trim())
		.filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name));
}

/** 扫描全部源码，返回「被引用但桩没有导出」的成员。 */
function findUncoveredReferences(): MissingExports {
	return scanSources(
		SCANNED_ROOTS.map((root) => join(REPO_ROOT, root)).flatMap((dir) => listSourceFiles(dir)).map(
			(file) => ({ file, source: readFileSync(file, "utf8") }),
		),
		new Set(Object.keys(stubs)),
	);
}

/** 扫描器的纯函数部分：给定源码与「已知导出集」，报出未覆盖的引用。 */
function scanSources(
	inputs: ReadonlyArray<{ readonly file: string; readonly source: string }>,
	exported: ReadonlySet<string>,
): MissingExports {
	const named = new Map<string, Set<string>>();
	const namespace = new Map<string, Set<string>>();

	for (const { source } of inputs) {
		for (const mod of STUBBED_MODULES) {
			const escaped = mod.replace(/[/\\]/gu, "\\$&");
			// 1) 具名导入（含 `import type { ... }`）
			for (const match of source.matchAll(
				new RegExp(`import\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`, "gu"),
			)) {
				if (match[1]) continue; // 整条 type 导入
				for (const name of valueMembers(match[2])) {
					if (!exported.has(name)) addMissing(named, mod, name);
				}
			}
			// 2) 命名空间导入 + 成员访问
			for (const match of source.matchAll(
				new RegExp(`import\\s*\\*\\s*as\\s+([\\w$]+)\\s*from\\s*["']${escaped}["']`, "gu"),
			)) {
				const alias = match[1];
				for (const use of source.matchAll(new RegExp(`\\b${alias}\\.([\\w$]+)`, "gu"))) {
					if (!exported.has(use[1])) addMissing(namespace, mod, use[1]);
				}
			}
		}
	}
	return { named, namespace };
}

function describeMissing(label: string, bucket: Map<string, Set<string>>): string[] {
	return [...bucket.entries()].map(
		([mod, names]) => `${label} ${mod}: ${[...names].sort().join(", ")}`,
	);
}

describe("browser-node-stubs 覆盖契约", () => {
	it("core / novel-plugin 引用的每个 node 内置导出都在桩里有对应导出", () => {
		const { named, namespace } = findUncoveredReferences();
		const problems = [
			...describeMissing("具名导入缺失（构建会失败）→", named),
			...describeMissing("命名空间成员缺失（运行期静默 undefined）→", namespace),
		];
		expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
	});

	it("扫描到的是真实的源码目录（防止路径写错后测试永远通过）", () => {
		for (const root of SCANNED_ROOTS) {
			const dir = join(REPO_ROOT, root);
			expect(fsStatSync(dir).isDirectory(), `${root} 应当存在`).toBe(true);
		}
		// 抽样确认扫描确实读到了文件：chapter-path-guard 用了命名空间导入的 lstatSync，
		// 它正是本契约最初漏掉的那个成员。
		const guard = readFileSync(
			join(REPO_ROOT, "packages/core/src/utils/chapter-path-guard.ts"),
			"utf8",
		);
		expect(guard).toContain("node:fs");
		expect(guard).toContain("lstatSync");
	});

	it("桩对缺失的调用给出可诊断的错误，而不是静默 undefined", () => {
		expect(() => (stubs.lstatSync as unknown as (p: string) => unknown)("/tmp/x")).toThrow(/browser-stub/u);
	});

	/**
	 * 扫描器自身的红测：不依赖「临时删掉一个导出再跑」这种会动工作区源码的验证方式。
	 * 喂进一份缺少 lstatSync 的假导出集合，扫描器必须把 chapter-path-guard 的
	 * `fs.lstatSync` 报成未覆盖——这正是 A1 那条漏导出当初没被发现的形态。
	 */
	it("缺少某个导出时，扫描器能把对应引用报成未覆盖（红测）", () => {
		const guardSource = readFileSync(
			join(REPO_ROOT, "packages/core/src/utils/chapter-path-guard.ts"),
			"utf8",
		);
		const withoutLstat = new Set(Object.keys(stubs).filter((name) => name !== "lstatSync"));
		const { namespace } = scanSources([{ file: "chapter-path-guard.ts", source: guardSource }], withoutLstat);
		expect([...(namespace.get("node:fs") ?? [])]).toContain("lstatSync");

		// 对照：真实导出集下没有未覆盖项（chapter-path-guard 只用了已覆盖的成员）。
		const withLstat = scanSources([{ file: "chapter-path-guard.ts", source: guardSource }], new Set(Object.keys(stubs)));
		expect([...(withLstat.namespace.get("node:fs") ?? [])]).not.toContain("lstatSync");
	});

	/** 具名导入形态的红测：缺导出时应当被报出来（v0.0.5 复发的那种构建失败）。 */
	it("具名导入缺导出时扫描器能报出（红测）", () => {
		const sample = 'import { realpathSync, statSync } from "node:fs";';
		const withoutRealpath = new Set(Object.keys(stubs).filter((name) => name !== "realpathSync"));
		const { named } = scanSources([{ file: "sample.ts", source: sample }], withoutRealpath);
		expect([...(named.get("node:fs") ?? [])]).toEqual(["realpathSync"]);
	});

	/** 类型导入不该被当成运行期导出需求。 */
	it("`import type { FileHandle }` 不计入未覆盖", () => {
		const sample = 'import type { FileHandle } from "node:fs/promises";';
		const { named } = scanSources([{ file: "sample.ts", source: sample }], new Set());
		expect(named.size).toBe(0);
	});
});
