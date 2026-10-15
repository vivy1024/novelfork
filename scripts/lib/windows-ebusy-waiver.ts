/**
 * Windows EBUSY 精确名单豁免（S0.2）。
 *
 * 豁免同时要求两件事：用例在人工审阅过的名单里（windows-ebusy-waiver-baseline.json），
 * 并且在每一次完整运行里，失败的抛出错误都是 EBUSY。名单外的 EBUSY 照常算失败——
 * 产品代码泄漏句柄造成的确定性 EBUSY 也会每次复现，只按规则豁免会把这类真实回归一起放过。
 * 只豁免"在每一次完整运行里，失败的抛出错误都是 EBUSY"的用例。一次 EBUSY、一次通过
 * 或一次真实断言失败，都不豁免：那种翻转说明 EBUSY 未必是唯一原因，豁免会掩盖真实缺陷。
 *
 * 判定只读 Bun 结构化 JUnit 报告的字段，不解析控制台文本。skipped 用例不计入执行、失败或豁免。
 */

export interface JUnitCase {
	readonly classname: string;
	readonly name: string;
	readonly file: string;
	readonly skipped: boolean;
	readonly failed: boolean;
	readonly failureMessage: string | undefined;
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decodeXmlEntities(text: string): string {
	return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity.slice(1, -1)] ?? entity);
}

function attributeOf(tag: string, name: string): string | undefined {
	const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
	return match ? decodeXmlEntities(match[1] ?? "") : undefined;
}

/**
 * 从 Bun 的 JUnit 报告里读出每个 testcase。只处理本报告用到的结构：
 * <testcase ...>（自闭合或带子元素）、<skipped/>、<failure message="...">。
 * 实体按 XML 规范解码，确保 EBUSY 判定读到的是原始错误文本。
 */
export function parseJUnitCases(xml: string): JUnitCase[] {
	const cases: JUnitCase[] = [];
	const testcasePattern = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
	for (const match of xml.matchAll(testcasePattern)) {
		const attributes = match[1] ?? "";
		const body = match[3] ?? "";
		const failureMatch = /<failure\b([^>]*)>|<failure\b([^>]*)\/>/.exec(body);
		const skipped = /<skipped\b/.test(body);
		const failed = failureMatch !== null;
		const failureMessage = failed ? attributeOf(failureMatch[1] ?? failureMatch[2] ?? "", "message") : undefined;
		cases.push({
			classname: attributeOf(` ${attributes}`, "classname") ?? "",
			name: attributeOf(` ${attributes}`, "name") ?? "",
			file: attributeOf(` ${attributes}`, "file") ?? "",
			skipped,
			failed,
			failureMessage,
		});
	}
	return cases;
}

export interface WaiverEvaluation {
	/** 0 表示没有未豁免的失败；非 0 表示存在真实失败或翻转失败。 */
	readonly exitCode: 0 | 1;
	readonly waived: readonly string[];
	readonly unwaivedFailures: readonly string[];
	/** 每次运行都因 EBUSY 失败的用例（不论是否在名单里），供人工审阅后更新名单。 */
	readonly ebusyCandidates: readonly string[];
}

/**
 * 串联两份 JUnit 报告的判定，给出测试入口应使用的退出码。
 * 必须正好两份完整报告：单次运行无法证明"翻转"，拒绝判定而不是默默放行。
 */
export function evaluateWaiverReports(
	reportsXml: readonly string[],
	allowList?: ReadonlySet<string>,
): WaiverEvaluation {
	if (reportsXml.length !== 2) {
		throw new Error(`需要两次完整运行的报告，实际收到 ${reportsXml.length} 份`);
	}
	const runs = reportsXml.map((xml) => parseJUnitCases(xml));
	if (runs.some((cases) => cases.length === 0)) {
		throw new Error("JUnit 报告中没有任何用例：无法判定，拒绝放行（可能是报告格式不被解析）");
	}
	const decision = decideFailureWaivers({ runs, allowList });
	return {
		exitCode: decision.unwaivedFailures.length === 0 ? 0 : 1,
		waived: decision.waived,
		unwaivedFailures: decision.unwaivedFailures,
		ebusyCandidates: decision.ebusyCandidates,
	};
}

export interface WaiverDecision {

	/** 满足"每次完整运行都因 EBUSY 失败"的用例键（file > classname > name）。 */
	readonly waived: readonly string[];
	/** 在至少一次运行中失败、且未被豁免的用例键，需要按真实失败处理。 */
	readonly unwaivedFailures: readonly string[];
	/** 每次运行都因 EBUSY 失败的用例键，不论是否在名单里。 */
	readonly ebusyCandidates: readonly string[];
}

function keyOf(testCase: JUnitCase): string {
	return [testCase.file, testCase.classname, testCase.name].filter(Boolean).join(" > ");
}

/**
 * 必须是 Node/Bun 抛出的标准 EBUSY 错误（"EBUSY: resource busy or locked, <操作> '<路径>'"），
 * 而不是任何以 "EBUSY" 开头或提到 EBUSY 的句子。只用前缀会把普通文本误判为系统错误。
 */
const RAISED_EBUSY_PATTERN = /^EBUSY: resource busy or locked, \w+ /;

function isRaisedEbusy(testCase: JUnitCase): boolean {
	return testCase.failed && RAISED_EBUSY_PATTERN.test(testCase.failureMessage ?? "");
}

/**
 * @param input.runs 每次完整运行的 JUnit 用例列表（至少一次，通常为两次）。
 * @param input.allowList 人工审阅过的豁免名单。省略时只按 EBUSY 规则判定（仅用于生成名单候选与单元测试）；
 *   正式门禁必须传入名单。
 */
export function decideFailureWaivers(input: {
	readonly runs: readonly (readonly JUnitCase[])[];
	readonly allowList?: ReadonlySet<string>;
}): WaiverDecision {
	const executedRuns = input.runs.map((cases) => cases.filter((testCase) => !testCase.skipped));

	const perRunOccurrences = executedRuns.map((cases) => {
		const grouped = new Map<string, JUnitCase[]>();
		for (const testCase of cases) {
			const key = keyOf(testCase);
			const occurrences = grouped.get(key) ?? [];
			occurrences.push(testCase);
			grouped.set(key, occurrences);
		}
		return grouped;
	});

	const everKeys = new Set<string>();
	for (const grouped of perRunOccurrences) for (const key of grouped.keys()) everKeys.add(key);

	const waived: string[] = [];
	const unwaivedFailures: string[] = [];
	const ebusyCandidates: string[] = [];

	for (const key of [...everKeys].sort()) {
		const observationsPerRun = perRunOccurrences.map((grouped) => grouped.get(key) ?? []);
		const failedSomewhere = observationsPerRun.some((occurrences) => occurrences.some((testCase) => testCase.failed));
		if (!failedSomewhere) continue;

		// 同一键可能对应多个用例：每次运行都必须出现，且每一次出现都是 EBUSY 抛出的失败，才豁免。
		const everyOccurrenceRaisedEbusy = observationsPerRun.every(
			(occurrences) => occurrences.length > 0 && occurrences.every(isRaisedEbusy),
		);

		if (everyOccurrenceRaisedEbusy) ebusyCandidates.push(key);
		const listed = input.allowList === undefined || input.allowList.has(key);
		if (everyOccurrenceRaisedEbusy && listed) waived.push(key);
		else unwaivedFailures.push(key);
	}

	return { waived, unwaivedFailures, ebusyCandidates };
}
