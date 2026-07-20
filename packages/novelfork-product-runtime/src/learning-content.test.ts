import { describe, expect, it } from "bun:test";
import {
	getLearningCategories,
	getLearningDoc,
	getLearningDocSummaries,
	searchLearningDocs,
} from "@vivy1024/narrafork-runtime-bridge";
import { NOVEL_LEARNING_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";

describe("NovelFork learning contribution", () => {
	it("keeps the NarraFork catalog while merging NovelFork learning contributions", () => {
		const categories = getLearningCategories("zh-CN", [NOVEL_LEARNING_CONTRIBUTION]);
		const docs = getLearningDocSummaries("zh-CN", [NOVEL_LEARNING_CONTRIBUTION]);

		expect(categories.some((category) => category.id === "start")).toBe(true);
		expect(categories.some((category) => category.id === "novelfork-writing")).toBe(true);
		expect(docs.some((doc) => doc.id === "overview")).toBe(true);
		expect(docs.some((doc) => doc.id === "novelfork-books")).toBe(true);
	});

	it("localizes contributed details and finds NovelFork writing docs through Runtime search", () => {
		expect(getLearningDoc("novelfork-workbench", "zh-CN", [NOVEL_LEARNING_CONTRIBUTION])).toMatchObject({
			id: "novelfork-workbench",
			category: "novelfork-writing",
			title: "写作工作台",
		});
		expect(
			searchLearningDocs("Narrative Memory", "en", [NOVEL_LEARNING_CONTRIBUTION]).some(
				(doc) => doc.id === "novelfork-narrative-memory",
			),
		).toBe(true);
		expect(
			searchLearningDocs("候选稿", "zh-CN", [NOVEL_LEARNING_CONTRIBUTION]).some(
				(doc) => doc.id === "novelfork-candidates-versions",
			),
		).toBe(true);
	});
});
