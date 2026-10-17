/**
 * Windows EBUSY 豁免门禁（test:waiver）。
 *
 * ## 为什么要按路径分批
 *
 * 整树 `bun test .` 在 Windows 上是**长时间的单次静默**：子进程的 stdout 被丢弃、stderr 写入 scratch 文件，
 * 父进程要等 `proc.exited` 才会打印第一行，于是两轮的整个窗口里输出恒为 0 行，
 * 看起来像卡死（实际跑得动，只是完全不可观测；本机实测单轮约 84 分钟，两轮约 170 分钟，
 * 调用方给的超时短于此时会以 124 退出，那是外部超时，不是脚本卡住）。
 * 分批后每批结束就打印一行，卡在哪一批一眼可见。
 *
 * 批次用 `./<目录>` 形式传给 bun：bun 的位置参数是**子串/目录前缀过滤**，不是路径解析，
 * 裸名字（`server`）会连带命中 `tests\server\...` 等同段名目录，`./server` 才只跑该目录。
 * 五个顶层测试目录正好铺满整树（1981 个文件），合并后的用例集合与整树运行一致。
 *
 * 每轮把各批报告合并成一份再判定，所以「必须两轮、每轮都必须跑完所有批次、第一轮失败不得短路」
 * 这些语义不变；批次只是执行与可观测性的切分，不参与豁免判定。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REQUIRED_RUNTIME_BUN_VERSION } from "./lib/isolated-runtime-build.ts";
import { createBunJUnitRunner } from "./lib/windows-ebusy-waiver-runner.ts";
import { runWaiverGate, type WaiverBatch } from "./lib/windows-ebusy-waiver-gate.ts";
import { parseJUnitCases } from "./lib/windows-ebusy-waiver.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const runtimeRoot = join(repositoryRoot, "packages", "narrafork-runtime-private");
const migrationsRoot = join(runtimeRoot, "runtime-migrations");
const migrationJournal = join(migrationsRoot, "meta", "_journal.json");

function assertRuntimeMigrationAssets(): void {
	if (!existsSync(migrationJournal) || !statSync(migrationJournal).isFile()) {
		throw new Error(
			`Runtime test migrations are missing: ${migrationJournal}. Materialize the derived private Runtime before running tests.`,
		);
	}
}

const baselinePath = join(repositoryRoot, "scripts", "lib", "windows-ebusy-waiver-baseline.json");
const candidatesPath = join(repositoryRoot, "tmp", "windows-ebusy-waiver-candidates.json");
const progressPath = join(repositoryRoot, "tmp", "windows-ebusy-waiver-progress.log");

/**
 * 同步追加一行进度。测试批次是十几分钟级的静默任务，日志必须立刻落盘：
 * 调用方的 stdout 可能被重定向或缓冲，只有文件能让「现在跑到哪一批」在运行中可查。
 */
function progress(line: string): void {
	const stamped = `${new Date().toISOString()} ${line}`;
	try {
		writeFileSync(progressPath, `${stamped}\n`, { flag: "a" });
	} catch {
		// 进度日志失败不能影响判定本身。
	}
	console.error(stamped);
}

/**
 * 读取人工审阅过的豁免名单（JSON 字符串数组，键为 file > classname > name）。
 * 名单不存在时为空：所有失败（含 EBUSY）都按真实失败处理，直到有人审阅候选并把名单入库。
 */
function loadAllowList(): Set<string> {
	if (!existsSync(baselinePath)) return new Set();
	const parsed = JSON.parse(readFileSync(baselinePath, "utf8")) as unknown;
	if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
		throw new Error(`豁免名单格式错误：${baselinePath} 应为字符串数组`);
	}
	return new Set(parsed as string[]);
}

function resolvePinnedBun(): string {
	if (Bun.version === REQUIRED_RUNTIME_BUN_VERSION) return process.execPath;
	const executableName = process.platform === "win32" ? "bun.exe" : "bun";
	const extracted = join(repositoryRoot, "tmp", `bun-${REQUIRED_RUNTIME_BUN_VERSION}`, "extracted");
	const candidates = [
		process.env.NOVELFORK_RUNTIME_BUN?.trim(),
		...(existsSync(extracted)
			? readdirSync(extracted).map((entry) => join(extracted, entry, executableName))
			: []),
	].filter((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
	const match = candidates.find((candidate) => {
		const probe = Bun.spawnSync([candidate, "--version"], { stdout: "pipe", stderr: "ignore" });
		return probe.exitCode === 0 && probe.stdout.toString().trim() === REQUIRED_RUNTIME_BUN_VERSION;
	});
	if (!match) {
		throw new Error(
			`test:waiver 需要 Bun ${REQUIRED_RUNTIME_BUN_VERSION}：请解压到 tmp/bun-${REQUIRED_RUNTIME_BUN_VERSION}，或设置 NOVELFORK_RUNTIME_BUN。`,
		);
	}
	return match;
}

/**
 * 批次计划。按文件数升序：最先跑完的最小批在启动后十几秒就给出「脚本确实在跑」的信号，
 * 之后按目录逐批推进。串行执行（--parallel=1），顺序不影响总时长，只影响可观测性；
 * 五个顶层测试目录正好铺满整树（1981 个文件），合并后与整树运行等价。
 */
const batches: readonly WaiverBatch[] = [
	{ label: "scripts", testPaths: ["./scripts"] },
	{ label: "shared", testPaths: ["./shared"] },
	{ label: "tests", testPaths: ["./tests"] },
	{ label: "frontend", testPaths: ["./frontend"] },
	{ label: "server", testPaths: ["./server"] },
];

/** 统计一份 JUnit 报告里的执行/失败/跳过数量，仅用于进度输出。 */
function summarize(xml: string): { total: number; failed: number; skipped: number } {
	const cases = parseJUnitCases(xml);
	return {
		total: cases.length,
		failed: cases.filter((testCase) => testCase.failed && !testCase.skipped).length,
		skipped: cases.filter((testCase) => testCase.skipped).length,
	};
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

assertRuntimeMigrationAssets();
if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
	throw new Error(`Private Runtime is missing: ${runtimeRoot}. Materialize the Runtime tree before running tests.`);
}

const bunExecutable = resolvePinnedBun();
progress(
	`test:waiver 开始：bun=${bunExecutable} cwd=${runtimeRoot} 批次=${batches
		.map((batch) => `${batch.label}(${batch.testPaths.join(" ")})`)
		.join(", ")}`,
);
progress(`豁免名单：${existsSync(baselinePath) ? baselinePath : `不存在（${baselinePath}），本轮所有失败按真实失败处理`}`);

const runSuite = createBunJUnitRunner({
	bunExecutable,
	cwd: runtimeRoot,
	migrationsDir: migrationsRoot,
	onRunStart: ({ index, scratch, errorLog }) => {
		progress(`第 ${index} 轮启动子进程：scratch=${scratch} 实时日志=${errorLog}`);
	},
});

// 单批失败（例如子进程没写出报告）不终止整轮：把它变成一份带不可豁免失败的报告，
// 其余批次照跑，两轮语义与「整树运行」保持一致，失败原因也留在最终判定里。
const runBatchedSuite = async (index: 1 | 2, testPaths: readonly string[]): Promise<string> => {
	const label = batches.find((batch) => batch.testPaths.join("\u0000") === testPaths.join("\u0000"))?.label ?? testPaths.join(" ");
	const started = Date.now();
	try {
		const xml = await runSuite(index, testPaths);
		const counts = summarize(xml);
		progress(
			`第 ${index} 轮 / ${label} 完成：${((Date.now() - started) / 1000).toFixed(1)}s，用例 ${counts.total}，失败 ${counts.failed}，跳过 ${counts.skipped}`,
		);
		return xml;
	} catch (error) {
		progress(`第 ${index} 轮 / ${label} 失败：${((Date.now() - started) / 1000).toFixed(1)}s，${String(error).slice(0, 800)}`);
		const message = escapeXml(String(error).slice(0, 800));
		return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="bun 进程"><testcase classname="bun 进程" name="批次 ${label} 未产出报告"><failure type="Error" message="${message}"/></testcase></testsuite></testsuites>\n`;
	}
};

const evaluation = await runWaiverGate({ runSuite: runBatchedSuite, allowList: loadAllowList(), plan: batches });
for (const name of evaluation.waived) console.log(`waived (listed, EBUSY in every run): ${name}`);
for (const name of evaluation.unwaivedFailures) console.error(`unwaived failure: ${name}`);
// 候选只写到 tmp/ 供人工审阅；确认是环境问题后再手工并入名单文件并提交，不自动写名单。
writeFileSync(candidatesPath, `${JSON.stringify(evaluation.ebusyCandidates, null, 2)}
`);
console.log(`EBUSY candidates (${evaluation.ebusyCandidates.length}) written to ${candidatesPath} for review`);
progress(
	`test:waiver 结束：退出码 ${evaluation.exitCode}，豁免 ${evaluation.waived.length}，未豁免 ${evaluation.unwaivedFailures.length}，EBUSY 候选 ${evaluation.ebusyCandidates.length}`,
);
process.exit(evaluation.exitCode);
