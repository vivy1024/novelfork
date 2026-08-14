import { describe, expect, test } from "bun:test";
import { getProductBookWritingConfig, isExternalBookWorkspace } from "./book-provision";

describe("getProductBookWritingConfig", () => {
	test("从真实 book.json 配置映射单章目标与正文语言", () => {
		expect(getProductBookWritingConfig({ chapterWordCount: 3600, language: "en" })).toEqual({
			chapterWordCount: 3600,
			language: "en",
		});
	});

	test("忽略无效目标字数与未知语言", () => {
		expect(getProductBookWritingConfig({ chapterWordCount: 0, language: "ja" })).toEqual({});
	});
});

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
