import { evaluateWaiverReports, type WaiverEvaluation } from "./windows-ebusy-waiver.ts";

export interface WaiverGateOptions {
	/**
	 * 执行一次完整测试套件并返回其 JUnit XML。参数是运行序号（1 或 2）。
	 * 生产环境注入真实的 `bun test --reporter=junit` 调用；测试环境注入假报告。
	 */
	readonly runSuite: (index: 1 | 2) => Promise<string>;
	/** 人工审阅过的豁免名单；正式入口必须传入。 */
	readonly allowList?: ReadonlySet<string>;
}

/**
 * 两次完整运行后用精确名单豁免判定。必须无条件执行两次：第一次失败也不得短路，
 * 否则翻转的用例永远无法被发现，豁免就会失去证明力。
 */
export async function runWaiverGate(options: WaiverGateOptions): Promise<WaiverEvaluation> {
	const first = await options.runSuite(1);
	const second = await options.runSuite(2);
	return evaluateWaiverReports([first, second], options.allowList);
}
