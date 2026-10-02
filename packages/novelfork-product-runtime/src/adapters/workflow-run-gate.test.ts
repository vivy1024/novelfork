import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeStorageDatabase,
	getStorageDatabase,
	initializeStorageDatabase,
	runStorageMigrations,
} from "@vivy1024/novelfork-core";
import type { RuntimeResolveContext } from "@vivy1024/narrafork-runtime-bridge";
import {
	approveWorkflowStep,
	getActiveWorkflowRunForNarrator,
	saveWorkflowRecipes,
	startWorkflowRun,
	insertRetrievalLog,
} from "@vivy1024/novelfork-novel-plugin/engine";
import { NovelRuntimeAdapter, type NovelRuntimeBindingResolver } from "./runtime-adapter";
import { contextIndexCardExtension, CONTEXT_INDEX_CARD_EXTENSION_ID } from "./workflow-run-gate";

class MemoryResolver implements NovelRuntimeBindingResolver {
	context: RuntimeResolveContext | null = null;
	async resolveForNarrator() {
		return this.context;
	}
}

let workRoot: string;
let bookRoot: string;
let adapter: NovelRuntimeAdapter;

beforeEach(async () => {
	workRoot = await mkdtemp(join(tmpdir(), "novel-workflow-gate-"));
	const booksRoot = join(workRoot, "books");
	bookRoot = join(booksRoot, "book-a");
	await mkdir(join(bookRoot, "chapters"), { recursive: true });
	await writeFile(join(bookRoot, "book.json"), JSON.stringify({
		id: "book-a", title: "测试书籍", platform: "other", genre: "fantasy", status: "active",
		targetChapters: 100, chapterWordCount: 3000,
		createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	}), "utf8");
	// 两道工序：先交正文（需作者确认），再用 chapter.write 落盘。
	await saveWorkflowRecipes(bookRoot, [{
		id: "gate-test",
		name: "门禁测试方案",
		commandId: "/novel:gate-test",
		description: "测试用",
		steps: [
			{ id: "draft", kind: "writer-generate", label: "写正文", enabled: true, requiresApproval: true },
			{ id: "save", kind: "post-settlement", label: "落盘", enabled: true, tools: ["chapter.write"] },
		],
		resultStrategy: "formal-chapter",
		requireFinalApproval: false,
		maxRetries: 0,
	}]);
	const storage = initializeStorageDatabase({ databasePath: join(workRoot, "novelfork.db") });
	runStorageMigrations(storage);
	const resolver = new MemoryResolver();
	resolver.context = Object.freeze({
		runtimeProjectId: "project-a",
		projectRoot: booksRoot,
		projectType: "novel",
		enabledPluginIds: Object.freeze(["novelfork-novel"]),
		resourceBindings: Object.freeze({
			"novel.book": Object.freeze({ kind: "novel.book", bookId: "book-a", root: bookRoot }),
		}),
	});
	adapter = new NovelRuntimeAdapter(resolver);
});

afterEach(async () => {
	closeStorageDatabase();
	await rm(workRoot, { recursive: true, force: true });
});

async function startRun(narratorId = "narrator-a") {
	const result = await startWorkflowRun({
		storage: getStorageDatabase(),
		bookId: "book-a",
		bookRoot,
		recipeId: "gate-test",
		chapterNumber: 1,
		narratorId,
	});
	if (!result.ok) throw new Error(result.explanation.what);
	return result.data;
}

function parse(output: string): Record<string, unknown> {
	return JSON.parse(output) as Record<string, unknown>;
}

describe("创作工作流对叙述者的约束", () => {
	test("没有进行中的运行时，工具与提示与原来逐字一致", async () => {
		const tools = await adapter.resolveToolNames("narrator-a");
		expect(tools).toContain("chapter_write");
		expect(tools).toContain("pipeline_write");
		const prompts = await adapter.promptExtensions("narrator-a");
		expect(prompts.some((prompt) => prompt.includes("创作工作流 · 由产品状态机驱动"))).toBe(false);
	});

	test("运行中：注入工序简报，只露本工序允许的写入工具，读类与 workflow 工具不受影响", async () => {
		await startRun();
		const tools = await adapter.resolveToolNames("narrator-a");
		expect(tools).not.toContain("chapter_write");
		expect(tools).not.toContain("pipeline_write");
		expect(tools).not.toContain("lore_write");
		expect(tools).toEqual(expect.arrayContaining([
			"chapter_read",
			"lore_read",
			"workflow_get_current_step",
			"workflow_submit_step_output",
			"workflow_report_blocker",
		]));
		const prompts = await adapter.promptExtensions("narrator-a");
		const brief = prompts.find((prompt) => prompt.includes("创作工作流 · 由产品状态机驱动"));
		expect(brief).toContain("当前工序（共 2 道）");
		expect(brief).toContain("▶ 工序 1：写正文");
		expect(brief).toContain('kind="prose"');
	});

	test("运行中调用本工序不允许的写入工具：直接拒绝并说明原因", async () => {
		await startRun();
		const result = await adapter.execute("chapter_write", { chapterNumber: 1, content: "偷写" }, "narrator-a");
		expect(result.isError).toBe(true);
		const body = parse(result.output);
		expect(body.error).toBe("workflow-step-disallowed");
		expect(String(body.summary)).toContain("chapter_write 被拦下");
		expect(String(body.summary)).toContain("workflow_submit_step_output");
		// 读类工具照常执行。
		const read = await adapter.execute("chapter_list", {}, "narrator-a");
		expect(parse(read.output).error).not.toBe("workflow-step-disallowed");
	});

	test("提交后等待确认：所有写入被拦；作者批准后进入落盘工序，写入内容必须与批准的正文一致", async () => {
		await startRun();
		const submitted = await adapter.execute(
			"workflow_submit_step_output",
			{ runRevision: 0, kind: "prose", payload: { title: "开篇", content: "作者批准的正文。" } },
			"narrator-a",
		);
		expect(submitted.isError).toBe(false);
		expect(parse(submitted.output)).toMatchObject({ ok: true, data: { runStatus: "awaiting_approval" } });

		const waiting = await adapter.execute("chapter_write", { chapterNumber: 1, content: "作者批准的正文。" }, "narrator-a");
		expect(String(parse(waiting.output).summary)).toContain("等作者确认");
		expect(await adapter.resolveToolNames("narrator-a")).not.toContain("chapter_write");

		const storage = getStorageDatabase();
		const run = getActiveWorkflowRunForNarrator(storage, "narrator-a")!;
		const approved = approveWorkflowStep({ storage, runId: run.id, stepId: "draft", expectedRevision: run.state.revision });
		expect(approved.ok).toBe(true);

		expect(await adapter.resolveToolNames("narrator-a")).toContain("chapter_write");
		const mismatch = await adapter.execute("chapter_write", { chapterNumber: 1, content: "另一份正文" }, "narrator-a");
		expect(parse(mismatch.output)).toMatchObject({ error: "workflow-step-disallowed" });
		expect(String(parse(mismatch.output).summary)).toContain("不一致");

		const matching = await adapter.execute("chapter_write", { chapterNumber: 1, content: "作者批准的正文。" }, "narrator-a");
		expect(parse(matching.output).error).not.toBe("workflow-step-disallowed");

		// 取当前工序时带回已批准的正文，供落盘原样写入。
		const current = await adapter.execute("workflow_get_current_step", {}, "narrator-a");
		expect(parse(current.output)).toMatchObject({ data: { approvedProse: { title: "开篇", content: "作者批准的正文。" } } });
	});

	test("高级工具不参与收窄（保住作者的手动加载），但调用时照样被拦", async () => {
		await startRun();
		expect(await adapter.resolveToolNames("narrator-a")).toContain("memory_bulk_delete");
		const result = await adapter.execute("memory_bulk_delete", { kind: "fact", filter: { ids: ["x"] }, reason: "清理测试" }, "narrator-a");
		expect(parse(result.output).error).toBe("workflow-step-disallowed");
	});


describe("资料索引卡扩展（T4.7）", () => {
	function seedLog() {
		insertRetrievalLog(getStorageDatabase(), {
			id: "card-log-00000001",
			bookId: "book-a",
			chapterNumber: 7,
			purpose: "write_chapter",
			totalTokens: 4200,
			diagnostics: {
				totalMs: 9,
				totalEstimatedTokens: 4200,
				channelStats: [
					{ channel: "hard", status: "ok", latencyMs: 4, candidateCount: 3, returnedCount: 3, estimatedTokens: 1500 },
					{ channel: "style", status: "ok", latencyMs: 2, candidateCount: 6, returnedCount: 4, estimatedTokens: 700 },
				],
				injectedTokensByChannel: { hard: 1500, style: 700 },
				droppedCardIds: [],
				degradedCards: [],
				warnings: [],
			},
		});
	}

	test("没有写作历史时不注入", () => {
		expect(contextIndexCardExtension("book-a")).toBeNull();
	});

	test("bookId 缺失时不注入", () => {
		seedLog();
		expect(contextIndexCardExtension(undefined)).toBeNull();
	});

	test("有写作历史时生成随趟重建的索引卡", () => {
		seedLog();
		const extension = contextIndexCardExtension("book-a");
		expect(extension?.id).toBe(CONTEXT_INDEX_CARD_EXTENSION_ID);
		expect(extension?.content).toContain("第 7 章");
		expect(extension?.content).toContain("hard 1500");
		expect(extension?.content).toContain("memory_read");
		expect(extension?.content).toContain("别凭摘要猜");
	});
});

	test("别的叙述者的运行不影响本叙述者", async () => {
		await startRun("narrator-b");
		expect(await adapter.resolveToolNames("narrator-a")).toContain("chapter_write");
		const result = await adapter.execute("chapter_write", { chapterNumber: 1, content: "x" }, "narrator-a");
		expect(parse(result.output).error).not.toBe("workflow-step-disallowed");
	});
});
