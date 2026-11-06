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
	preserveLatestWritingInjection,
	workflowTeamIdForBook,
} from "@vivy1024/novelfork-novel-plugin/engine";
import { NovelRuntimeAdapter, type NovelRuntimeBindingResolver } from "./runtime-adapter";
import {
	buildWorkflowWorkerBrief,
	contextIndexCardExtension,
	CONTEXT_INDEX_CARD_EXTENSION_ID,
	explainWorkerWorkflowDenial,
	explainWorkflowDenial,
	explainWorkflowLookupFailure,
	findActiveWorkflowRun,
	isToolVisibleForWorker,
	isWorkflowWorkerByTrait,
	lookupActiveWorkflowRun,
	isDelegatedRunTool,
	resolveWorkerWorkflowGate,
	resolveWorkflowDelegation,
	workflowDelegatedExtension,
	WORKFLOW_WORKER_TRAIT,
	writingInjectionPreserveExtension,
	WRITING_INJECTION_PRESERVE_EXTENSION_ID,
} from "./workflow-run-gate";

class MemoryResolver implements NovelRuntimeBindingResolver {
	context: RuntimeResolveContext | null = null;
	async resolveForNarrator() {
		return this.context;
	}
}

/** 作者批准的正文：落在本书 3000 字的硬范围内（正文候选提交时按与 pipeline.write 相同的口径校验字数）。 */
const APPROVED_PROSE = `作者批准的正文。${"夜".repeat(3000)}`;

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
			{ runRevision: 0, kind: "prose", payload: { title: "开篇", content: APPROVED_PROSE } },
			"narrator-a",
		);
		expect(submitted.isError).toBe(false);
		expect(parse(submitted.output)).toMatchObject({ ok: true, data: { runStatus: "awaiting_approval" } });

		const waiting = await adapter.execute("chapter_write", { chapterNumber: 1, content: APPROVED_PROSE }, "narrator-a");
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

		const matching = await adapter.execute("chapter_write", { chapterNumber: 1, content: APPROVED_PROSE }, "narrator-a");
		expect(parse(matching.output).error).not.toBe("workflow-step-disallowed");

		// 取当前工序时带回已批准的正文，供落盘原样写入。
		const current = await adapter.execute("workflow_get_current_step", {}, "narrator-a");
		expect(parse(current.output)).toMatchObject({ data: { approvedProse: { title: "开篇", content: APPROVED_PROSE } } });
	});

	test("高级写类工具同样随工序收窄（只是可见性，启用状态由 Runtime 套路体系保留），调用时照样被拦", async () => {
		await startRun();
		const visible = await adapter.resolveToolNames("narrator-a");
		expect(visible).not.toContain("memory_bulk_delete");
		expect(visible).not.toContain("chapter_discard_range");
		// 只读的高级工具照常可见。
		expect(visible).toContain("memory_search");
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

describe("写作注入保留件扩展（T4.7 尾巴）", () => {
	test("没有快照或缺书目时不注入", async () => {
		expect(await writingInjectionPreserveExtension(bookRoot, "book-a")).toBeNull();
		expect(await writingInjectionPreserveExtension(undefined, "book-a")).toBeNull();
		expect(await writingInjectionPreserveExtension(bookRoot, undefined)).toBeNull();
	});

	test("有快照时保留件随趟重建注入，原文不被会话压缩摘要掉", async () => {
		await preserveLatestWritingInjection(bookRoot, {
			bookId: "book-a",
			chapterNumber: 3,
			purpose: "write_chapter",
			cards: [],
			sections: {
				hard: "<hard_constraints>\n境界=金丹\n</hard_constraints>",
				state: "",
				timeline: "",
				hooks: "",
				facts: "",
				style: "",
				semantic: "",
				"character-kernel": "",
				"recent-summary": "",
				knowledge: "",
				"prose-evidence": "",
			},
			diagnostics: {
				totalMs: 1,
				totalEstimatedTokens: 320,
				channelStats: [],
				injectedTokensByChannel: {},
				droppedCardIds: [],
				degradedCards: [],
				warnings: [],
				trimReasons: [],
			},
		});

		const extension = await writingInjectionPreserveExtension(bookRoot, "book-a");
		expect(extension?.id).toBe(WRITING_INJECTION_PRESERVE_EXTENSION_ID);
		expect(extension?.content).toContain("境界=金丹");
		expect(extension?.content).toContain("第 3 章");

		// resolveContribution 的系统扩展同样带上保留件（与索引卡同通道，每趟重建）
		const prompts = await adapter.promptExtensions("narrator-a");
		expect(prompts.some((prompt) => prompt.includes("写作注入保留件"))).toBe(true);
		expect(prompts.some((prompt) => prompt.includes("境界=金丹"))).toBe(true);
	});
});

describe("正文一致性校验的 fail-closed 闸门", () => {
	test("存储不可用导致无法校验已批准正文时，写入被拦下并说明原因，而不是静默放行", async () => {
		await startRun();
		const storage = getStorageDatabase();
		const submitted = await adapter.execute(
			"workflow_submit_step_output",
			{ runRevision: 0, kind: "prose", payload: { title: "开篇", content: APPROVED_PROSE } },
			"narrator-a",
		);
		expect(submitted.isError).toBe(false);
		const run = getActiveWorkflowRunForNarrator(storage, "narrator-a")!;
		expect(approveWorkflowStep({ storage, runId: run.id, stepId: "draft", expectedRevision: run.state.revision }).ok).toBe(true);
		const advanced = getActiveWorkflowRunForNarrator(storage, "narrator-a")!;

		// 故障注入：关掉产品库，一致性校验读不到已批准正文（getStorageDatabase 直接抛错）。
		closeStorageDatabase();
		const denial = explainWorkflowDenial(advanced, "chapter.write", "confirmed-write", { chapterNumber: 1, content: APPROVED_PROSE });
		expect(denial).not.toBeNull();
		expect(denial!.what).toContain("无法校验");
		expect(denial!.why).toContain("工作流存储");
		expect(denial!.action).toContain("重试");
	});

	test("产品库已打开但查询工作流运行抛错时，写类工具 fail-closed、读类与 workflow 工具照常", () => {
		const storage = getStorageDatabase();
		const originalPrepare = storage.sqlite.prepare.bind(storage.sqlite);
		// 故障注入：库仍打开，但读 workflow_runs 的查询抛错（I/O 错误、库损坏等）。
		(storage.sqlite as { prepare: unknown }).prepare = ((sql: string) => {
			if (sql.includes("workflow_runs")) throw new Error("disk I/O error");
			return originalPrepare(sql);
		}) as typeof storage.sqlite.prepare;
		try {
			expect(lookupActiveWorkflowRun("narrator-a", "book-1").ok).toBe(false);
			// 可见性那侧仍视为没有运行
			expect(findActiveWorkflowRun("narrator-a", "book-1")).toBeNull();
		} finally {
			(storage.sqlite as { prepare: unknown }).prepare = originalPrepare;
		}
		const denial = explainWorkflowLookupFailure("chapter.write", "confirmed-write");
		expect(denial?.what).toContain("无法读取本书的创作工作流状态");
		expect(explainWorkflowLookupFailure("chapter.read", "read")).toBeNull();
		expect(explainWorkflowLookupFailure("workflow.status", "draft-write")).toBeNull();
		// 没绑书时不算失败
		expect(lookupActiveWorkflowRun("narrator-a", undefined)).toEqual({ ok: true, run: null });
	});

	test("产品库尚未初始化时视为没有运行，不拦写入", () => {
		closeStorageDatabase();
		expect(lookupActiveWorkflowRun("narrator-a", "book-1")).toEqual({ ok: true, run: null });
	});
});

describe("工作流工人闸门（修 A：工人不得直写权威源）", () => {
	test("本书正在跑工作流：工人的写类工具全部 fail-closed，说明指向 team_report", async () => {
		const run = await startRun("leader-a");
		const gate = await resolveWorkerWorkflowGate("worker-a", "book-a", {
			isWorker: async () => true,
			activeRunsForBook: () => [run],
		});
		expect(gate.kind).toBe("controlled");

		for (const [tool, risk] of [
			["chapter.write", "confirmed-write"],
			["pipeline.write", "draft-write"],
			["chapter.delete", "destructive"],
		] as const) {
			const denial = explainWorkerWorkflowDenial(run, tool, risk);
			expect(denial).not.toBeNull();
			// 三段式：身份与运行、为什么不能写、该交给谁
			expect(denial?.what).toContain("工作流工人");
			expect(denial?.what).toContain(tool);
			expect(denial?.why).toContain("只能由领导者的叙述者提交");
			expect(denial?.action).toContain("team_report");
			expect(denial?.action).toContain("不要自己调用写入工具");
		}
	});

	test("读类与 workflow.* 对工人恒放行（汇报通道不被自己的闸门挡住）", async () => {
		const run = await startRun("leader-a");
		expect(explainWorkerWorkflowDenial(run, "chapter.read", "read")).toBeNull();
		expect(explainWorkerWorkflowDenial(run, "lore.read", "read")).toBeNull();
		expect(explainWorkerWorkflowDenial(run, "workflow.submit_step_output", "confirmed-write")).toBeNull();
		expect(explainWorkerWorkflowDenial(run, "workflow.report_blocker", "draft-write")).toBeNull();
	});

	test("可见性：控制期内只露读类，写类不露", async () => {
		const run = await startRun("leader-a");
		const gate = await resolveWorkerWorkflowGate("worker-a", "book-a", {
			isWorker: async () => true,
			activeRunsForBook: () => [run],
		});
		expect(isToolVisibleForWorker(gate, "chapter.read", "read")).toBe(true);
		expect(isToolVisibleForWorker(gate, "chapter.write", "confirmed-write")).toBe(false);
		expect(isToolVisibleForWorker(gate, "pipeline.write", "draft-write")).toBe(false);
		// 没有运行时不受约束（不是 controlled）
		expect(isToolVisibleForWorker({ kind: "idle" }, "chapter.write", "confirmed-write")).toBe(true);
	});

	test("不是工人时不受工人闸门影响（领导者走自己的工序闸门）", async () => {
		const run = await startRun("leader-a");
		const gate = await resolveWorkerWorkflowGate("leader-a", "book-a", {
			isWorker: async () => false,
			activeRunsForBook: () => [run],
		});
		expect(gate.kind).toBe("not-worker");
	});

	test("工人但本书没有进行中的运行：按普通叙述者处理，不拦", async () => {
		const gate = await resolveWorkerWorkflowGate("worker-a", "book-a", {
			isWorker: async () => true,
			activeRunsForBook: () => [],
		});
		expect(gate.kind).toBe("idle");
		expect(isToolVisibleForWorker(gate, "chapter.write", "confirmed-write")).toBe(true);
	});

	test("工人自己就是本书运行的领导者时走领导者路径，不被工人收口锁死", async () => {
		await startRun("worker-a");
		const gate = await resolveWorkerWorkflowGate("worker-a", "book-a", { isWorker: async () => true });
		expect(gate.kind).toBe("not-worker");
	});

	test("读不出本书运行状态：写类 fail-closed（unreadable）", async () => {
		const gate = await resolveWorkerWorkflowGate("worker-a", "book-a", {
			isWorker: async () => true,
			activeRunsForBook: () => {
				throw new Error("disk I/O error");
			},
		});
		expect(gate.kind).toBe("unreadable");
	});

	test("没有绑定书时不判定为工人（无从判断属于哪本书的运行）", async () => {
		const gate = await resolveWorkerWorkflowGate("worker-a", undefined, { isWorker: async () => true });
		expect(gate.kind).toBe("not-worker");
	});

	test("工人简报：钉住本书团队 id，并写明汇报通道与不可写入", async () => {
		const run = await startRun("leader-a");
		const brief = buildWorkflowWorkerBrief(run);
		expect(brief).toContain("你是本运行的工作流工人");
		expect(brief).toContain(workflowTeamIdForBook("book-a"));
		expect(brief).toContain("team_report");
		expect(brief).toContain("没有这本书的写入权");
		// 工人不跑状态机：不要诱导它去提交产物
		expect(brief).toContain("不要调用 workflow_submit_step_output");
	});

	test("内置子代理委派：领导者派出的名册模板子代理认得出；其余情况不认（仍按工人收口）", async () => {
		const run = await startRun("leader-a");
		const seams = (template: string, parent = "leader-a") => ({
			readDelegation: async () => ({ parentNarratorId: parent, template }),
		});
		const delegated = await resolveWorkflowDelegation("sub-1", "book-a", seams("nf-writer"));
		expect(delegated).toMatchObject({ narratorId: "leader-a", template: "nf-writer" });
		expect(delegated?.run.id).toBe(run.id);
		// 不在名册里的模板（通用子代理、用户自定义）不认
		expect(await resolveWorkflowDelegation("sub-1", "book-a", seams("general"))).toBeNull();
		expect(await resolveWorkflowDelegation("sub-1", "book-a", seams("my-writer"))).toBeNull();
		// 父叙述者不是本书运行的领导者
		expect(await resolveWorkflowDelegation("sub-1", "book-a", seams("nf-writer", "someone-else"))).toBeNull();
		// 别的书 / 没有绑定书
		expect(await resolveWorkflowDelegation("sub-1", "book-b", seams("nf-writer"))).toBeNull();
		expect(await resolveWorkflowDelegation("sub-1", undefined, seams("nf-writer"))).toBeNull();
		// 不是子代理
		expect(await resolveWorkflowDelegation("sub-1", "book-a", { readDelegation: async () => null })).toBeNull();
	});

	test("内置子代理：只露三个运行工具之外的读类；写入照样被工人闸门拦下", async () => {
		const run = await startRun("leader-a");
		expect(isDelegatedRunTool("workflow.submit_step_output")).toBe(true);
		expect(isDelegatedRunTool("workflow.report_blocker")).toBe(true);
		expect(isDelegatedRunTool("workflow.edit_recipe")).toBe(false);
		expect(isDelegatedRunTool("pipeline.write")).toBe(false);
		// 写类仍拒：委派身份只交给工作流工具，不放宽其它写入
		for (const tool of ["chapter.write", "pipeline.write", "lore.write"]) {
			expect(explainWorkerWorkflowDenial(run, tool, "confirmed-write")).not.toBeNull();
		}
	});

	test("内置子代理简报：只讲分给该模板的工序；模板不对应时叫它别提交", async () => {
		const run = await startRun("leader-a");
		// gate-test 第一道是写正文（writer-generate）
		const writer = workflowDelegatedExtension(run, "nf-writer").content;
		expect(writer).toContain('stepId="draft"');
		expect(writer).toContain("workflow_submit_step_output");
		expect(writer).toContain("不贴正文");
		const auditor = workflowDelegatedExtension(run, "nf-continuity-auditor").content;
		expect(auditor).toContain("没有分给你的进行中工序");
		expect(auditor).not.toContain('stepId="draft"');
	});

	test("工人标记按 traits 认人（改名也认得出），字符串/数组两种存储都能读", () => {
		expect(isWorkflowWorkerByTrait([WORKFLOW_WORKER_TRAIT])).toBe(true);
		expect(isWorkflowWorkerByTrait(JSON.stringify([WORKFLOW_WORKER_TRAIT]))).toBe(true);
		expect(isWorkflowWorkerByTrait(["novelfork-product", "novelist"])).toBe(false);
		expect(isWorkflowWorkerByTrait(null)).toBe(false);
	});
});
