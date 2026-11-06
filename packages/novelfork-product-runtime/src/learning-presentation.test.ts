import { describe, expect, it } from "bun:test";
import { NOVEL_LEARNING_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";
import {
	getLearningCategories,
	getLearningDoc,
	getLearningDocs,
	searchLearningDocs,
} from "../../narrafork-runtime-private/shared/learning-content";
import type { RuntimeLearningContribution } from "../../narrafork-runtime-private/shared/learning-contract";
import { HIDDEN_RUNTIME_LEARNING_DOC_IDS, NOVELFORK_LEARNING_PRESENTATION } from "./learning-presentation";
import { novelForkProductIntegration } from "./index";

// core 的贡献类型把文案声明为宽松的 Record，运行时形状与 Runtime 契约一致（en + zh-CN 两份）。
const contributions = [NOVEL_LEARNING_CONTRIBUTION] as unknown as readonly RuntimeLearningContribution[];
const presentation = NOVELFORK_LEARNING_PRESENTATION;
const LOCALES = ["zh-CN", "en"] as const;

describe("NovelFork learning presentation", () => {
	it("is what the product integration hands the Runtime", () => {
		expect(novelForkProductIntegration.learningPresentation?.()).toBe(presentation);
	});

	it("shows no NarraFork wording anywhere in the learning center", () => {
		for (const locale of LOCALES) {
			const docs = getLearningDocs(locale, contributions, presentation);
			const categories = getLearningCategories(locale, contributions, presentation);
			expect(JSON.stringify(docs), locale).not.toContain("NarraFork");
			expect(JSON.stringify(categories), locale).not.toContain("NarraFork");
		}
	});

	it("rewrites the overview for authors instead of a coding workspace", () => {
		const zh = getLearningDoc("overview", "zh-CN", contributions, presentation);
		expect(zh?.title).toBe("一页理解 NovelFork");
		expect(zh?.summary).not.toContain("编程");
		for (const word of ["建一本书", "叙述者", "确认", "结算"]) expect(zh?.summary).toContain(word);
		expect(getLearningDoc("overview", "en", contributions, presentation)?.title).toBe("NovelFork in one page");
	});

	it("hides developer-only Runtime docs from listing, search and lookup", () => {
		for (const id of HIDDEN_RUNTIME_LEARNING_DOC_IDS) {
			// 文档本身在 Runtime 里仍存在，只是 NovelFork 的学习中心不介绍。
			expect(getLearningDoc(id, "zh-CN"), id).toBeDefined();
			expect(getLearningDoc(id, "zh-CN", contributions, presentation), id).toBeUndefined();
		}
		const ids = getLearningDocs("zh-CN", contributions, presentation).map((doc) => doc.id);
		for (const id of HIDDEN_RUNTIME_LEARNING_DOC_IDS) expect(ids).not.toContain(id);
		const searched = searchLearningDocs("终端 容器 MCP 钩子 IM 网关", "zh-CN", contributions, presentation);
		for (const doc of searched) expect(HIDDEN_RUNTIME_LEARNING_DOC_IDS).not.toContain(doc.id as never);
	});

	it("only overrides docs and categories the Runtime actually ships", () => {
		const builtinIds = new Set(getLearningDocs("zh-CN").map((doc) => doc.id));
		for (const id of [...HIDDEN_RUNTIME_LEARNING_DOC_IDS, ...Object.keys(presentation.builtinDocOverrides ?? {})]) {
			expect(builtinIds.has(id), id).toBe(true);
		}
		const categoryIds = new Set(getLearningCategories("zh-CN", contributions).map((category) => category.id));
		for (const id of [
			...Object.keys(presentation.builtinCategoryOverrides ?? {}),
			...(presentation.categoryOrder ?? []),
		]) {
			expect(categoryIds.has(id), id).toBe(true);
		}
	});

	it("keeps every NovelFork tutorial and lists it right after the overview", () => {
		const docs = getLearningDocs("zh-CN", contributions, presentation);
		for (const contributed of NOVEL_LEARNING_CONTRIBUTION.docs) {
			const merged = docs.find((doc) => doc.id === contributed.id);
			expect(merged?.title, contributed.id).toBe(contributed.title["zh-CN"]);
		}
		const categories = getLearningCategories("zh-CN", contributions, presentation).map((c) => c.id);
		expect(categories.slice(0, 3)).toEqual(["start", "novelfork-book", "novelfork-craft"]);
		expect(docs[0]?.id).toBe("overview");
	});
});
