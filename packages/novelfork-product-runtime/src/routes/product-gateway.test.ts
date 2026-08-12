import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
