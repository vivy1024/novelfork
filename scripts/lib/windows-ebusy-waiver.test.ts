import { describe, expect, test } from "bun:test";
import { decideFailureWaivers, type JUnitCase } from "./windows-ebusy-waiver.ts";

const ebusy = (name: string): JUnitCase => ({
	classname: "suite",
	name,
	file: "",
	skipped: false,
	failed: true,
	failureMessage: "EBUSY: resource busy or locked, rm 'x'",
});
const realFailure = (name: string): JUnitCase => ({
	classname: "suite",
	name,
	file: "",
	skipped: false,
	failed: true,
	failureMessage: "expect(received).toBe(expected)",
});
const passed = (name: string): JUnitCase => ({
	classname: "suite",
	name,
	file: "",
	skipped: false,
	failed: false,
	failureMessage: undefined,
});
const skipped = (name: string): JUnitCase => ({
	classname: "suite",
	name,
	file: "",
	skipped: true,
	failed: false,
	failureMessage: undefined,
});

describe("Windows EBUSY 精确名单豁免", () => {
	test("waives a name only when BOTH complete runs fail it with EBUSY", () => {
		const decision = decideFailureWaivers({
			runs: [[ebusy("a")], [ebusy("a")]],
		});
		expect(decision.waived).toEqual(["suite > a"]);
		expect(decision.unwaivedFailures).toEqual([]);
	});

	test("never waives a name that is EBUSY in one run only, and keeps that failure unwaived", () => {
		const decision = decideFailureWaivers({
			runs: [[ebusy("a")], [passed("a")]],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual(["suite > a"]);
	});

	test("never waives a real assertion failure even if the other run was EBUSY", () => {
		const decision = decideFailureWaivers({
			runs: [[realFailure("a")], [ebusy("a")]],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual(["suite > a"]);
	});

	test("a failure in only one run with a real error stays unwaived", () => {
		const decision = decideFailureWaivers({
			runs: [[realFailure("b")], []],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual(["suite > b"]);
	});

	test("skipped cases never count as executed, failed or waived", () => {
		const decision = decideFailureWaivers({
			runs: [[skipped("c")], [skipped("c")]],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual([]);
	});

	test("matches on classname plus name, so identically named cases in different suites do not collide", () => {
		const decision = decideFailureWaivers({
			runs: [
				[{ ...ebusy("same"), classname: "A" }],
				[{ ...ebusy("same"), classname: "B" }],
			],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual(["A > same", "B > same"]);
	});

	test("a waiver requires the failure message to be EBUSY, not merely the case to be failing", () => {
		const decision = decideFailureWaivers({
			runs: [[{ ...realFailure("d"), failureMessage: "EBUSY mentioned in a log, not raised" }], [ebusy("d")]],
		});
		expect(decision.waived).toEqual([]);
	});

	test("a real failure is never hidden by a same-named EBUSY case in another file", () => {
		const decision = decideFailureWaivers({
			runs: [
				[{ ...realFailure("a"), file: "f1" }, { ...ebusy("a"), file: "f2" }],
				[{ ...realFailure("a"), file: "f1" }, { ...ebusy("a"), file: "f2" }],
			],
		});
		expect(decision.waived).toEqual(["f2 > suite > a"]);
		expect(decision.unwaivedFailures).toEqual(["f1 > suite > a"]);
	});

	test("one real failure among duplicate-keyed cases blocks the waiver for that key", () => {
		const decision = decideFailureWaivers({
			runs: [
				[realFailure("dup"), ebusy("dup")],
				[ebusy("dup"), ebusy("dup")],
			],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual(["suite > dup"]);
	});

	test("a passing duplicate in one run blocks a waiver backed only by EBUSY duplicates", () => {
		const decision = decideFailureWaivers({
			runs: [[ebusy("p")], [passed("p"), ebusy("p")]],
		});
		expect(decision.waived).toEqual([]);
		expect(decision.unwaivedFailures).toEqual(["suite > p"]);
	});
});
