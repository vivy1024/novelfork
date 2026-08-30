import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	analyzeNarraForkRuntimeImpact,
	importNarraForkRuntime,
	parseCliArgs,
	validateRuntimeSourceIdentity,
	type UpstreamLock,
} from "./import-narrafork-runtime.ts";

interface Fixture {
	readonly root: string;
	readonly outer: string;
	readonly source: string;
	readonly target: string;
}

let fixture: Fixture;

async function command(args: readonly string[], cwd: string): Promise<string> {
	const process = Bun.spawn(args, {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: globalThis.process.env,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0)
		throw new Error(`${args.join(" ")} failed: ${stderr || stdout}`);
	return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}


async function createFixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "novelfork-import-test-"));
	const outer = join(root, "novelfork");
	const source = join(root, "upstream");
	const target = join(outer, "packages", "narrafork-runtime-private");
	await mkdir(join(outer, "packages"), { recursive: true });
	await mkdir(source, { recursive: true });

	await command(["git", "init"], outer);
	await command(["git", "config", "user.name", "Outer Test"], outer);
	await command(["git", "config", "user.email", "outer@example.test"], outer);
	await writeFile(
		join(outer, ".gitignore"),
		"/packages/narrafork-runtime-private/\n/packages/narrafork-runtime-overlay/\n/packages/.narrafork-runtime-import/\n",
	);
	await command(["git", "add", ".gitignore"], outer);
	await command(["git", "commit", "-m", "ignore private import paths"], outer);

	await command(
		["git", "init", "--initial-branch", "novelfork/integration-v0.5.23"],
		source,
	);
	await command(["git", "config", "user.name", "Importer Test"], source);
	await command(
		["git", "config", "user.email", "importer@example.test"],
		source,
	);
	await command(["git", "config", "core.autocrlf", "true"], source);
	await command(
		[
			"git",
			"remote",
			"add",
			"origin",
			"git@github.com:NarraFork/novelfork-runtime-private.git",
		],
		source,
	);
	await mkdir(join(source, "src"), { recursive: true });
	await mkdir(join(source, "server"), { recursive: true });
	await writeFile(
		join(source, "package.json"),
		'{"name":"private-runtime","version":"0.5.4"}\n',
	);
	await writeFile(join(source, ".gitignore"), "node_modules/\n*.secret\n");
	for (const markerPath of ["runtime-migrations/0000_fantastic_orphan.sql"]) {
		const markerFile = join(source, markerPath);
		await mkdir(dirname(markerFile), { recursive: true });
		await writeFile(markerFile, `// fork marker: ${markerPath}\n`);
	}
	await writeFile(
		join(source, "src", "tracked.ts"),
		"export const value = 1;\n",
	);
	await writeFile(
		join(source, "server", "app.ts"),
		'export const mode = "upstream";\n',
	);
	await command(
		[
			"git",
			"add",
			".gitignore",
			"package.json",
			"runtime-migrations/0000_fantastic_orphan.sql",
			"src/tracked.ts",
			"server/app.ts",
		],
		source,
	);
	await command(["git", "commit", "-m", "fixture"], source);
	
	return { root, outer, source, target };
}

beforeEach(async () => {
	fixture = await createFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

describe("validateRuntimeSourceIdentity", () => {
	const validTrackedPaths = ["runtime-migrations/0000_fantastic_orphan.sql"] as const;

	test("接受 NovelFork Runtime fork 的 origin、集成分支和 marker", () => {
		expect(
			validateRuntimeSourceIdentity({
				remote: "git@github.com:NarraFork/novelfork-runtime-private.git",
				branch: "novelfork/integration-v0.5.23",
				trackedPaths: validTrackedPaths,
			}),
		).toEqual({
			source: "novelfork-runtime-private",
			repository: "NarraFork/novelfork-runtime-private",
			branch: "novelfork/integration-v0.5.23",
			markerPaths: [...validTrackedPaths],
		});
	});

	test("拒绝 NarraFork/narrafork-private 裸 upstream 并给出 checkout 提示", () => {
		expect(() =>
			validateRuntimeSourceIdentity({
				remote: "git@github.com:NarraFork/narrafork-private.git",
				branch: "novelfork/integration-v0.5.23",
				trackedPaths: validTrackedPaths,
			}),
		).toThrow(/缺少 NarraFork\/novelfork-runtime-private fork checkout/);
	});

	test("拒绝非集成分支和错误 marker", () => {
		expect(() =>
			validateRuntimeSourceIdentity({
				remote: "https://github.com/NarraFork/novelfork-runtime-private.git",
				branch: "develop",
				trackedPaths: validTrackedPaths,
			}),
		).toThrow(/novelfork\/integration-v0\.5\.23 分支/);
		expect(() =>
			validateRuntimeSourceIdentity({
				remote: "https://github.com/NarraFork/novelfork-runtime-private.git",
				branch: "novelfork/integration-v0.5.23",
				trackedPaths: validTrackedPaths.slice(0, -1),
			}),
		).toThrow(/fork marker/);
	});
});

describe("importNarraForkRuntime", () => {
	test("拒绝 NarraFork/narrafork-private 裸 upstream 作为生产 Runtime source", async () => {
		await command(
			[
				"git",
				"remote",
				"set-url",
				"origin",
				"git@github.com:NarraFork/narrafork-private.git",
			],
			fixture.source,
		);
		await expect(
			importNarraForkRuntime({
				source: fixture.source,
				target: fixture.target,
				repositoryRoot: fixture.outer,
			}),
		).rejects.toThrow(/缺少 NarraFork\/novelfork-runtime-private fork checkout/);
	});

	test("真实 fork 形态允许 tracked source lock，但导入时重建目标 lock", async () => {
		const sourceCommit = await command(["git", "rev-parse", "HEAD"], fixture.source);
		const sourceTree = await command(
			["git", "rev-parse", "HEAD^{tree}"],
			fixture.source,
		);
		await writeFile(
			join(fixture.source, "UPSTREAM.lock.json"),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					repository: "NarraFork/novelfork-runtime-private",
					remote: "https://github.com/NarraFork/novelfork-runtime-private.git",
					commit: sourceCommit,
					tree: sourceTree,
					branch: "novelfork/integration-v0.5.23",
					version: "0.5.3",
					importedAt: "2026-01-01T00:00:00.000Z",
					trackedFileCount: 5,
					importMethod: "git-archive",
				},
				null,
				2,
			)}\n`,
		);
		await command(["git", "add", "UPSTREAM.lock.json"], fixture.source);
		await command(["git", "commit", "-m", "source lock"], fixture.source);

		const result = await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		const sourceLock = JSON.parse(
			await readFile(join(fixture.source, "UPSTREAM.lock.json"), "utf8"),
		) as UpstreamLock;
		const targetLock = JSON.parse(
			await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8"),
		) as UpstreamLock;
				expect(targetLock.commit).not.toBe(sourceLock.commit);
		expect(targetLock.commit).toBe(
			await command(["git", "rev-parse", "HEAD"], fixture.source),
		);
		expect(targetLock.trackedFileCount).toBe(5);
		expect(targetLock.managedOverlay).toBeUndefined();
		expect(await exists(join(fixture.target, "UPSTREAM.lock.json"))).toBe(true);
		expect(await exists(join(fixture.target, "runtime-migrations", "0000_fantastic_orphan.sql"))).toBe(true);
		expect(await exists(join(fixture.target, "server", "lib", "product-host", "contracts.ts"))).toBe(false);
		expect(await readFile(join(fixture.target, "server", "app.ts"), "utf8")).toBe(
			'export const mode = "upstream";\n',
		);
	});

	test("迁移期读取旧 managedOverlay 只豁免精确旧输出，且新 lock 不再写回", async () => {
		await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		const legacyPath = "server/lib/product-host/contracts.ts";
		const legacyContent = "export const legacy = true;\n";
		await mkdir(dirname(join(fixture.target, legacyPath)), { recursive: true });
		await writeFile(join(fixture.target, legacyPath), legacyContent);
		const lockPath = join(fixture.target, "UPSTREAM.lock.json");
		const lock = JSON.parse(await readFile(lockPath, "utf8")) as UpstreamLock;
		await writeFile(
			lockPath,
			`${JSON.stringify({
				...lock,
				managedOverlay: {
					operations: [{
						id: "legacy-output",
						target: legacyPath,
						sha256: createHash("sha256").update(legacyContent).digest("hex"),
					}],
				},
			}, null, 2)}\n`,
		);
		const report = await analyzeNarraForkRuntimeImpact({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			reportOnly: true,
		});
		expect(report.targetModifications.map((item) => item.path)).not.toContain(legacyPath);
		const nextSource = join(fixture.source, "src", "next.ts");
		await writeFile(nextSource, "export const next = true;\n");
		await command(["git", "add", "src/next.ts"], fixture.source);
		await command(["git", "commit", "-m", "fork update"], fixture.source);
		const result = await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			replace: true,
		});
		expect(result.lock.managedOverlay).toBeUndefined();
	}, 20_000);

	test("report-only 不要求 overlayRoot 存在", async () => {
		await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
				const report = await analyzeNarraForkRuntimeImpact({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			reportOnly: true,
		});
		expect(report.changedFiles).toEqual([]);
		expect(report.targetModifications).toEqual([]);
	});

	test("拒绝非 Git source", async () => {
		const nonGit = join(fixture.root, "not-a-repo");
		await mkdir(nonGit);
		await expect(
			importNarraForkRuntime({
				source: nonGit,
				target: fixture.target,
				repositoryRoot: fixture.outer,
			}),
		).rejects.toThrow(/Git|仓库/);
	});

	test("拒绝命中父仓库而自身不是 Git toplevel 的 source", async () => {
		const nested = join(fixture.source, "nested");
		await mkdir(nested);
		await expect(
			importNarraForkRuntime({
				source: nested,
				target: fixture.target,
				repositoryRoot: fixture.outer,
			}),
		).rejects.toThrow(/自身不是 Git toplevel/);
	});

	test("拒绝脏 source", async () => {
		await writeFile(join(fixture.source, "src", "tracked.ts"), "dirty\n");
		await expect(
			importNarraForkRuntime({
				source: fixture.source,
				target: fixture.target,
				repositoryRoot: fixture.outer,
			}),
		).rejects.toThrow(/clean Git checkout/);
	});

	test("只导出 tracked 文件并生成来源 lock", async () => {
		await mkdir(join(fixture.source, "node_modules"), { recursive: true });
		await writeFile(
			join(fixture.source, "node_modules", "ignored.js"),
			"secret\n",
		);
		await writeFile(join(fixture.source, "local.secret"), "not tracked\n");

		const result = await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});

		expect(result.dryRun).toBe(false);
		expect(
			await readFile(join(fixture.target, "src", "tracked.ts"), "utf8"),
		).toBe("export const value = 1;\n");
		expect(
			await Bun.file(
				join(fixture.target, "node_modules", "ignored.js"),
			).exists(),
		).toBe(false);
		expect(await Bun.file(join(fixture.target, "local.secret")).exists()).toBe(
			false,
		);

		const lock = JSON.parse(
			await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8"),
		) as UpstreamLock;
		expect(lock).toMatchObject({
			schemaVersion: 1,
			repository: "NarraFork/novelfork-runtime-private",
			remote: "git@github.com:NarraFork/novelfork-runtime-private.git",
			version: "0.5.4",
			trackedFileCount: 5,
			importMethod: "git-archive",
		});
		expect(lock.managedOverlay).toBeUndefined();
		expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(lock.tree).toMatch(/^[0-9a-f]{40}$/);
		expect(lock.branch.length).toBeGreaterThan(0);
		expect(Number.isNaN(Date.parse(lock.importedAt))).toBe(false);
		
		const outerStatus = await command(
			["git", "status", "--porcelain", "--untracked-files=all"],
			fixture.outer,
		);
		expect(outerStatus).toBe("");
		expect(
			await exists(
				join(fixture.outer, "packages", ".narrafork-runtime-import"),
			),
		).toBe(false);
	});


	test("target 已存在且无 replace 时拒绝", async () => {
		await mkdir(fixture.target, { recursive: true });
		await writeFile(join(fixture.target, "keep.txt"), "old\n");
		await expect(
			importNarraForkRuntime({
				source: fixture.source,
				target: fixture.target,
				repositoryRoot: fixture.outer,
			}),
		).rejects.toThrow(/target 已存在/);
		expect(await readFile(join(fixture.target, "keep.txt"), "utf8")).toBe(
			"old\n",
		);
	});

	test("replace 仅允许完整匹配 UPSTREAM.lock 的 target", async () => {
		await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		await writeFile(
			join(fixture.source, "src", "tracked.ts"),
			"export const value = 2;\n",
		);
		await command(["git", "add", "src/tracked.ts"], fixture.source);
		await command(["git", "commit", "-m", "upstream update"], fixture.source);
		
		const result = await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			replace: true,
		});

		expect(result.replaced).toBe(true);
		expect(
			await readFile(join(fixture.target, "src", "tracked.ts"), "utf8"),
		).toContain("value = 2");
		expect(
			await Bun.file(join(fixture.target, "UPSTREAM.lock.json")).exists(),
		).toBe(true);
		expect(
			await command(
				["git", "status", "--porcelain", "--untracked-files=all"],
				fixture.outer,
			),
		).toBe("");
		expect(
			await exists(
				join(fixture.outer, "packages", ".narrafork-runtime-import"),
			),
		).toBe(false);
	}, 20_000);

	test("replace 忽略纯 LF/CRLF 字节差异", async () => {
		await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		const trackedPath = join(fixture.target, "src", "tracked.ts");
		const original = await readFile(trackedPath, "utf8");
		await writeFile(trackedPath, original.replaceAll("\n", "\r\n"), "utf8");

		const report = await analyzeNarraForkRuntimeImpact({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		expect(report.targetModifications).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ path: "src/tracked.ts" })]),
		);

		const result = await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			replace: true,
		});
		expect(result.replaced).toBe(true);
	}, 20_000);

	test("replace 拒绝覆盖相对 UPSTREAM.lock 已修改的 Runtime", async () => {
		await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		await writeFile(
			join(fixture.target, "src", "tracked.ts"),
			"local product patch\n",
		);
		await writeFile(
			join(fixture.source, "src", "tracked.ts"),
			"export const value = 2;\n",
		);
		await command(["git", "add", "src/tracked.ts"], fixture.source);
		await command(["git", "commit", "-m", "upstream update"], fixture.source);
		
		await expect(
			importNarraForkRuntime({
				source: fixture.source,
				target: fixture.target,
				repositoryRoot: fixture.outer,
				replace: true,
			}),
		).rejects.toThrow(/已修改|拒绝覆盖/);
		expect(
			await readFile(join(fixture.target, "src", "tracked.ts"), "utf8"),
		).toBe("local product patch\n");
	}, 20_000);

	test("report-only 输出 changed files、能力分类和本地修改且不写 target", async () => {
		await mkdir(join(fixture.source, ".narrafork"), { recursive: true });
		await writeFile(
			join(fixture.source, ".narrafork", "plan-upstream.md"),
			"upstream plan\n",
		);
		await command(
			["git", "add", ".narrafork/plan-upstream.md"],
			fixture.source,
		);
		await command(
			["git", "commit", "-m", "track upstream maintenance plan"],
			fixture.source,
		);
				await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
		});
		const lockBefore = await readFile(
			join(fixture.target, "UPSTREAM.lock.json"),
			"utf8",
		);
		await writeFile(
			join(fixture.target, "src", "tracked.ts"),
			"local product patch\n",
		);
		await writeFile(
			join(fixture.target, ".narrafork", "plan-upstream.md"),
			"local plan patch\n",
		);
		await mkdir(join(fixture.target, "node_modules", "local-only"), {
			recursive: true,
		});
		await mkdir(join(fixture.target, "server", "generated"), {
			recursive: true,
		});
		await mkdir(join(fixture.target, ".runtime-e2e", "books"), {
			recursive: true,
		});
		await mkdir(join(fixture.target, "runtime-migrations", "meta"), {
			recursive: true,
		});
		await mkdir(join(fixture.target, "docs", "plugin-system"), {
			recursive: true,
		});
		await writeFile(
			join(fixture.target, "node_modules", "local-only", "index.js"),
			"generated\n",
		);
		await writeFile(
			join(fixture.target, "server", "generated", "embedded.ts"),
			"generated\n",
		);
		await writeFile(
			join(fixture.target, ".runtime-e2e", "books", "book.json"),
			"{}\n",
		);
		await writeFile(join(fixture.target, "local.db"), "generated\n");
		await writeFile(
			join(fixture.target, "runtime-migrations", "meta", "_journal.json"),
			"{}\n",
		);
		await writeFile(join(fixture.target, "tsr.config.json"), "{}\n");
		await writeFile(
			join(fixture.target, "docs", "plugin-system", "楠屾敹璁板綍.md"),
			"generated archive filename artifact\n",
		);
		await mkdir(join(fixture.source, "server", "permission"), {
			recursive: true,
		});
		await writeFile(
			join(fixture.source, "server", "permission", "gate.ts"),
			"export const gate = true;\n",
		);
		await command(["git", "add", "server/permission/gate.ts"], fixture.source);
		await command(
			["git", "commit", "-m", "add permission gate"],
			fixture.source,
		);

		const report = await analyzeNarraForkRuntimeImpact({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			reportOnly: true,
		});

		expect(report.previousLock.commit).not.toBe(report.nextLock.commit);
		expect(report.changedFiles).toContainEqual(
			expect.objectContaining({
				status: "A",
				path: "server/permission/gate.ts",
				capability: "security-permissions",
			}),
		);
		expect(report.capabilityFiles["security-permissions"]).toContain(
			"server/permission/gate.ts",
		);
		expect(report.targetModifications).toContainEqual(
			expect.objectContaining({ status: "M", path: "src/tracked.ts" }),
		);
		expect(report.targetModifications).toContainEqual(
			expect.objectContaining({
				status: "M",
				path: ".narrafork/plan-upstream.md",
			}),
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			"node_modules/local-only/index.js",
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			"server/generated/embedded.ts",
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			".runtime-e2e/books/book.json",
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			"local.db",
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			"runtime-migrations/meta/_journal.json",
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			"tsr.config.json",
		);
		expect(report.targetModifications.map((item) => item.path)).not.toContain(
			"docs/plugin-system/楠屾敹璁板綍.md",
		);
		expect(
			await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8"),
		).toBe(lockBefore);
		expect(
			await readFile(join(fixture.target, "src", "tracked.ts"), "utf8"),
		).toBe("local product patch\n");
	}, 20_000);

	test("dry-run 验证 archive 但不写现有 target", async () => {
		const sentinel = join(fixture.target, "local-sentinel.txt");
		await mkdir(fixture.target, { recursive: true });
		await writeFile(sentinel, "keep local runtime intact\n", "utf8");

		const result = await importNarraForkRuntime({
			source: fixture.source,
			target: fixture.target,
			repositoryRoot: fixture.outer,
			dryRun: true,
		});

		expect(result.dryRun).toBe(true);
		expect(await readFile(sentinel, "utf8")).toBe("keep local runtime intact\n");
	});
});

describe("parseCliArgs", () => {
	test("解析 source、target、dry-run 和 replace", () => {
		expect(
			parseCliArgs([
				"--source",
				"fork",
				"--target",
				"private",
				"--dry-run",
				"--replace",
			]),
		).toEqual({
			source: "fork",
			target: "private",
			dryRun: true,
			replace: true,
		});
	});

	test("拒绝已退役的 --overlay CLI", () => {
		expect(() => parseCliArgs(["--source", "fork", "--overlay", "overlay"]))
			.toThrow(/overlay 更新链已退役，请直接使用 fork checkout/);
	});

	test("解析 report-only/impact-report 并拒绝覆盖型参数组合", () => {
		expect(parseCliArgs(["--source", "upstream", "--report-only"])).toEqual({
			source: "upstream",
			target: undefined,
			dryRun: false,
			replace: false,
			reportOnly: true,
		});
		expect(
			parseCliArgs(["--source", "upstream", "--impact-report"]).reportOnly,
		).toBe(true);
		expect(() =>
			parseCliArgs(["--source", "upstream", "--report-only", "--replace"]),
		).toThrow(/不能与/);
	});
});
