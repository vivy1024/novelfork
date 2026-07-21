import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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

const READY_TOOL_NAMES = [
  "cockpit.snapshot",
  "pgi.ask",
  "narrative.read_line",
  "narrative.propose_change",
  "chapter.read",
  "chapter.write",
  "chapter.list",
  "chapter.audit",
  "rewrite.segment",
  "rewrite.apply",
  "style.import",
  "pipeline.revise",
  "pipeline.import_chapters",
  "outline.suggest_next",
  "character.check_consistency",
  "hooks.manage",
  "presets.read",
  "presets.write",
  "beat.read",
  "beat.write",
  "presets.check_compliance",
  "pipeline.write",
  "lore.read",
  "lore.write",
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


beforeEach(async () => {
	workRoot = await mkdtemp(join(tmpdir(), "novel-runtime-adapter-"));
	booksRoot = join(workRoot, "books");
	bookRoot = join(booksRoot, "book-a");
	await mkdir(join(bookRoot, "chapters"), { recursive: true });
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
	await writeFile(join(bookRoot, "chapters", "0001-opening.md"), "第一章正文", "utf8");
	await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{
		number: 1,
		title: "第一章",
		fileName: "0001-opening.md",
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

		const definitions = adapter.toolDefinitions();
		expect(definitions.map((tool) => tool.name)).toEqual(READY_TOOL_NAMES);
		const chapterRead = definitions.find((tool) => tool.name === "chapter.read");
		expect(chapterRead?.rawJsonSchema).toBeDefined();
		expect(chapterRead?.metadata?.runtimePluginId).toBe("novelfork-novel");
		expect(chapterRead?.metadata?.runtimeRisk).toBe("read");
		expect(chapterRead?.metadata?.runtimeRenderer).toBe("chapter.content");
		expect(definitions.find((tool) => tool.name === "lore.write")?.metadata?.runtimeRisk).toBe(
			"draft-write",
		);
		expect(
			definitions.find((tool) => tool.name === "memory.events")?.metadata?.runtimeRisk,
		).toBe("draft-write");
		expect(definitions.find((tool) => tool.name === "presets.write")?.metadata?.runtimeRisk).toBe(
			"confirmed-write",
		);
		for (const name of ["rewrite.apply", "pipeline.revise", "pipeline.import_chapters", "hooks.manage", "pipeline.write"]) {
			expect(definitions.find((tool) => tool.name === name)?.metadata?.runtimeRisk).toBe("confirmed-write");
		}
		const chapterImport = definitions.find((tool) => tool.name === "pipeline.import_chapters");
		expect(chapterImport?.parameters.safeParse({ content: "正文".repeat(500) }).success).toBe(true);
		expect(chapterImport?.parameters.safeParse({ filePath: "C:/secret.txt" }).success).toBe(false);
		const beatWrite = definitions.find((tool) => tool.name === "beat.write");
		expect(beatWrite?.parameters.safeParse({
			action: "create",
			name: "自定义节拍",
			beats: [{ name: "开场", emotionalTone: "紧张", wordRatio: 1 }],
		}).success).toBe(true);
		expect(beatWrite?.parameters.safeParse({
			action: "create",
			name: "自定义节拍",
			beats: [{ name: "开场", emotionalTone: "紧张", unexpected: true }],
		}).success).toBe(false);
		expect(chapterRead?.parameters.safeParse({ chapterNumber: 1, extra: true }).success).toBe(false);
		expect(
			chapterRead?.parameters.safeParse({ bookId: "book-a", chapterNumber: 1 }).success,
		).toBe(false);
	});

	test("passes the current Runtime model capability into migrated model tools", async () => {
		bindNarrator();
		const requests: Array<{ system: string; model: string }> = [];
		const streamed: string[] = [];
		const result = await adapter.hostAdapter.execute(
			"scene.spec",
			{ chapterNumber: 2, userDirectives: "让主角进入山门" },
			{
				narratorId: "narrator-a",
				model: { provider: "test-provider", id: "current-test-model" },
				generateText: async (request) => {
					requests.push({
						system: request.messages.find((message) => message.role === "system")?.content ?? "",
						model: "current-test-model",
					});
					return {
						text: JSON.stringify({
							chapter: 2,
							title: "山门试炼",
							wordTarget: 3000,
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
						}),
					};
				},
				emitOutput: (output) => streamed.push(output),
			},
		);

		expect(result.isError).toBe(false);
		expect(JSON.parse(result.output)).toMatchObject({
			ok: true,
			data: { sceneSpec: { chapter: 2, title: "山门试炼" } },
		});
		expect(requests).toEqual([{ system: expect.stringContaining("章节规划专家"), model: "current-test-model" }]);
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
			data: { bookId: "book-a", summary: "推进主角进入山门" },
		});
	});

	test("writes only an existing chapter through the trusted book binding", async () => {
		bindNarrator();

		const writeResult = await adapter.execute(
			"chapter.write",
			{ chapterNumber: 1, content: "已确认的改写正文" },
			"narrator-a",
		);

		expect(writeResult.isError).toBe(false);
		expect(JSON.parse(writeResult.output)).toMatchObject({
			ok: true,
			data: { bookId: "book-a", chapterNumber: 1, fileName: "0001-opening.md" },
		});
		expect(await readFile(join(bookRoot, "chapters", "0001-opening.md"), "utf8")).toBe(
			"已确认的改写正文",
		);

		const missingChapter = await adapter.execute(
			"chapter.write",
			{ chapterNumber: 2, content: "不得创建新章节" },
			"narrator-a",
		);
		expect(missingChapter.isError).toBe(true);
		expect(JSON.parse(missingChapter.output)).toMatchObject({
			ok: false,
			error: "chapter-not-found",
		});
		expect(await readFile(join(bookRoot, "chapters", "0001-opening.md"), "utf8")).toBe(
			"已确认的改写正文",
		);
		expect(
			adapter.toolDefinitions().find((tool) => tool.name === "chapter.write")?.metadata
				?.runtimeRisk,
		).toBe("confirmed-write");
	});

	test("executes a storage-backed ready memory tool after Core storage bootstrap", async () => {
		bindNarrator();
		const storage = initializeStorageDatabase({ databasePath: join(workRoot, "novelfork.db") });
		runStorageMigrations(storage);
		try {
			const result = await adapter.execute("memory.stats", {}, "narrator-a");
			expect(result.isError).toBe(false);
			expect(JSON.parse(result.output)).toMatchObject({
				ok: true,
				data: { stats: { total: 0 } },
			});

			const pgiResult = await adapter.execute(
				"pgi.ask",
				{ chapterNumber: 1, chapterIntent: "主角进入山门" },
				"narrator-a",
			);
			expect(pgiResult.isError).toBe(false);
			expect(JSON.parse(pgiResult.output)).toMatchObject({ ok: true });

			const presetCreateResult = await adapter.execute(
				"presets.write",
				{
					action: "create",
					name: "本书节奏约束",
					category: "tone",
					promptInjection: "禁止：总而言之",
				},
				"narrator-a",
			);
			expect(presetCreateResult.isError).toBe(false);
			expect(JSON.parse(presetCreateResult.output)).toMatchObject({
				ok: true,
				data: { bookId: "book-a", autoEnabled: true },
			});
			const presetReadResult = await adapter.execute("presets.read", { scope: "enabled" }, "narrator-a");
			expect(presetReadResult.isError).toBe(false);
			expect(JSON.parse(presetReadResult.output)).toMatchObject({
				ok: true,
				data: { rules: [{ name: "本书节奏约束" }] },
			});

			const beatSelectResult = await adapter.execute(
				"beat.write",
				{ action: "select", templateId: "opening-hooks" },
				"narrator-a",
			);
			expect(beatSelectResult.isError).toBe(false);
			const beatReadResult = await adapter.execute("beat.read", {}, "narrator-a");
			expect(beatReadResult.isError).toBe(false);
			expect(JSON.parse(beatReadResult.output)).toMatchObject({
				ok: true,
				data: { template: { id: "opening-hooks" } },
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
});
