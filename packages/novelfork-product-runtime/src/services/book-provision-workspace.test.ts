import { describe, expect, test } from "bun:test";
import { isExternalBookWorkspace } from "./book-provision";

describe("isExternalBookWorkspace", () => {
	test("treats source=new + workspaceRoot as external book_root", () => {
		expect(
			isExternalBookWorkspace({
				source: "new",
				managedByNovelFork: false,
				workspaceRoot: "D:\\DESKTOP\\my-novel",
			}),
		).toBe(true);
	});

	test("treats source=existing + workspaceRoot as external book_root", () => {
		expect(
			isExternalBookWorkspace({
				source: "existing",
				managedByNovelFork: false,
				workspaceRoot: "D:\\DESKTOP\\my-novel",
			}),
		).toBe(true);
	});

	test("does not treat none / missing root as external", () => {
		expect(isExternalBookWorkspace({ source: "none", managedByNovelFork: true })).toBe(false);
		expect(
			isExternalBookWorkspace({ source: "new", managedByNovelFork: true }),
		).toBe(false);
		expect(isExternalBookWorkspace(undefined)).toBe(false);
	});
});
