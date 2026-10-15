import { describe, expect, test } from "bun:test";
import { parseJUnitCases } from "./windows-ebusy-waiver.ts";

const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" failures="1" skipped="1">
  <testsuite name="s" tests="3">
    <testcase name="ok case" classname="suite A" time="0.01" file="a.test.ts"/>
    <testcase name="boom" classname="suite A" time="0.02" file="a.test.ts">
      <failure type="Error" message="EBUSY: resource busy or locked, rm &apos;D:\\x&apos;">Error: EBUSY</failure>
    </testcase>
    <testcase name="later" classname="suite A" time="0.00" file="a.test.ts">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

describe("JUnit 报告解析", () => {
	test("reads each testcase's name, classname, skipped and failure message from the structured report", () => {
		const cases = parseJUnitCases(JUNIT);
		expect(cases).toHaveLength(3);
		expect(cases[0]).toMatchObject({ classname: "suite A", name: "ok case", skipped: false, failed: false });
		expect(cases[1]).toMatchObject({ name: "boom", skipped: false, failed: true });
		expect(cases[2]).toMatchObject({ name: "later", skipped: true, failed: false });
	});

	test("decodes XML entities so the EBUSY message matches the raised error text", () => {
		const cases = parseJUnitCases(JUNIT);
		expect(cases[1]?.failureMessage).toBe("EBUSY: resource busy or locked, rm 'D:\\x'");
	});

	test("a passing case has no failure message", () => {
		const cases = parseJUnitCases(JUNIT);
		expect(cases[0]?.failureMessage).toBeUndefined();
	});
});
