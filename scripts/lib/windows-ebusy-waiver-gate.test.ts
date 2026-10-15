import { describe, expect, test } from "bun:test";
import { runWaiverGate } from "./windows-ebusy-waiver-gate.ts";

const reportWith = (cases: string) =>
	`<?xml version="1.0"?><testsuites><testsuite name="s">${cases}</testsuite></testsuites>`;
const EBUSY_FAIL = `<testcase name="cleanup" classname="suite"><failure type="Error" message="EBUSY: resource busy or locked, rm &apos;x&apos;">e</failure></testcase>`;
const PASS = `<testcase name="ok" classname="suite"/>`;

describe("豁免门禁编排（两次完整运行）", () => {
	test("runs the suite exactly twice and judges the two JUnit reports together", async () => {
		const reports = [reportWith(EBUSY_FAIL), reportWith(EBUSY_FAIL)];
		const invocations: string[] = [];
		const result = await runWaiverGate({
			runSuite: async (index) => {
				invocations.push(`run-${index}`);
				return reports[index - 1]!;
			},
		});
		expect(invocations).toEqual(["run-1", "run-2"]);
		expect(result.exitCode).toBe(0);
		expect(result.waived).toEqual(["suite > cleanup"]);
	});

	test("does not short-circuit: a second run is always executed even if the first already failed", async () => {
		const invocations: number[] = [];
		await runWaiverGate({
			runSuite: async (index) => {
				invocations.push(index);
				return reportWith(EBUSY_FAIL + PASS);
			},
		});
		expect(invocations).toEqual([1, 2]);
	});

	test("propagates a non-zero exit when a flipped failure appears in only one run", async () => {
		const reports = [reportWith(EBUSY_FAIL), reportWith(PASS)];
		const result = await runWaiverGate({ runSuite: async (index) => reports[index - 1]! });
		expect(result.exitCode).toBe(1);
	});
});
