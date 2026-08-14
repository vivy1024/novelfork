import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	books,
	closeStorageDatabase,
	initializeStorageDatabase,
	runStorageMigrations,
} from "@vivy1024/novelfork-core";
import type { RuntimeResolveContext } from "@vivy1024/narrafork-runtime-bridge";
import {
	isNovelProductToolAllowed,
	NovelRuntimeAdapter,
	type NovelRuntimeBindingResolver,
	syncNovelRuntimeToolVisibility,
} from "./runtime-adapter";
import { toRuntimeToolName } from "./runtime-host-adapter";

class MemoryResolver implements NovelRuntimeBindingResolver {
	context: RuntimeResolveContext | null = null;

	async resolveForNarrator() {
		return this.context;
	}
}

let workRoot: string;
let booksRoot: string;
let bookRoot: string;
let resolver: MemoryResolver;
let adapter: NovelRuntimeAdapter;

const CANONICAL_READY_TOOL_NAMES = [
  "cockpit.snapshot",
  "write.preflight",
  "memory.settle_range",
  "memory.settle_chapter",
  "chapter.discard_range",
  "pgi.ask",
  "narrative.read_line",
  "narrative.propose_change",
  "narrative.approve_change",
  "chapter.read",
  "chapter.write",
  "chapter.list",
  "chapter.audit",
  "rewrite.apply",
  "pipeline.import_chapters",
  "book.dissect",
  "outline.volume",
  "arc.character",
  "publish.check",
  "character.check_consistency",
  "hooks.manage",
  "writing-skills.read",
  "writing-skills.write",
  "writing-skills.recommend",
  "writing-skills.check_compliance",
  "writing-skills.import_legacy",
  "pipeline.write",
  "lore.read",
  "lore.write",
  "lore.relate",
  "lore.progress",
  "memory.read",
  "memory.graph",
  "memory.events",
  "memory.list",
  "memory.read_entry",
  "memory.search",
  "memory.dedup",
  "memory.export",
  "memory.stats",
  "memory.update",
  "memory.delete",
  "memory.bulk_approve",
  "memory.bulk_delete",
  "jingwei.audit",
  "jingwei.write",
  "scene.spec",
  "jingwei.read",
  "resource.manage",
];

const READY_TOOL_NAMES = CANONICAL_READY_TOOL_NAMES.map(toRuntimeToolName);
const RUNTIME_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

beforeEach(async () => {
	workRoot = await mkdtemp(join(tmpdir(), "novel-runtime-adapter-"));
	booksRoot = join(workRoot, "books");
	bookRoot = join(booksRoot, "book-a");
	await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
	await writeFile(join(bookRoot, "book.json"), JSON.stringify({
		id: "book-a",
		title: "测试书籍",
		platform: "other",
		genre: "fantasy",
		status: "active",
		targetChapters: 100,
		chapterWordCount: 3000,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	}), "utf8");
	await writeFile(join(bookRoot, "chapters", "卷01", "0001-opening.md"), "第一章正文", "utf8");
	await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{
		number: 1,
		title: "第一章",
		fileName: "卷01/0001-opening.md",
		wordCount: 5,
		status: "accepted",
	}]), "utf8");
	resolver = new MemoryResolver();
	adapter = new NovelRuntimeAdapter(resolver);
});

afterEach(async () => {
	await rm(workRoot, { recursive: true, force: true });
});

function bindNarrator(): void {
	resolver.context = Object.freeze({
		runtimeProjectId: "project-a",
		projectRoot: booksRoot,
		projectType: "novel",
		enabledPluginIds: Object.freeze(["novelfork-novel"]),
		resourceBindings: Object.freeze({
			"novel.book": Object.freeze({ kind: "novel.book", bookId: "book-a", root: bookRoot }),
		}),
	});
}

describe("NovelRuntimeAdapter", () => {
	test("hides novel tools and prompt contributions without a trusted narrator binding", async () => {
		expect(await adapter.resolveToolNames("narrator-unbound")).toEqual([]);
		expect(await adapter.promptExtensions("narrator-unbound")).toEqual([]);

		const result = await adapter.execute(
			"chapter.read",
			{ bookId: "book-a", chapterNumber: 1 },
			"narrator-unbound",
		);
		expect(result.isError).toBe(true);
		expect(JSON.parse(result.output)).toMatchObject({
			ok: false,
			error: "missing-resource-binding",
		});
	});

	test("removes stale manually loaded contribution tools when trust is absent", () => {
		const enabled = new Set(["Terminal", "chapter.read"]);
		syncNovelRuntimeToolVisibility(enabled, []);
		expect([...enabled]).toEqual(["Terminal"]);

		syncNovelRuntimeToolVisibility(enabled, ["chapter.read"]);
		expect([...enabled]).toEqual(["Terminal", "chapter.read"]);
	});

	test("does not hard-block core or optional tools (native Runtime parity)", () => {
		const enabled = new Set(["chapter.read", "chapter.write", "Terminal"]);

		// Product layer no longer filters; Runtime toolFilter handles optional gating.
		expect(isNovelProductToolAllowed("chapter.read", enabled)).toBe(true);
		expect(isNovelProductToolAllowed("chapter.write", enabled)).toBe(true);
		expect(isNovelProductToolAllowed("AskUserQuestion", enabled)).toBe(true);
		expect(isNovelProductToolAllowed("Terminal", enabled)).toBe(true);
		expect(isNovelProductToolAllowed("Terminal", new Set())).toBe(true);
		expect(isNovelProductToolAllowed("Bash", enabled)).toBe(true);
		expect(isNovelProductToolAllowed("Write", enabled)).toBe(true);
		expect(isNovelProductToolAllowed("Edit", enabled)).toBe(true);
	});

	test("exposes the portable contribution only after binding and injects its prompt once", async () => {
		bindNarrator();

		expect(await adapter.resolveToolNames("narrator-a")).toEqual(READY_TOOL_NAMES);
		const extensions = await adapter.promptExtensions("narrator-a");
		expect(extensions).toHaveLength(1);
		expect(extensions[0]).toContain("NovelFork 小说创作运行时");
		expect(extensions[0]).toContain("lore_write");
		expect(extensions[0]).not.toContain("lore.write");

		const definitions = adapter.toolDefinitions();
		expect(definitions.map((tool) => tool.name)).toEqual(READY_TOOL_NAMES);
		expect(definitions.every((tool) => RUNTIME_TOOL_NAME_PATTERN.test(tool.name))).toBe(true);
		expect(definitions.some((tool) => tool.name === "lore.write")).toBe(false);
		const chapterRead = definitions.find((tool) => tool.name === toRuntimeToolName("chapter.read"));
		expect(chapterRead?.rawJsonSchema).toBeDefined();
		expect(chapterRead?.metadata?.runtimePluginId).toBe("novelfork-novel");
		expect(chapterRead?.metadata?.runtimeRisk).toBe("read");
		expect(chapterRead?.metadata?.runtimeRenderer).toBe("chapter.content");
		expect(chapterRead?.metadata?.runtimeCanonicalToolName).toBe("chapter.read");
		expect(definitions.find((tool) => tool.name === toRuntimeToolName("lore.write"))?.metadata?.runtimeRisk).toBe(
			"draft-write",
		);
		expect(
			definitions.find((tool) => tool.name === toRuntimeToolName("memory.events"))?.metadata?.runtimeRisk,
		).toBe("draft-write");
		expect(definitions.find((tool) => tool.name === toRuntimeToolName("writing-skills.write"))?.metadata?.runtimeRisk).toBe(
			"confirmed-write",
		);
		for (const name of ["rewrite.apply", "pipeline.import_chapters", "hooks.manage", "pipeline.write"]) {
			expect(definitions.find((tool) => tool.name === toRuntimeToolName(name))?.metadata?.runtimeRisk).toBe("confirmed-write");
		}
		expect(definitions.some((tool) => tool.name === toRuntimeToolName("pipeline.revise"))).toBe(false);
		const chapterImport = definitions.find((tool) => tool.name === toRuntimeToolName("pipeline.import_chapters"));
		expect(chapterImport?.parameters.safeParse({ content: "正文".repeat(500) }).success).toBe(true);
		const cockpitSnapshot = definitions.find((tool) => tool.name === toRuntimeToolName("cockpit.snapshot"));
		expect(cockpitSnapshot?.parameters.safeParse({}).success).toBe(true);
		expect(cockpitSnapshot?.parameters.safeParse({ bookId: "book-a" }).success).toBe(false);
		// 自由载荷对象必须保持开放：scene.spec 回传的是工具自己产出的真实快照。
		const sceneSpec = definitions.find((tool) => tool.name === toRuntimeToolName("scene.spec"));
		expect(sceneSpec?.parameters.safeParse({
			chapterNumber: 2,
			userDirectives: "让主角进入山门",
			cockpitSnapshot: { status: "available", progress: { chapterCount: 1 } },
		}).success).toBe(true);
		const loreWrite = definitions.find((tool) => tool.name === toRuntimeToolName("lore.write"));
		expect(loreWrite?.parameters.safeParse({
			title: "设定",
			tags: ["灵觉"],
			aliases: ["感知"],
			relatedEntryIds: ["entry-1"],
		}).success).toBe(true);
		expect(loreWrite?.parameters.safeParse({ title: "设定", tags: [{ key: "灵觉" }] }).success).toBe(false);
		expect(chapterImport?.parameters.safeParse({ filePath: "C:/secret.txt" }).success).toBe(false);
		// Writing Skills 只接受对项目文件的增删/刷新；模型不能塞入任意规则正文或未知字段。
		const writingSkillsWrite = definitions.find((tool) => tool.name === toRuntimeToolName("writing-skills.write"));
		expect(writingSkillsWrite?.parameters.safeParse({
			addSkillIds: ["writing-skill-opening-hooks"],
		}).success).toBe(true);
		expect(writingSkillsWrite?.parameters.safeParse({
			addSkillIds: ["writing-skill-opening-hooks"],
			promptInjection: "禁止：总而言之",
		}).success).toBe(false);
		expect(writingSkillsWrite?.parameters.safeParse({
			enabledWritingSkillIds: ["writing-skill-opening-hooks"],
		}).success).toBe(false);
		expect(chapterRead?.parameters.safeParse({ chapterNumber: 1, extra: true }).success).toBe(false);
		expect(
			chapterRead?.parameters.safeParse({ bookId: "book-a", chapterNumber: 1 }).success,
		).toBe(false);
	});

	test("validates the Runtime Agent scene blueprint without an internal model call", async () => {
		bindNarrator();
		let modelCallCount = 0;
		const streamed: string[] = [];
		const result = await adapter.hostAdapter.execute(
			"scene.spec",
			{
				chapterNumber: 2,
				userDirectives: "让主角进入山门",
				cockpitSnapshot: { bookConfig: { chapterWordCount: 3000 } },
				sceneSpec: {
					chapter: 2,
					title: "山门试炼",
					wordTarget: 3000,
					beatBudget: [
						{ summary: "进入山门", density: "normal", words: 900 },
						{ summary: "守门人阻拦", density: "dense", words: 1200 },
						{ summary: "取得资格", density: "dense", words: 900 },
					],
					scenes: [{
						characters: ["主角"],
						location: "山门",
						conflict: "守门人阻拦",
						mood: "紧张→坚定",
						outcome: "取得资格",
						hooks_used: [],
						hooks_planted: [],
					}],
					constraints: [],
				},
			},
			{
				narratorId: "narrator-a",
				provider: "test-provider",
				model: "current-test-model",
				generateText: async () => {
					modelCallCount += 1;
					throw new Error("scene.spec 不应内部调用模型");
				},
				emitOutput: (output) => streamed.push(output),
			},
		);

		expect(result.isError).toBe(false);
		expect(JSON.parse(result.output)).toMatchObject({
			ok: true,
			data: {
				sceneSpec: { chapter: 2, title: "山门试炼" },
			},
		});
		expect(modelCallCount).toBe(0);
		expect(streamed).toEqual([]);
	});

	test("reads the trusted bound chapter without model-supplied book identity", async () => {
		bindNarrator();
		const storage = initializeStorageDatabase({ databasePath: join(workRoot, "novelfork.db") });
		runStorageMigrations(storage);
		try {
			const readResult = await adapter.execute("chapter.read", { chapterNumber: 1 }, "narrator-a");
			expect(readResult.isError).toBe(false);
			expect(JSON.parse(readResult.output)).toMatchObject({
				ok: true,
				data: { bookId: "book-a", chapterNumber: 1, content: "第一章正文" },
			});
		} finally {
			closeStorageDatabase();
		}
	});

	test("reads the bound cockpit, chapter index and narrative artifacts", async () => {
		bindNarrator();

		const cockpitResult = await adapter.execute("cockpit.snapshot", {}, "narrator-a");
		expect(cockpitResult.isError).toBe(false);
		expect(JSON.parse(cockpitResult.output)).toMatchObject({
			ok: true,
			data: { status: "available", book: { id: "book-a" }, storyDir: "story" },
		});
		expect(cockpitResult.output).not.toContain(workRoot);

		const listResult = await adapter.execute("chapter.list", {}, "narrator-a");
		expect(listResult.isError).toBe(false);
		expect(JSON.parse(listResult.output)).toMatchObject({
			ok: true,
			data: { bookId: "book-a", chapters: [{ number: 1, title: "第一章" }] },
		});

		const lineResult = await adapter.execute("narrative.read_line", {}, "narrator-a");
		expect(lineResult.isError).toBe(false);
		expect(JSON.parse(lineResult.output)).toMatchObject({ ok: true, data: { bookId: "book-a" } });

		const proposalResult = await adapter.execute(
			"narrative.propose_change",
			{ summary: "推进主角进入山门" },
			"narrator-a",
		);
		expect(proposalResult.isError).toBe(false);
		expect(JSON.parse(proposalResult.output)).toMatchObject({
			ok: true,
			data: { summary: "推进主角进入山门" },
		});
		// preview 必须能原样回传给 narrative.approve_change，所以不含宿主 bookId。
		expect(proposalResult.output).not.toContain("bookId");

		const approvalResult = await adapter.execute(
			"narrative.approve_change",
			{
				preview: (JSON.parse(proposalResult.output) as { data: unknown }).data,
				decision: "rejected",
				reason: "仅验证审批闭环",
			},
			"narrator-a",
		);
		expect(approvalResult.isError).toBe(false);
		expect(JSON.parse(approvalResult.output)).toMatchObject({
			ok: true,
			data: { applied: false, reason: "rejected" },
		});
	});

	test("writes only an existing compliant chapter through the trusted book binding", async () => {
		bindNarrator();
		const content = "已确认的改写正文。".repeat(334);
		const storage = initializeStorageDatabase({ databasePath: join(workRoot, "novelfork.db") });
		runStorageMigrations(storage);
		try {
			const writeResult = await adapter.execute(
				"chapter.write",
				{ chapterNumber: 1, content },
				"narrator-a",
			);

			expect(writeResult.isError).toBe(false);
			expect(JSON.parse(writeResult.output)).toMatchObject({
				ok: true,
				data: { bookId: "book-a", chapterNumber: 1, fileName: "卷01/0001-opening.md" },
			});
			expect(await readFile(join(bookRoot, "chapters", "卷01", "0001-opening.md"), "utf8")).toBe(content);

			const missingChapter = await adapter.execute(
				"chapter.write",
				{ chapterNumber: 2, content },
				"narrator-a",
			);
			expect(missingChapter.isError).toBe(true);
			expect(JSON.parse(missingChapter.output)).toMatchObject({
				ok: false,
				error: "chapter-not-found",
			});
			expect(await readFile(join(bookRoot, "chapters", "卷01", "0001-opening.md"), "utf8")).toBe(content);
			expect(
				adapter.toolDefinitions().find((tool) => tool.name === toRuntimeToolName("chapter.write"))?.metadata
					?.runtimeRisk,
			).toBe("confirmed-write");
		} finally {
			closeStorageDatabase();
		}
	});

	test("executes a storage-backed ready memory tool after Core storage bootstrap", async () => {
		bindNarrator();
		const storage = initializeStorageDatabase({ databasePath: join(workRoot, "novelfork.db") });
		runStorageMigrations(storage);
		await storage.db.insert(books).values({
			id: "book-a",
			name: "测试书籍",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		try {
			const result = await adapter.execute("memory.stats", {}, "narrator-a");
			expect(result.isError).toBe(false);
			expect(JSON.parse(result.output)).toMatchObject({
				ok: true,
				data: { stats: { total: 0 } },
			});

			const loreDefinition = adapter.toolDefinitions().find((tool) => tool.name === "lore_write");
			expect(loreDefinition).toBeDefined();
			const loreWriteResult = await loreDefinition!.execute(
				{
					title: "wire alias lore",
					contentMd: "# Wire alias lore\\n\\n确认安全工具名仍能落库。",
					category: "world-model",
					layer: "dynamic",
					tags: ["wire-alias"],
					aliases: ["安全别名"],
				},
				{ narratorId: "narrator-a" },
			);
			expect(loreWriteResult.isError).toBe(false);
			expect(JSON.parse(loreWriteResult.output)).toMatchObject({ ok: true });

			const loreReadResult = await adapter.execute(
				"lore_read",
				{ scope: "search", query: "wire alias lore" },
				"narrator-a",
			);
			expect(loreReadResult.isError).toBe(false);
			expect(loreReadResult.output).toContain("wire alias lore");

			const pgiResult = await adapter.execute(
				"pgi.ask",
				{ chapterNumber: 1, chapterIntent: "主角进入山门" },
				"narrator-a",
			);
			expect(pgiResult.isError).toBe(false);
			expect(JSON.parse(pgiResult.output)).toMatchObject({ ok: true });

			// Writing Skills 的内容权威源是 SKILL.md 文件；这里只验证可信绑定下的
			// 书籍级启用读写闭环，不再有第二套 Preset/Beat 存储。
			const skillsAvailable = await adapter.execute("writing-skills.read", {}, "narrator-a");
			expect(skillsAvailable.isError).toBe(false);
			const availablePayload = JSON.parse(skillsAvailable.output) as {
				data?: { skills?: Array<{ id: string; slug: string; mode?: string }> };
			};
			const selectableSkill = availablePayload.data?.skills?.find((skill) => skill.mode !== "always");
			expect(selectableSkill).toBeTruthy();
			if (!selectableSkill) throw new Error("No selectable Writing Skill in catalog");

			const skillsWriteResult = await adapter.execute(
				"writing-skills.write",
				{ addSkillIds: [selectableSkill.id] },
				"narrator-a",
			);
			expect(skillsWriteResult.isError).toBe(false);
			expect(JSON.parse(skillsWriteResult.output)).toMatchObject({
				ok: true,
				data: { bookId: "book-a", projectSkillSlugs: [selectableSkill.slug] },
			});

			const skillsEnabledResult = await adapter.execute(
				"writing-skills.read",
				{ scope: "enabled" },
				"narrator-a",
			);
			expect(skillsEnabledResult.isError).toBe(false);
			expect(JSON.parse(skillsEnabledResult.output)).toMatchObject({
				ok: true,
				data: { projectSkillSlugs: [selectableSkill.slug] },
			});

			const resourcesResult = await adapter.execute(
				"resource.manage",
				{ action: "list", filter: { type: "chapter", status: "accepted" } },
				"narrator-a",
			);
			expect(resourcesResult.isError).toBe(false);
			expect(JSON.parse(resourcesResult.output)).toMatchObject({
				ok: true,
				data: { bookId: "book-a" },
			});

			const createEventResult = await adapter.execute(
				"memory.events",
				{
					action: "create",
					chapterNumber: 1,
					eventType: "world_fact_introduced",
					subject: "青铜铃",
					predicate: "位于",
					object: "山门",
					evidenceText: "青铜铃悬在山门上。",
				},
				"narrator-a",
			);
			expect(createEventResult.isError).toBe(false);
			expect(JSON.parse(createEventResult.output)).toMatchObject({
				ok: true,
				data: { event: { bookId: "book-a", status: "pending" } },
			});
		} finally {
			closeStorageDatabase();
		}
	});

	for (const [label, input] of [
		["forged bookId", { bookId: "book-b", chapterNumber: 1 }],
		["forged sessionId", { sessionId: "model-session", chapterNumber: 1 }],
		["forged bookRoot", { bookRoot: "C:/other", chapterNumber: 1 }],
		["extra field", { chapterNumber: 1, unexpected: true }],
		["wrong type", { chapterNumber: "1" }],
		["missing field", {}],
	] as const) {
		test(`rejects ${label} before the contribution handler`, async () => {
			bindNarrator();
			const result = await adapter.execute("chapter.read", input, "narrator-a");
			expect(result.isError).toBe(true);
			expect(JSON.parse(result.output)).toMatchObject({ ok: false, error: "invalid-tool-input" });
		});
	}

	test("respects contributed tool permission policy and session mode", () => {
		bindNarrator();
		const enabled = new Set<string>();

		// 默认非 advanced 模式下，advanced 工具不会自动进入 enabledSet，但 author 工具会自动加入
		syncNovelRuntimeToolVisibility(enabled, READY_TOOL_NAMES, { isAdvancedEnabled: false, permissionMode: "ask" });
		expect(enabled.has("memory_list")).toBe(false);
		expect(enabled.has("chapter_read")).toBe(true);

		// 如果显式/持久化启用了 advanced 工具，sync 时将被保留
		enabled.add("memory_list");
		syncNovelRuntimeToolVisibility(enabled, READY_TOOL_NAMES, { isAdvancedEnabled: false, permissionMode: "ask" });
		expect(enabled.has("memory_list")).toBe(true);

		// 模式限制：写工具在 read 模式下不允许
		expect(isNovelProductToolAllowed("chapter.write", enabled, { permissionMode: "read" })).toBe(false);
		expect(isNovelProductToolAllowed("chapter.read", enabled, { permissionMode: "read" })).toBe(true);
	});

	test("preserves provider alias mapping without duplicating ToolDefinitions", () => {
		bindNarrator();
		const definitions = adapter.toolDefinitions();
		const names = definitions.map((t) => t.name);

		// 确认没有以 provider 别名 (_nf_...) 命名的 ToolDefinition 注入
		expect(names.some((name) => name.startsWith("_nf_"))).toBe(false);
		// 确认基础名字唯一
		expect(new Set(names).size).toBe(names.length);
	});

	// 书籍叙述者一旦解析不到可信绑定，领域工具会被整体过滤掉。此前这个失败是
	// 静默的：模型仍被要求维护经纬，却看不到 lore.write，只能反复用通用 Write
	// 重写本地文件。这里固定"必须产出可读诊断，且只报一次"的契约。
	test("reports a broken book binding once instead of silently dropping domain tools", async () => {
		const events: Array<Record<string, unknown>> = [];
		const brokenResolver: NovelRuntimeBindingResolver = {
			async resolveForNarrator() {
				return null;
			},
			async diagnoseForNarrator() {
				return {
					status: "untrusted" as const,
					reason: "external-root-unmarked",
					explanation: "书籍 book-a 位于受控 books 根之外，且缺少可信标记。",
					binding: { bookId: "book-a", bookRoot: "D:/external/book-a" },
				};
			},
		};
		const diagnosed = new NovelRuntimeAdapter(brokenResolver, (event) => {
			events.push({ ...event });
		});

		expect(await diagnosed.resolveToolNames("narrator-a")).toEqual([]);
		expect(events).toHaveLength(1);
		expect(events[0]?.narratorId).toBe("narrator-a");
		expect(events[0]?.reason).toBe("external-root-unmarked");
		expect(events[0]?.bookId).toBe("book-a");
		expect(String(events[0]?.explanation)).toContain("可信标记");

		// 同一叙述者的同一原因不再重复上报，避免在续跑回合里刷屏。
		await diagnosed.resolveToolNames("narrator-a");
		expect(events).toHaveLength(1);

		expect(await diagnosed.diagnoseBinding("narrator-a")).toMatchObject({
			status: "untrusted",
			reason: "external-root-unmarked",
		});
	});

	test("keeps an unbound standalone narrator silent", async () => {
		const events: unknown[] = [];
		const unbound: NovelRuntimeBindingResolver = {
			async resolveForNarrator() {
				return null;
			},
			async diagnoseForNarrator() {
				return { status: "unbound" as const };
			},
		};
		const diagnosed = new NovelRuntimeAdapter(unbound, (event) => events.push(event));

		expect(await diagnosed.resolveToolNames("narrator-standalone")).toEqual([]);
		// 未绑定书籍是正常状态，不是缺陷，不应产生告警。
		expect(events).toHaveLength(0);
	});
});
