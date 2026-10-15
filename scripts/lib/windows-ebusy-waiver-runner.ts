import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter, dirname } from "node:path";
import { REQUIRED_RUNTIME_BUN_VERSION } from "./isolated-runtime-build.ts";

const EXTERNAL_DATABASE_VARIABLES = ["NF_DATABASE_URL", "DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"] as const;

/**
 * 豁免只对指定版本的 Bun 有效：版本不同会改变测试结果，判定就不再可比。
 * `version` 是 `bun --version` 的输出（已去除首尾空白）。
 */
export async function assertPinnedBunVersion(version: string): Promise<void> {
	if (version !== REQUIRED_RUNTIME_BUN_VERSION) {
		throw new Error(
			`豁免门禁需要 Bun ${REQUIRED_RUNTIME_BUN_VERSION}，实际为 ${version}；请用 NOVELFORK_RUNTIME_BUN 指向正确版本。`,
		);
	}
}

/**
 * 构造豁免执行器的测试环境。采用白名单式重定向：
 * 所有真实数据路径都改指向 scratch 下的隔离目录，外部数据库连接被删除，后端强制为 sqlite。
 * 与正式 runner 的环境保持一致：保留真实 home 供 preload 守卫识别，设置迁移目录与 Git LF 固定。
 * 不把继承的值原样透传，从而杜绝测试读写真实书籍目录或连接外部数据库。
 */
export function buildIsolatedTestEnvironment(options: {
	readonly inherited: Readonly<Record<string, string | undefined>>;
	readonly scratch: string;
	readonly migrationsDir?: string;
}): Record<string, string | undefined> {
	const { scratch } = options;
	const env: Record<string, string | undefined> = { ...options.inherited };
	const realHome = options.inherited.USERPROFILE ?? options.inherited.HOME;

	// 真实数据路径全部重定向到 scratch。
	env.NOVELFORK_HOME = `${scratch}/novelfork-home`;
	env.NOVELFORK_PROJECT_ROOT = `${scratch}/project`;
	env.NOVELFORK_BOOKS_ROOT = `${scratch}/project/books`;
	env.NOVELFORK_STORAGE_DB_PATH = `${scratch}/project/novelfork.db`;
	env.NOVELFORK_SESSION_STORE_DIR = `${scratch}/project/sessions`;
	// 与正式 runtime 范围一致：不设 NARRAFORK_HOME，由 preload 自建隔离 home；保留 ALLOW_MULTIPLE 会绕过实例锁。
	delete env.NARRAFORK_HOME;
	delete env.NARRAFORK_ALLOW_MULTIPLE;
	if (realHome !== undefined) {
		env.NARRAFORK_ORIGINAL_HOME = realHome;
		env.NARRAFORK_TEST_REAL_HOME = realHome;
	}
	if (options.migrationsDir !== undefined) env.NARRAFORK_MIGRATIONS_DIR = options.migrationsDir;
	env.NARRAFORK_DEFER_WINDOWS_TEMP_CLEANUP = "1";

	// 外部数据库连接一律删除，并强制 sqlite。
	for (const name of EXTERNAL_DATABASE_VARIABLES) delete env[name];
	env.NF_DATABASE_BACKEND = "sqlite";

	// Git 夹具不随开发者的 autocrlf 变化。
	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = "core.autocrlf";
	env.GIT_CONFIG_VALUE_0 = "false";

	// 临时目录收拢到 scratch，HOME/USERPROFILE 指向 scratch，真实 home 只留在上面的原始变量里。
	env.TEMP = scratch;
	env.TMP = scratch;
	env.TMPDIR = scratch;
	env.HOME = scratch;
	env.USERPROFILE = scratch;

	return env;
}

/**
 * Bun 的退出码与未处理错误不能被 JUnit 报告掩盖：文件加载失败、测试之间的未处理异常
 * 不一定写成 testcase。出现这两种情况时，往报告里补一条不可豁免的失败用例
 * （消息不是 EBUSY，不会命中豁免）。
 */
export function appendRunnerFailures(xml: string, run: { readonly exitCode: number; readonly stderr: string }): string {
	const extra: string[] = [];
	const unhandled = /^\s*(\d+) errors?\s*$/m.exec(run.stderr);
	const unhandledCount = unhandled ? Number(unhandled[1]) : 0;
	if (unhandledCount > 0) {
		extra.push(
			`<testcase classname="bun 进程" name="未处理错误"><failure type="Error" message="bun test 报告 ${unhandledCount} 个测试之外的未处理错误"/></testcase>`,
		);
	}
	if (run.exitCode !== 0 && !/<failure\b/.test(xml) && extra.length === 0) {
		extra.push(
			`<testcase classname="bun 进程" name="非零退出"><failure type="Error" message="bun test 以退出码 ${run.exitCode} 结束，但报告里没有失败用例"/></testcase>`,
		);
	}
	if (extra.length === 0) return xml;
	const closing = xml.lastIndexOf("</testsuites>");
	const block = `<testsuite name="bun 进程">${extra.join("")}</testsuite>`;
	return closing === -1 ? `${xml}${block}` : `${xml.slice(0, closing)}${block}${xml.slice(closing)}`;
}

/**
 * 生产环境的 runSuite：用指定 Bun 运行一次测试目录并产出 JUnit XML。
 * 环境经 buildIsolatedTestEnvironment 构造；临时目录由本函数创建并在返回后删除，只删除自己创建的目录。
 */
export function createBunJUnitRunner(options: {
	readonly bunExecutable: string;
	readonly cwd: string;
	readonly testPaths: readonly string[];
	readonly migrationsDir: string;
}): (index: 1 | 2) => Promise<string> {
	return async (index) => {
		const probe = Bun.spawnSync([options.bunExecutable, "--version"], { stdout: "pipe", stderr: "pipe" });
		await assertPinnedBunVersion(probe.stdout.toString().trim());
		const scratch = mkdtempSync(join(tmpdir(), `nf-waiver-run${index}-`));
		try {
			const reportPath = join(scratch, "junit.xml");
			const env = buildIsolatedTestEnvironment({
				inherited: process.env as Record<string, string | undefined>,
				scratch,
				migrationsDir: options.migrationsDir,
			});
			// 测试内部还会按 PATH 再起 bun 子进程，必须同样落在要求的版本上（与 run-workspace-tests.ts 一致）。
			env.PATH = [dirname(options.bunExecutable), env.PATH].filter(Boolean).join(delimiter);
			// stderr 落盘而非丢弃：子进程在加载 preload 阶段被拒时不会写报告，stderr 是唯一的原因线索。
			const errorLog = join(scratch, "bun-stderr.log");
			const proc = Bun.spawn(
				[
					options.bunExecutable,
					"test",
					"--isolate",
					"--parallel=1",
					"--timeout=30000",
					"--reporter=junit",
					`--reporter-outfile=${reportPath}`,
					...options.testPaths,
				],
				{
					cwd: options.cwd,
					env: env as Record<string, string>,
					stdio: ["ignore", "ignore", Bun.file(errorLog)],
				},
			);
			// 测试失败时 bun 以非零退出；报告里已有对应失败就交给 evaluateWaiverReports，否则补一条不可豁免的失败。
			const exitCode = await proc.exited;
			const stderr = existsSync(errorLog) ? readFileSync(errorLog, "utf8") : "";
			if (!existsSync(reportPath)) {
				throw new Error(`Bun test 未生成 JUnit 报告（退出码 ${exitCode}）。stderr 尾部：\n${stderr.slice(-2000)}`);
			}
			return appendRunnerFailures(readFileSync(reportPath, "utf8"), { exitCode, stderr: stderr.slice(-4000) });
		} finally {
			rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	};
}
