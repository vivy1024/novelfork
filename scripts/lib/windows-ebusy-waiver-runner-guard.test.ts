import { describe, expect, test } from "bun:test";
import { evaluateWaiverReports } from "./windows-ebusy-waiver.ts";
import { appendRunnerFailures } from "./windows-ebusy-waiver-runner.ts";

const reportWith = (cases: string) =>
	`<?xml version="1.0"?><testsuites><testsuite name="s">${cases}</testsuite></testsuites>`;
const PASS = `<testcase name="ok" classname="suite"/>`;
const REAL_FAIL = `<testcase name="assert" classname="suite"><failure type="Error" message="expect(received).toBe(expected)">e</failure></testcase>`;

describe("Bun 退出码与未处理错误不能被 JUnit 报告掩盖（T-30）", () => {
	test("a non-zero exit with no failing testcase becomes an unwaivable failure", () => {
		const xml = appendRunnerFailures(reportWith(PASS), { exitCode: 1, stderr: "" });
		const result = evaluateWaiverReports([xml, xml], new Set());
		expect(result.exitCode).toBe(1);
		expect(result.unwaivedFailures.some((key) => key.includes("bun 进程"))).toBe(true);
	});

	test("unhandled errors reported on stderr become an unwaivable failure even when other cases failed", () => {
		const xml = appendRunnerFailures(reportWith(REAL_FAIL), { exitCode: 1, stderr: " 3 pass\n 1 fail\n 2 errors\n" });
		const result = evaluateWaiverReports([xml, xml], new Set(["suite > assert"]));
		expect(result.unwaivedFailures.some((key) => key.includes("未处理错误"))).toBe(true);
	});

	test("a clean exit leaves the report untouched", () => {
		const xml = reportWith(PASS);
		expect(appendRunnerFailures(xml, { exitCode: 0, stderr: " 1 pass\n 0 fail\n" })).toBe(xml);
	});
});
