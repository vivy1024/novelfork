import { describe, expect, test } from "bun:test";
import { mergeJUnitReports } from "./windows-ebusy-waiver-runner.ts";
import { parseJUnitCases } from "./windows-ebusy-waiver.ts";

const reportWith = (cases: string, attrs = "") =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test"${attrs}>${cases}</testsuites>\n`;
const passCase = (file: string, suite: string, name: string) =>
	`<testsuite name="${suite}" file="${file}"><testcase name="${name}" classname="${suite}" file="${file}" /></testsuite>`;
const EBUSY_FAIL = `<testsuite name="s" file="a.test.ts"><testcase name="cleanup" classname="s" file="a.test.ts"><failure type="Error" message="EBUSY: resource busy or locked, rm &apos;x&apos;">e</failure></testcase></testsuite>`;

describe("合并分目录 JUnit 报告（test:waiver 分批执行）", () => {
	test("keeps every testcase from every batch and reads them back as one run", () => {
		const merged = mergeJUnitReports([
			reportWith(passCase("frontend\\a.test.ts", "A", "one")),
			reportWith(EBUSY_FAIL + passCase("server\\b.test.ts", "B", "two")),
		]);
		const cases = parseJUnitCases(merged);
		// 批次顺序即报告顺序，合并只做搬运、不重排：第一份的用例整体排在第二份之前。
		expect(cases.map((testCase) => `${testCase.file} > ${testCase.name}`)).toEqual([
			"frontend\\a.test.ts > one",
			"a.test.ts > cleanup",
			"server\\b.test.ts > two",
		]);
		expect(cases.filter((testCase) => testCase.failed)).toHaveLength(1);
	});

	test("a single batch is returned unchanged, so the old single-run path is byte-identical", () => {
		const one = reportWith(EBUSY_FAIL);
		expect(mergeJUnitReports([one])).toBe(one);
	});

	test("a batch that already looks like a whole report keeps its failure message text intact", () => {
		const merged = mergeJUnitReports([reportWith(EBUSY_FAIL), reportWith(passCase("x.test.ts", "X", "y"))]);
		const ebusy = parseJUnitCases(merged).find((testCase) => testCase.name === "cleanup");
		expect(ebusy?.failureMessage).toBe("EBUSY: resource busy or locked, rm 'x'");
	});

	test("refuses to produce a report from nothing instead of silently passing", () => {
		expect(() => mergeJUnitReports([])).toThrow();
	});

	test("a body without the expected wrapper is preserved rather than dropped", () => {
		const odd = `<testsuite name="odd" file="odd.test.ts"><testcase name="kept" classname="odd" file="odd.test.ts" /></testsuite>`;
		const merged = mergeJUnitReports([reportWith(EBUSY_FAIL), odd]);
		expect(parseJUnitCases(merged).map((testCase) => testCase.name)).toContain("kept");
	});
});
