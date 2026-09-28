import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

const owner = { sub: `gateway-owner-${crypto.randomUUID()}`, role: "user" as const };
const outsider = { sub: `gateway-outsider-${crypto.randomUUID()}`, role: "user" as const };
let externalBookRoot = "";
let newExternalBookRoot = "";
let reboundBookRoot = "";
let bookId: string | null = null;
let bookNarratorId: string | null = null;
let newBookId: string | null = null;

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
		throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
	}
	app.use("*", async (c, next) => { c.set("user", user as never); await next(); });
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

type WorkspaceTreeNode = {
	path: string;
	children?: WorkspaceTreeNode[];
};

function flattenTreePaths(tree: WorkspaceTreeNode[]): string[] {
	const paths: string[] = [];
	const walk = (node: WorkspaceTreeNode) => {
		paths.push(node.path);
		node.children?.forEach(walk);
	};
	tree.forEach(walk);
	return paths;
}

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	externalBookRoot = await mkdtemp(join(tmpdir(), "novelfork-existing-workspace-"));
	newExternalBookRoot = await mkdtemp(join(tmpdir(), "novelfork-new-workspace-"));
	reboundBookRoot = await mkdtemp(join(tmpdir(), "novelfork-rebound-workspace-"));
	await mkdir(join(externalBookRoot, "jingwei"), { recursive: true });
	await writeFile(join(externalBookRoot, "source-marker.md"), "keep this source file intact\n", "utf8");
	await writeFile(join(externalBookRoot, "jingwei", "source-material.md"), "# 已有经纬资料\n\n必须从外部 workspace 读取。\n", "utf8");
});

afterAll(async () => {
	for (const id of [bookId, newBookId]) {
		if (!id) continue;
		try {
			await productApp(owner).request(`/api/novelfork/books/${id}`, { method: "DELETE" });
		} catch {
			// Best-effort fixture cleanup.
		}
	}
	await rm(externalBookRoot, { recursive: true, force: true });
	await rm(newExternalBookRoot, { recursive: true, force: true });
	await rm(reboundBookRoot, { recursive: true, force: true });
});

describe("NovelFork trusted narrator binding gateway", () => {
	test("binds an existing workspace through the product gateway without overwriting source files", async () => {
		const app = productApp(owner);
		const create = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: { "content-type": "application/json", "Idempotency-Key": `external-workspace-${crypto.randomUUID()}` },
			body: JSON.stringify({ title: "External workspace novel", projectInit: { source: "existing", workspaceRoot: externalBookRoot, managedByNovelFork: false } }),
		});
		const operation = await create.json() as { bookId?: string; narratorId?: string; state?: string; errorMessage?: string | null };
		expect({ status: create.status, operation }).toMatchObject({ status: 201, operation: { state: "ready", errorMessage: null } });
		if (!operation.bookId || !operation.narratorId) throw new Error("product gateway did not create a trusted binding");
		bookId = operation.bookId;
		bookNarratorId = operation.narratorId;

		const config = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as { id?: string; novelforkExternalWorkspace?: boolean };
		expect(config).toMatchObject({ id: bookId, novelforkExternalWorkspace: true });
		expect(await readFile(join(externalBookRoot, "source-marker.md"), "utf8")).toBe("keep this source file intact\n");

		const narrators = await app.request(`/api/books/${bookId}/narrators`);
		expect(narrators.status).toBe(200);
		expect(await narrators.json()).toMatchObject({ narrators: [expect.objectContaining({ id: operation.narratorId, bookId, cwd: externalBookRoot })] });
		const workspace = await app.request(`/api/books/${bookId}/workspace`);
		expect(workspace.status).toBe(200);
		expect(await workspace.json()).toMatchObject({ resources: expect.arrayContaining([expect.objectContaining({ path: "jingwei/source-material.md", content: "# 已有经纬资料\n\n必须从外部 workspace 读取。\n" })]) });
	});

	test("caches the trusted workspace tree, refreshes on demand, and invalidates after mutations", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		await mkdir(join(externalBookRoot, "chapters"), { recursive: true });
		await writeFile(join(externalBookRoot, "chapters", "0001_设备故障.md"), "# 第 1 章\n", "utf8");
		const largeTreeFiles = Array.from({ length: 600 }, (_, index) => {
			const shard = String(Math.floor(index / 150)).padStart(2, "0");
			const file = `entry-${String(index).padStart(4, "0")}.md`;
			return join(externalBookRoot, "large-tree", `shard-${shard}`, file);
		});
		await mkdir(join(externalBookRoot, "large-tree"), { recursive: true });
		await Promise.all(largeTreeFiles.map(async (file) => {
			await mkdir(join(file, ".."), { recursive: true });
			await writeFile(file, "# 大目录缓存测试\n", "utf8");
		}));

		const first = await app.request(`/api/books/${bookId}/files/tree?depth=8`);
		expect(first.status).toBe(200);
		const firstPayload = await first.json() as {
			tree: WorkspaceTreeNode[];
			cache: { hit: boolean; stale: boolean; refreshing: boolean };
		};
		expect(firstPayload.cache).toMatchObject({ hit: false, stale: false, refreshing: false });
		const firstPaths = flattenTreePaths(firstPayload.tree);
		expect(firstPaths).toContain("chapters/0001_设备故障.md");
		expect(firstPaths.filter((path) => path.startsWith("large-tree/") && path.endsWith(".md"))).toHaveLength(600);

		await writeFile(join(externalBookRoot, "cached-after-first.md"), "# 外部新增\n", "utf8");
		const cached = await app.request(`/api/books/${bookId}/files/tree?depth=8`);
		const cachedPayload = await cached.json() as {
			tree: WorkspaceTreeNode[];
			cache: { hit: boolean };
		};
		expect(cachedPayload.cache.hit).toBe(true);
		expect(flattenTreePaths(cachedPayload.tree)).not.toContain("cached-after-first.md");

		const refreshed = await app.request(`/api/books/${bookId}/files/tree?depth=8&refresh=1`);
		const refreshedPayload = await refreshed.json() as { tree: WorkspaceTreeNode[] };
		expect(flattenTreePaths(refreshedPayload.tree)).toContain("cached-after-first.md");

		const write = await app.request(`/api/books/${bookId}/files`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: "created-through-api.md", content: "# API 新建\n" }),
		});
		expect(write.status).toBe(200);
		const afterMutation = await app.request(`/api/books/${bookId}/files/tree?depth=8`);
		const afterMutationPayload = await afterMutation.json() as {
			tree: WorkspaceTreeNode[];
			cache: { hit: boolean };
		};
		expect(afterMutationPayload.cache.hit).toBe(false);
		expect(flattenTreePaths(afterMutationPayload.tree)).toContain("created-through-api.md");

		const originalDateNow = Date.now;
		const staleNow = originalDateNow() + 31_000;
		Date.now = () => staleNow;
		try {
			await writeFile(join(externalBookRoot, "external-editor-update.md"), "# 外部编辑器更新\n", "utf8");
			const stale = await app.request(`/api/books/${bookId}/files/tree?depth=8`);
			const stalePayload = await stale.json() as {
				tree: WorkspaceTreeNode[];
				cache: { hit: boolean; stale: boolean; refreshing: boolean };
			};
			expect(stalePayload.cache).toMatchObject({ hit: true, stale: true, refreshing: true });
			expect(flattenTreePaths(stalePayload.tree)).not.toContain("external-editor-update.md");

			const rebuilt = await app.request(`/api/books/${bookId}/files/tree?depth=8&refresh=1`);
			const rebuiltPayload = await rebuilt.json() as {
				tree: WorkspaceTreeNode[];
				cache: { stale: boolean; refreshing: boolean };
			};
			expect(rebuiltPayload.cache).toMatchObject({ stale: false, refreshing: false });
			expect(flattenTreePaths(rebuiltPayload.tree)).toContain("external-editor-update.md");
		} finally {
			Date.now = originalDateNow;
		}

		const read = await app.request(`/api/books/${bookId}/files/read?path=${encodeURIComponent("chapters/0001_设备故障.md")}`);
		expect(await read.json()).toEqual({ path: "chapters/0001_设备故障.md", content: "# 第 1 章\n" });
		expect((await app.request(`/api/books/${bookId}/files/read?path=../outside.txt`)).status).toBe(400);
		expect((await productApp(outsider).request(`/api/novelfork/books/${bookId}`, { method: "DELETE" })).status).toBe(404);
		await access(externalBookRoot);
	});

	test("materializes project writing skills without storing selection in book.json", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		const current = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as Record<string, unknown>;
		await writeFile(join(externalBookRoot, "book.json"), JSON.stringify({
			...current,
			narrativeMemory: { preservedForWritingSettingsTest: true },
		}, null, 2), "utf8");

		const skillsResponse = await app.request(`/api/books/${bookId}/writing-skills`);
		expect(skillsResponse.status).toBe(200);
		const skills = await skillsResponse.json() as { skills?: Array<{ id: string; slug: string; mode?: string }> };
		const skill = skills.skills?.find((candidate) => candidate.mode !== "always");
		const skillId = skill?.id;
		const skillSlug = skill?.slug;
		if (!skillId || !skillSlug) throw new Error("expected a builtin writing skill");
		expect((await app.request(`/api/books/${bookId}/writing-skills`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ addSkillIds: [skillId] }),
		})).status).toBe(200);

		const update = await app.request(`/api/books/${bookId}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: "External workspace novel updated",
				chapterWordCount: 3200,
				targetChapters: 180,
				arcTrackingMode: "rule",
				customSensitiveWords: "测试敏感词",
			}),
		});
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({
			book: {
				title: "External workspace novel updated",
				chapterWordCount: 3200,
				targetChapters: 180,
				arcTrackingMode: "rule",
			},
		});

		const saved = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as Record<string, unknown>;
		expect(saved).toMatchObject({
			id: bookId,
			novelforkExternalWorkspace: true,
			narrativeMemory: { preservedForWritingSettingsTest: true },
			chapterWordCount: 3200,
		});
		expect(saved).not.toHaveProperty("enabledWritingSkillIds");
		await access(join(externalBookRoot, ".novelfork", "skills", skillSlug, "SKILL.md"));
	});

	test("foreshadow thresholds are validated, saved to book.json and can be reset", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		const put = (body: unknown) => app.request(`/api/books/${bookId}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const readBook = async () => JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as Record<string, unknown>;

		// 临近提醒不小于超期、非整数都被拒绝，book.json 不变。
		for (const invalid of [
			{ watchChapters: 12, overdueChapters: 12 },
			{ watchChapters: 2.5, overdueChapters: 12 },
			{ watchChapters: 0, overdueChapters: 12 },
		]) {
			expect((await put({ foreshadowDebtThresholds: invalid })).status).toBe(400);
		}
		expect(await readBook()).not.toHaveProperty("foreshadowDebtThresholds");

		const saved = await put({ foreshadowDebtThresholds: { watchChapters: 8, overdueChapters: 30 } });
		expect(saved.status).toBe(200);
		expect(await readBook()).toMatchObject({ foreshadowDebtThresholds: { watchChapters: 8, overdueChapters: 30 } });

		// 外部工作区的书：叙事结构快照必须经可信绑定读到同一个 book.json，而不是回落默认值。
		const snapshot = await app.request(`/api/books/${bookId}/narrative-structure`);
		expect(snapshot.status).toBe(200);
		expect(await snapshot.json()).toMatchObject({ foreshadowThresholds: { watchChapters: 8, overdueChapters: 30 } });

		// null = 恢复默认：字段从 book.json 删除，其余设置保留。
		expect((await put({ foreshadowDebtThresholds: null })).status).toBe(200);
		const reset = await readBook();
		expect(reset).not.toHaveProperty("foreshadowDebtThresholds");
		expect(reset).toMatchObject({ chapterWordCount: 3200 });
		const resetSnapshot = await app.request(`/api/books/${bookId}/narrative-structure`);
		expect(await resetSnapshot.json()).toMatchObject({ foreshadowThresholds: { watchChapters: 5, overdueChapters: 12 } });
	});

	test("workflow runs: narrator ownership is verified, revisions are enforced, outsiders see nothing", async () => {
		if (!bookId || !bookNarratorId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		const post = (path: string, body: unknown) => app.request(`/api/books/${bookId}/workflow-runs${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		// 不属于这本书的叙述者不能启动运行。
		const forged = await post("", { recipeId: "fanqie-xuanhuan-serial", chapterNumber: 1, narratorId: "forged-narrator" });
		expect(forged.status).toBe(404);

		const started = await post("", { recipeId: "fanqie-xuanhuan-serial", chapterNumber: 1, narratorId: bookNarratorId });
		expect(started.status).toBe(201);
		const detail = await started.json() as {
			run: { id: string; status: string; revision: number; currentStepId: string };
			brief: string;
			graph: { nodes: Array<{ id: string }>; edges: unknown[] };
		};
		expect(detail.run).toMatchObject({ status: "running", revision: 0, currentStepId: "step-context" });
		// 运行详情带上所用方案的快照结构，画布据此叠加各工序状态。
		expect(detail.graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["start", "step-context", "end"]));
		expect(detail.graph.edges.length).toBeGreaterThan(0);
		expect(detail.brief).toContain("当前工序（共 5 道）");
		const runPath = `/${encodeURIComponent(detail.run.id)}`;

		const listed = await app.request(`/api/books/${bookId}/workflow-runs?narratorId=${encodeURIComponent(bookNarratorId)}`);
		expect(await listed.json()).toMatchObject({ active: { run: { id: detail.run.id } } });

		// 同一叙述者不能同时开第二个。
		expect((await post("", { recipeId: "fanqie-xuanhuan-serial", chapterNumber: 2, narratorId: bookNarratorId })).status).toBe(409);
		// 没带版本号 → 400；版本号过期 → 409；当前工序不在等待确认 → 409。
		expect((await post(`${runPath}/cancel`, {})).status).toBe(400);
		expect((await post(`${runPath}/cancel`, { expectedRevision: 7 })).status).toBe(409);
		expect((await post(`${runPath}/steps/step-context/approve`, { expectedRevision: 0 })).status).toBe(409);

		// 其他用户看不到这本书的运行。
		expect((await productApp(outsider).request(`/api/books/${bookId}/workflow-runs`)).status).toBe(404);
		expect((await productApp(outsider).request(`/api/books/${bookId}/workflow-runs${runPath}`)).status).toBe(404);

		const cancelled = await post(`${runPath}/cancel`, { expectedRevision: 0 });
		expect(cancelled.status).toBe(200);
		expect(await cancelled.json()).toMatchObject({ run: { status: "cancelled", revision: 1 } });
		const after = await app.request(`/api/books/${bookId}/workflow-runs?narratorId=${encodeURIComponent(bookNarratorId)}`);
		expect(await after.json()).toMatchObject({ active: null, recent: [expect.objectContaining({ id: detail.run.id, status: "cancelled" })] });
	});

	test("workflow recipes: per-recipe save enforces revisions and publish checks, outsiders are denied", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		const put = (user: typeof owner, recipe: Record<string, unknown>, expectedRevision: number) => productApp(user).request(`/api/books/${bookId}/workflow-recipes/${String(recipe.id)}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ recipe, expectedRevision }),
		});
		const draft = {
			schemaVersion: 2,
			id: "gateway-flow",
			name: "网关流程",
			commandId: "/novel:gateway",
			description: "",
			status: "draft",
			revision: 0,
			nodes: [
				{ id: "start", type: "start", label: "开始" },
				{ id: "a", type: "step", label: "写", kind: "writer-generate", enabled: true },
				{ id: "end", type: "end", label: "完成" },
			],
			edges: [{ id: "e1", source: "start", target: "a", kind: "next" }],
			resultStrategy: "formal-chapter",
			maxRetries: 1,
		};

		// 外人不能写这本书的方案。
		expect((await put(outsider, draft, 0)).status).toBe(404);

		// 缺一条连线的草稿可以存，列表里带出结构问题；带问题发布被拒并给出说明。
		const saved = await put(owner, draft, 0);
		expect(saved.status).toBe(200);
		expect(await saved.json()).toMatchObject({ recipe: { id: "gateway-flow", revision: 1, status: "draft" } });
		const listed = (await (await app.request(`/api/books/${bookId}/workflow-recipes`)).json()) as { issues: Record<string, Array<{ code: string }>> };
		expect(listed.issues["gateway-flow"]!.map((issue) => issue.code)).toContain("step-dangling");
		const publishBroken = await put(owner, { ...draft, status: "published" }, 1);
		expect(publishBroken.status).toBe(400);
		expect(await publishBroken.json()).toMatchObject({ code: "graph-invalid", explanation: { action: expect.stringContaining("草稿") } });

		// 补上连线后发布成功；按旧版本再存返回 409。
		const fixed = { ...draft, status: "published", edges: [...draft.edges, { id: "e2", source: "a", target: "end", kind: "next" }] };
		expect((await put(owner, fixed, 1)).status).toBe(200);
		expect((await put(owner, fixed, 1)).status).toBe(409);

		// 删除同样核对版本，外人删不了。
		expect((await productApp(outsider).request(`/api/books/${bookId}/workflow-recipes/gateway-flow?expectedRevision=2`, { method: "DELETE" })).status).toBe(404);
		expect((await app.request(`/api/books/${bookId}/workflow-recipes/gateway-flow?expectedRevision=2`, { method: "DELETE" })).status).toBe(200);
	});

	test("chapter reconcile picks up writes that bypass the product layer, once", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		const created = await app.request(`/api/books/${bookId}/chapters`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "对账测试" }),
		});
		expect(created.status).toBe(201);
		const { chapter } = await created.json() as { chapter: { path: string; metadata: { chapterNumber?: number } } };
		const chapterNumber = Number(/\/(\d+)_/u.exec(chapter.path)?.[1]);
		expect(chapterNumber).toBeGreaterThan(0);

		const saved = await app.request(`/api/books/${bookId}/chapters/${chapterNumber}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: `# 对账测试\n\n${"字".repeat(200)}` }),
		});
		expect(saved.status).toBe(200);

		type FeedRead = { epoch: string; revision: number; changes: unknown[]; truncated?: true };
		const reconcile = async (since?: number) => {
			const query = since === undefined ? "" : `?since=${since}`;
			return await (await app.request(`/api/books/${bookId}/chapters/reconcile${query}`, { method: "POST" })).json() as FeedRead;
		};
		// 首次读取只拿基准修订号；写作台自己的保存不算外部改动。
		const baseline = await reconcile();
		expect(baseline.changes).toEqual([]);
		expect(await reconcile(baseline.revision)).toEqual({ epoch: baseline.epoch, revision: baseline.revision, changes: [] });

		// 模拟叙述者用通用 Write 工具或外部编辑器直接改文件。
		const absolutePath = join(externalBookRoot, chapter.path);
		await writeFile(absolutePath, `# 对账测试\n\n${"字".repeat(500)}`, "utf8");
		const later = new Date(Date.now() + 5_000);
		await utimes(absolutePath, later, later);
		const configBefore = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as { updatedAt?: string };

		// 别的入口（加载工作区）先触发了对账：变更进流水，轮询方照样能取回。
		expect((await app.request(`/api/books/${bookId}/workspace`)).status).toBe(200);
		const configAfter = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as { updatedAt?: string };
		expect(configAfter.updatedAt).not.toBe(configBefore.updatedAt);

		const polled = await reconcile(baseline.revision);
		expect(polled).toEqual({
			epoch: baseline.epoch,
			revision: baseline.revision + 1,
			changes: [{ chapterNumber, path: chapter.path, kind: "modified", wordCount: 500 }],
		});
		expect((await reconcile(polled.revision)).changes).toEqual([]);

		const invalid = await app.request(`/api/books/${bookId}/chapters/reconcile?since=-1`, { method: "POST" });
		expect(invalid.status).toBe(400);
		const outsiderResponse = await productApp(outsider).request(`/api/books/${bookId}/chapters/reconcile`, { method: "POST" });
		expect(outsiderResponse.status).toBeGreaterThanOrEqual(403);
	});

	test("rebinds an existing book to a marked external workspace", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		await writeFile(
			join(reboundBookRoot, "book.json"),
			JSON.stringify({
				id: bookId,
				title: "Rebound external workspace novel",
				chapterWordCount: 2800,
				preservedExternalSetting: true,
			}, null, 2),
			"utf8",
		);

		const app = productApp(owner);
		const rebind = await app.request(`/api/novelfork/books/${bookId}/rebind-workspace`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ workspaceRoot: reboundBookRoot }),
		});
		expect(rebind.status).toBe(200);
		expect(await rebind.json()).toMatchObject({ bookId, bookRoot: reboundBookRoot });

		const saved = JSON.parse(await readFile(join(reboundBookRoot, "book.json"), "utf8")) as Record<string, unknown>;
		expect(saved).toMatchObject({
			id: bookId,
			title: "Rebound external workspace novel",
			novelforkExternalWorkspace: true,
			preservedExternalSetting: true,
		});
		const narrators = await app.request(`/api/books/${bookId}/narrators`);
		expect(await narrators.json()).toMatchObject({
			narrators: [expect.objectContaining({ bookId, cwd: reboundBookRoot })],
		});
	});

	test("creates a new workspace at the user-selected book_root instead of controlled books dir", async () => {
		const app = productApp(owner);
		const create = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"Idempotency-Key": `new-workspace-${crypto.randomUUID()}`,
			},
			body: JSON.stringify({
				title: "New external workspace novel",
				projectInit: {
					source: "new",
					workspaceRoot: newExternalBookRoot,
					managedByNovelFork: false,
				},
			}),
		});
		const operation = await create.json() as {
			bookId?: string;
			narratorId?: string;
			state?: string;
			errorMessage?: string | null;
		};
		expect({ status: create.status, operation }).toMatchObject({
			status: 201,
			operation: { state: "ready", errorMessage: null },
		});
		if (!operation.bookId || !operation.narratorId) {
			throw new Error("product gateway did not create a new external binding");
		}
		newBookId = operation.bookId;

		const config = JSON.parse(
			await readFile(join(newExternalBookRoot, "book.json"), "utf8"),
		) as { id?: string; novelforkExternalWorkspace?: boolean };
		expect(config).toMatchObject({
			id: operation.bookId,
			novelforkExternalWorkspace: true,
		});

		const narrators = await app.request(`/api/books/${operation.bookId}/narrators`);
		expect(narrators.status).toBe(200);
		expect(await narrators.json()).toMatchObject({
			narrators: [
				expect.objectContaining({
					id: operation.narratorId,
					bookId: operation.bookId,
					cwd: newExternalBookRoot,
				}),
			],
		});
	});
});
