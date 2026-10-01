import { describe, expect, it } from "bun:test";
import {
	getLearningCategories,
	getLearningDoc,
	getLearningDocSummaries,
	searchLearningDocs,
} from "@vivy1024/narrafork-runtime-bridge";
import { NOVEL_LEARNING_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";

describe("NovelFork learning contribution", () => {
	it("keeps the NarraFork catalog while merging the two NovelFork lines", () => {
		const categories = getLearningCategories("zh-CN", [NOVEL_LEARNING_CONTRIBUTION]);
		const docs = getLearningDocSummaries("zh-CN", [NOVEL_LEARNING_CONTRIBUTION]);

		expect(categories.some((category) => category.id === "novelfork-book")).toBe(true);
		expect(categories.some((category) => category.id === "novelfork-craft")).toBe(true);
		expect(docs.some((doc) => doc.id === "overview")).toBe(true);
		expect(docs.some((doc) => doc.id === "book-start-here")).toBe(true);
		expect(docs.some((doc) => doc.id === "craft-opening")).toBe(true);
	});

	it("does not lose any contributed doc to a Runtime doc with the same id", () => {
		// Runtime 合并时同 id 只保留先到的一篇；贡献文档若与 Runtime 自带文档重名会被静默丢弃。
		for (const contributed of NOVEL_LEARNING_CONTRIBUTION.docs) {
			const merged = getLearningDoc(contributed.id, "zh-CN", [NOVEL_LEARNING_CONTRIBUTION]);
			expect(merged?.category, contributed.id).toBe(contributed.category);
			expect(merged?.title, contributed.id).toBe(contributed.title["zh-CN"]);
		}
	});

	it("localizes contributed details and finds NovelFork docs through Runtime search", () => {
		expect(getLearningDoc("book-style-preset", "zh-CN", [NOVEL_LEARNING_CONTRIBUTION])).toMatchObject({
			id: "book-style-preset",
			category: "novelfork-book",
			title: "文风预设与自动蒸馏",
		});
		expect(
			searchLearningDocs("章后结算", "zh-CN", [NOVEL_LEARNING_CONTRIBUTION]).some(
				(doc) => doc.id === "book-foreshadow-memory",
			),
		).toBe(true);
		expect(
			searchLearningDocs("黄金三章", "zh-CN", [NOVEL_LEARNING_CONTRIBUTION]).some(
				(doc) => doc.id === "craft-opening",
			),
		).toBe(true);
	});
});
