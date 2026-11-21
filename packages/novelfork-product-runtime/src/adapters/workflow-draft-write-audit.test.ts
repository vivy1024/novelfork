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
	type WorkflowRunRecord,
} from "@vivy1024/novelfork-novel-plugin/engine";
import type { NovelRuntimeBindingResolver } from "./runtime-adapter";
import { NovelRuntimeHostAdapter } from "./runtime-host-adapter";
import {
	auditWorkflowDraftWrites,
	draftWriteAuditPhase,
	type DraftWriteAuditSeams,
	type NativeFileWriteRecord,
} from "./workflow-draft-write-audit";

class MemoryResolver implements NovelRuntimeBindingResolver {
	context: RuntimeResolveContext | null = null;
	async resolveForNarrator() {
		return this.context;
	}
}

const PROSE = `草稿正文。${"夜".repeat(3000)}`;

let workRoot: string;
let bookRoot: string;
let resolver: MemoryResolver;
/** 测试里 Runtime 记录的原生写文件调用（按叙述者）。 */
let nativeWrites: Map<string, NativeFileWriteRecord[]>;
let auditedNarrators: string[][];
let children: string[];

const seams: DraftWriteAuditSeams = {
	listNativeWrites: async (narratorIds) => {
		auditedNarrators.push([...narratorIds]);
		return narratorIds.flatMap((id) => nativeWrites.get(id) ?? []);
	},
	listDraftWriterChildren: async () => children,
	realpath: async () => null,
};

function write(narratorId: string, filePath: string, toolName = "Write"): void {
	const list = nativeWrites.get(narratorId) ?? [];
	list.push({ toolName, filePath, cwd: bookRoot, createdAt: new Date().toISOString() });
	nativeWrites.set(narratorId, list);
}

beforeEach(async () => {
	workRoot = await mkdtemp(join(tmpdir(), "novel-draft-audit-"));
	const booksRoot = join(workRoot, "books");
	bookRoot = join(booksRoot, "book-a");
	await mkdir(join(bookRoot, "chapters"), { recursive: true });
	await writeFile(join(bookRoot, "book.json"), JSON.stringify({
		id: "book-a", title: "测试书籍", platform: "other", genre: "fantasy", status: "active",
		targetChapters: 100, chapterWordCount: 3000,
		createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	}), "utf8");
	await saveWorkflowRecipes(bookRoot, [{
		id: "audit-test",
		name: "写盘审计测试方案",
		commandId: "/novel:audit-test",
		description: "测试用",
		steps: [
			{ id: "draft", kind: "writer-generate", label: "写正文", enabled: true, requiresApproval: true },
			{ id: "save", kind: "post-settlement", label: "落盘", enabled: true, tools: ["chapter.commit"] },
		],
		resultStrategy: "formal-chapter",
		requireFinalApproval: false,
		maxRetries: 0,
	}]);
	const storage = initializeStorageDatabase({ databasePath: join(workRoot, "novelfork.db") });
	runStorageMigrations(storage);
	resolver = new MemoryResolver();
	resolver.context = Object.freeze({
		runtimeProjectId: "project-a",
		projectRoot: booksRoot,
		projectType: "novel",
		enabledPluginIds: Object.freeze(["novelfork-novel"]),
		resourceBindings: Object.freeze({
			"novel.book": Object.freeze({ kind: "novel.book", bookId: "book-a", root: bookRoot }),
		}),
	});
	nativeWrites = new Map();
	auditedNarrators = [];
	children = [];
});

afterEach(async () => {
	closeStorageDatabase();
	await rm(workRoot, { recursive: true, force: true });
});

async function startRun(narratorId = "narrator-a"): Promise<WorkflowRunRecord> {
	const result = await startWorkflowRun({
		storage: getStorageDatabase(),
		bookId: "book-a",
		bookRoot,
		recipeId: "audit-test",
		chapterNumber: 1,
		narratorId,
	});
	if (!result.ok) throw new Error(result.explanation.what);
	return result.data;
}

function parse(output: string): Record<string, unknown> {
	return JSON.parse(output) as Record<string, unknown>;
}

function adapter(): NovelRuntimeHostAdapter {
	return new NovelRuntimeHostAdapter(resolver, undefined, seams);
}

describe("哪些调用要过草稿写盘审计", () => {
	test("只有正文交稿与 chapter.commit", () => {
		expect(draftWriteAuditPhase("workflow.step", { action: "submit", kind: "prose" })).toBe("submit");
		expect(draftWriteAuditPhase("workflow.step", { action: "submit", kind: "audit" })).toBeNull();
		expect(draftWriteAuditPhase("workflow.step", { action: "current" })).toBeNull();
		expect(draftWriteAuditPhase("chapter.commit", {})).toBe("commit");
		expect(draftWriteAuditPhase("jingwei.write", {})).toBeNull();
	});
});

describe("auditWorkflowDraftWrites", () => {
	test("核对领导者、发起者与执笔 / 返修子代理；只写本章草稿时放行", async () => {
		const run = await startRun();
		children = ["writer-sub-1"];
		write("writer-sub-1", join(bookRoot, "chapters", "卷01", "0001_开篇.md"));
		write("writer-sub-1", join(bookRoot, ".narrafork", "plans", "p.md"));
		const result = await auditWorkflowDraftWrites(
			{ run, leaderNarratorId: "narrator-a", callerNarratorId: "writer-sub-1", bookRoot, phase: "submit" },
			seams,
		);
		expect(result).toEqual({ ok: true });
		expect(auditedNarrators.at(-1)?.sort()).toEqual(["narrator-a", "writer-sub-1"]);
	});

	test("子代理写到索引 / 书内数据：拒绝并列出越界文件", async () => {
		const run = await startRun();
		children = ["writer-sub-1"];
		write("writer-sub-1", join(bookRoot, "chapters", "index.json"));
		write("writer-sub-1", join(bookRoot, "story", "pending_hooks.md"), "Edit");
		const result = await auditWorkflowDraftWrites(
			{ run, leaderNarratorId: "narrator-a", callerNarratorId: "writer-sub-1", bookRoot, phase: "submit" },
			seams,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("workflow-draft-write-out-of-scope");
			expect(result.violations.map((item) => item.display)).toEqual(["chapters/index.json", "story/pending_hooks.md"]);
			expect(result.explanation.what).toContain("chapters/index.json");
			expect(result.explanation.action).toContain("blocker");
		}
	});

	test("路径未知按越界处理；取证失败 fail-closed", async () => {
		const run = await startRun();
		nativeWrites.set("narrator-a", [{ toolName: "Write", filePath: null, cwd: null, createdAt: null }]);
		const unknown = await auditWorkflowDraftWrites(
			{ run, leaderNarratorId: "narrator-a", callerNarratorId: "narrator-a", bookRoot, phase: "commit" },
			seams,
		);
		expect(unknown).toMatchObject({ ok: false, code: "workflow-draft-write-out-of-scope" });

		const broken = await auditWorkflowDraftWrites(
			{ run, leaderNarratorId: "narrator-a", callerNarratorId: "narrator-a", bookRoot, phase: "submit" },
			{ ...seams, listNativeWrites: async () => { throw new Error("runtime db down"); } },
		);
		expect(broken).toMatchObject({ ok: false, code: "workflow-draft-audit-unavailable" });
	});

	test("取证窗口从本轮起点开始：起点前的越界写入不算", async () => {
		const run = await startRun();
		let since = -1;
		await auditWorkflowDraftWrites(
			{ run, leaderNarratorId: "narrator-a", callerNarratorId: "narrator-a", bookRoot, phase: "submit" },
			{ ...seams, listNativeWrites: async (_ids, sinceMs) => { since = sinceMs; return []; } },
		);
		expect(since).toBeGreaterThanOrEqual(run.createdAt);
	});
});

describe("适配器接入：交稿与落盘前核对原生写盘", () => {
	test("领导者交正文：本轮原生写过索引 → 交稿被拦，运行不推进；只写草稿 → 放行", async () => {
		await startRun();
		const host = adapter();
		write("narrator-a", join(bookRoot, "chapters", "index.json"));
		const blocked = await host.execute(
			"workflow_step",
			{ action: "submit", runRevision: 0, kind: "prose", payload: { title: "开篇", content: PROSE } },
			"narrator-a",
		);
		expect(blocked.isError).toBe(true);
		const body = parse(blocked.output);
		expect(body.error).toBe("workflow-draft-write-out-of-scope");
		expect(String(body.summary)).toContain("chapters/index.json");
		expect(getActiveWorkflowRunForNarrator(getStorageDatabase(), "narrator-a")?.state.status).toBe("running");

		nativeWrites.clear();
		write("narrator-a", join(bookRoot, "chapters", "卷01", "0001_开篇.md"));
		const ok = await host.execute(
			"workflow_step",
			{ action: "submit", runRevision: 0, kind: "prose", payload: { title: "开篇", content: PROSE } },
			"narrator-a",
		);
		expect(parse(ok.output)).toMatchObject({ ok: true, data: { runStatus: "awaiting_approval" } });
	});

	test("正文批准后、落盘前又越界写了书内数据：chapter.commit 被拦", async () => {
		await startRun();
		const host = adapter();
		const submitted = await host.execute(
			"workflow_step",
			{ action: "submit", runRevision: 0, kind: "prose", payload: { title: "开篇", content: PROSE } },
			"narrator-a",
		);
		expect(parse(submitted.output)).toMatchObject({ ok: true });
		const storage = getStorageDatabase();
		const run = getActiveWorkflowRunForNarrator(storage, "narrator-a")!;
		expect(approveWorkflowStep({ storage, runId: run.id, stepId: "draft", expectedRevision: run.state.revision }).ok).toBe(true);

		children = ["writer-sub-1"];
		write("writer-sub-1", join(bookRoot, "story", "style_preset.json"));
		const blocked = await host.execute("chapter_commit", { chapterNumber: 1, fromWorkflowRun: true }, "narrator-a");
		expect(parse(blocked.output)).toMatchObject({ error: "workflow-draft-write-out-of-scope" });
		expect(String(parse(blocked.output).summary)).toContain("落盘被拦下");
	});

	test("没有进行中的运行：普通会话的 chapter.commit 不做写盘审计（作者正常用 Write / Edit 不受影响）", async () => {
		const host = adapter();
		write("narrator-a", join(bookRoot, "story", "notes.md"));
		const result = await host.execute("chapter_commit", { chapterNumber: 1, content: PROSE }, "narrator-a");
		expect(parse(result.output).error).not.toBe("workflow-draft-write-out-of-scope");
		expect(auditedNarrators).toHaveLength(0);
	});
});
