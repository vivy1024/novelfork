import { mergeJUnitReports } from "./windows-ebusy-waiver-runner.ts";
import { evaluateWaiverReports, type WaiverEvaluation } from "./windows-ebusy-waiver.ts";

/**
 * 一个执行批次。`label` 只用于进度输出；`testPaths` 是交给 bun test 的位置过滤项，
 * 空数组表示不加过滤（整树发现）。
 */
export interface WaiverBatch {
	readonly label: string;
	readonly testPaths: readonly string[];
}

export interface WaiverGateOptions {
	/**
	 * 执行一个批次并返回它的 JUnit XML。第一个参数是运行序号（1 或 2），第二个是批次的位置过滤项。
	 * 生产环境注入真实的 `bun test --reporter=junit` 调用；测试环境注入假报告。
	 */
	readonly runSuite: (index: 1 | 2, testPaths: readonly string[]) => Promise<string>;
	/** 人工审阅过的豁免名单；正式入口必须传入。 */
	readonly allowList?: ReadonlySet<string>;
	/**
	 * 执行计划：第一轮按顺序跑完每一批，第二轮再按同样顺序跑一遍。
	 * 省略时退化为单批次（不加过滤），与「一次整树运行」等价。
	 */
	readonly plan?: readonly WaiverBatch[];
}

const DEFAULT_PLAN: readonly WaiverBatch[] = [{ label: "全部", testPaths: [] }];

/**
 * 两轮按批次执行后用精确名单豁免判定。必须无条件执行两次、每次都跑完全部批次：
 * 第一次失败也不得短路，否则翻转的用例永远无法被发现，豁免就会失去证明力。
 * 每轮结束时把各批报告合成一份，判定逻辑本身看不到批次划分。
 */
export async function runWaiverGate(options: WaiverGateOptions): Promise<WaiverEvaluation> {
	const plan = options.plan && options.plan.length > 0 ? options.plan : DEFAULT_PLAN;
	const reports: string[] = [];
	for (const runIndex of [1, 2] as const) {
		const batchReports: string[] = [];
		for (const batch of plan) batchReports.push(await options.runSuite(runIndex, batch.testPaths));
		reports.push(mergeJUnitReports(batchReports));
	}
	return evaluateWaiverReports(reports, options.allowList);
}
