/**
 * 面向模型的文本里点名的小说工具，必须是模型实际拿到的线上名。
 *
 * Runtime 注册小说工具时把目录名的点换成下划线（toRuntimeToolName），工具描述、promptExtensions
 * 与工具结果的说明字段在出口处统一翻译；但前端交给叙述者的消息、技能原文、学习中心的
 * agentHints 和产品叙述者系统提示词都直接进模型上下文，不经过这层翻译，只能在源头写对。
 * 这里把这些来源都收集起来，逐个核对。
 */
import { describe, expect, test } from "bun:test";
import { NOVEL_LEARNING_CONTRIBUTION, NOVEL_RUNTIME_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";
import { BUNDLED_WRITING_SKILLS } from "../../../novel-plugin/src/engine/writing-skills/bundled-skills.generated";
import { buildHumanizeMessage, buildPolishMessage } from "../../../novel-plugin/src/pages/writing-workbench/self-review-handoff";
import { NOVELIST_PROMPT } from "../services/book-provision";
import { NovelRuntimeAdapter, type NovelRuntimeBindingResolver } from "./runtime-adapter";
import { toRuntimeToolName } from "./runtime-host-adapter";

const CANONICAL = (NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => tool.definition.name);
/** 模型可见集合：与 adapter.toolDefinitions() 的注册名同源。 */
const VISIBLE = new Set(CANONICAL.map(toRuntimeToolName));
const NAMESPACES = new Set(CANONICAL.map((name) => name.split(".")[0]!));
/** 与工具同前缀、实为参数字段的 snake_case 名（scene_spec 的 hooks_planted 等）。 */
const FIELD_NAMES = new Set(["hooks_planted", "hooks_paid_off", "hooks_advanced"]);
const FILE_EXTENSIONS = new Set(["md", "json", "ts", "js", "txt", "yaml", "yml", "tsx"]);

/** 抽出文本里像小说工具名的标识符（点号或下划线，命名空间与现有工具相同）。 */
function mentionedToolNames(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/(?<![\w./-])([a-z]+)([._])([a-z][a-z_.]*[a-z]|\*)(?![\w-])/gu)) {
		const [token, namespace, , rest] = match;
		if (!NAMESPACES.has(namespace!)) continue;
		if (FILE_EXTENSIONS.has(rest!.split(".").at(-1)!)) continue;
		if (FIELD_NAMES.has(token!)) continue;
		found.add(token!);
	}
	return [...found];
}

function invisible(text: string): string[] {
	// 通配写法 lore_* 只要求该命名空间下有线上名。
	return mentionedToolNames(text).filter((name) => (
		name.endsWith("_*") ? ![...VISIBLE].some((wire) => wire.startsWith(name.slice(0, -1))) : !VISIBLE.has(name)
	));
}

describe("面向模型的文本只点名模型可见的工具", () => {
	test("抽取能认出点号、下划线与通配写法，跳过文件名与参数字段", () => {
		expect(mentionedToolNames("先 chapter.read，再 `chapter_read`、lore_*；看 story/volume_outline.md 与 hooks_planted"))
			.toEqual(["chapter.read", "chapter_read", "lore_*"]);
		expect(invisible("先 chapter.read，再 chapter_read，lore_* 也行，chapter_nope 不行")).toEqual(["chapter.read", "chapter_nope"]);
	});

	test("自审交接消息（人文化 / 通篇润色）", () => {
		const issue = {
			paragraph: 1, paragraphStart: 0, paragraphEnd: 6, start: 1, end: 3, matchedText: "不禁",
			evidence: "他不禁抬头。", ruleId: "deletable-term", reason: "套词", source: "deslop-edit" as const,
		};
		for (const message of [buildHumanizeMessage(1, [issue]), buildPolishMessage(1)]) {
			expect(mentionedToolNames(message).length).toBeGreaterThan(0);
			expect(invisible(message), message).toEqual([]);
		}
	});

	test("产品叙述者系统提示词", () => {
		expect(mentionedToolNames(NOVELIST_PROMPT).length).toBeGreaterThan(0);
		expect(invisible(NOVELIST_PROMPT)).toEqual([]);
	});

	test.each(BUNDLED_WRITING_SKILLS.map((skill) => [skill.slug, skill] as const))("技能 %s", (_slug, skill) => {
		const texts = [skill.content, ...Object.values(skill.files)];
		expect(texts.flatMap(invisible), `${skill.slug} 点名了模型看不到的工具名`).toEqual([]);
	});

	test("学习中心的 Agent 查阅提示（agentHints）", () => {
		const hints = NOVEL_LEARNING_CONTRIBUTION.docs.flatMap((doc) => (
			(doc.agentHints ?? []).flatMap((hint) => Object.values(hint as Record<string, string>))
		));
		expect(hints.length).toBeGreaterThan(0);
		expect(hints.flatMap(invisible)).toEqual([]);
	});
});

describe("工具结果出口翻译", () => {
	class MemoryResolver implements NovelRuntimeBindingResolver {
		async resolveForNarrator() {
			return Object.freeze({
				runtimeProjectId: "project-a",
				projectRoot: "/nonexistent-books",
				projectType: "novel",
				enabledPluginIds: Object.freeze(["novelfork-novel"]),
				resourceBindings: Object.freeze({
					"novel.book": Object.freeze({ kind: "novel.book", bookId: "book-a", root: "/nonexistent-books/book-a" }),
				}),
			});
		}
	}

	test("说明字段里的目录名换成线上名，标识值原样保留", () => {
		const adapter = new NovelRuntimeAdapter(new MemoryResolver());
		const host = adapter.hostAdapter as unknown as {
			toModelFacingResult<T>(result: T): T;
		};
		const translated = host.toModelFacingResult({
			ok: false,
			error: "busy",
			summary: "稍后用 style.distill_status 查看进度。",
			data: {
				explanation: { what: "x", why: "y", next: "再调用 style.distill_start 并传入 jobId。" },
				source: "pipeline.write",
				renderer: "write.preflight",
				items: [{ suggestedAction: "先 memory.settle_range 回填。", changedBy: "hooks.manage" }],
			},
		});
		expect(translated).toEqual({
			ok: false,
			error: "busy",
			summary: "稍后用 style_distill_status 查看进度。",
			data: {
				explanation: { what: "x", why: "y", next: "再调用 style_distill_start 并传入 jobId。" },
				source: "pipeline.write",
				renderer: "write.preflight",
				items: [{ suggestedAction: "先 memory_settle_range 回填。", changedBy: "hooks.manage" }],
			},
		});
		expect(invisible(JSON.stringify([translated.summary, translated.data.explanation.next]))).toEqual([]);
	});
});
