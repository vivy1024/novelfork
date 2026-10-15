import { describe, expect, test } from "bun:test";
import { evaluateWaiverReports } from "./windows-ebusy-waiver.ts";

const reportWith = (cases: string) =>
	`<?xml version="1.0"?><testsuites><testsuite name="s">${cases}</testsuite></testsuites>`;

const EBUSY_FAIL = `<testcase name="cleanup" classname="suite"><failure type="Error" message="EBUSY: resource busy or locked, rm &apos;x&apos;">e</failure></testcase>`;
const REAL_FAIL = `<testcase name="assert" classname="suite"><failure type="Error" message="expect(received).toBe(expected)">e</failure></testcase>`;
const PASS = `<testcase name="ok" classname="suite"/>`;

describe("两份 JUnit 报告的串联判定", () => {
	test("exit 0 when every failure is a double-confirmed EBUSY waiver", () => {
		const result = evaluateWaiverReports([reportWith(EBUSY_FAIL), reportWith(EBUSY_FAIL)]);
		expect(result.exitCode).toBe(0);
		expect(result.waived).toEqual(["suite > cleanup"]);
	});

	test("exit 1 when any real failure remains unwaived", () => {
		const result = evaluateWaiverReports([reportWith(EBUSY_FAIL + REAL_FAIL), reportWith(EBUSY_FAIL + REAL_FAIL)]);
		expect(result.exitCode).toBe(1);
		expect(result.unwaivedFailures).toEqual(["suite > assert"]);
	});

	test("exit 1 when a clean run has no failures but the other run failed (flip is not waived)", () => {
		const result = evaluateWaiverReports([reportWith(EBUSY_FAIL), reportWith(PASS)]);
		expect(result.exitCode).toBe(1);
		expect(result.waived).toEqual([]);
	});

	test("exit 0 when both runs are clean", () => {
		const result = evaluateWaiverReports([reportWith(PASS), reportWith(PASS)]);
		expect(result.exitCode).toBe(0);
	});

	test("requires exactly two complete reports, refusing to judge a single run", () => {
		expect(() => evaluateWaiverReports([reportWith(PASS)])).toThrow("需要两次完整运行的报告");
	});

	test("refuses to judge a run whose report contains no testcases at all", () => {
		expect(() => evaluateWaiverReports([reportWith(EBUSY_FAIL), reportWith("")])).toThrow("没有任何用例");
	});
});

describe("豁免名单（T-30：按名单豁免，而不是凡 EBUSY 都豁免）", () => {
	test("EBUSY failures outside the reviewed allow list stay unwaived", () => {
		const result = evaluateWaiverReports([reportWith(EBUSY_FAIL), reportWith(EBUSY_FAIL)], new Set());
		expect(result.exitCode).toBe(1);
		expect(result.waived).toEqual([]);
		expect(result.unwaivedFailures).toEqual(["suite > cleanup"]);
		expect(result.ebusyCandidates).toEqual(["suite > cleanup"]);
	});

	test("EBUSY failures listed in the allow list are waived", () => {
		const result = evaluateWaiverReports([reportWith(EBUSY_FAIL), reportWith(EBUSY_FAIL)], new Set(["suite > cleanup"]));
		expect(result.exitCode).toBe(0);
		expect(result.waived).toEqual(["suite > cleanup"]);
	});

	test("being on the allow list never waives a non-EBUSY failure", () => {
		const result = evaluateWaiverReports([reportWith(REAL_FAIL), reportWith(REAL_FAIL)], new Set(["suite > assert"]));
		expect(result.exitCode).toBe(1);
		expect(result.unwaivedFailures).toEqual(["suite > assert"]);
	});
});
