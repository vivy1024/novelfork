import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { Hono } from "hono";
import { AppError, chapters, db, projects } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { getNovelForkProductDatabase } from "../db/database";
import { bookRuntimeBindings } from "../db/schema";
import { getControlledBooksRoot } from "./book-binding";
import { isBookProjectMutation } from "./book-project-protection";

// 书的 Runtime 项目归作者所有（owner 有 manage 权限），但删书、改成员、转让等必须走产品入口：
// 绕过产品层直接改 Runtime 项目，会让书的绑定指向一个已不存在或已不归作者的项目。
const suffix = crypto.randomUUID();
const author = { sub: `book-project-author-${suffix}`, role: "user" as const };
const admin = { sub: `book-project-admin-${suffix}`, role: "admin" as const };
const bookId = `book-project-${suffix}`;
const bookProjectId = `book-project-p-${suffix}`;
const bookChapterId = `book-project-c-${suffix}`;
const plainProjectId = `plain-project-${suffix}`;
const bookRoot = resolve(getControlledBooksRoot(), bookId);
const now = new Date().toISOString();

type TestUser = { sub: string; role: "admin" | "user" };

/** 守卫之后挂一个替身 Runtime 路由：请求能走到这里就说明守卫放行；DELETE 真删项目行。 */
function projectApp(user: TestUser) {
	const app = new Hono<{ Variables: { user: TestUser } }>();
	const { mountAuthenticatedGuards } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards) throw new Error("NovelFork product integration did not provide authenticated guards");
	app.use("*", async (c, next) => { c.set("user", user as never); await next(); });
	mountAuthenticatedGuards(app);
	app.delete("/api/projects/:id", async (c) => {
		await db.delete(projects).where(eq(projects.id, c.req.param("id")));
		return c.json({ ok: true });
	});
	app.all("/api/projects/:id", (c) => c.json({ ok: true }));
	app.all("/api/projects/:id/*", (c) => c.json({ ok: true }));
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

const MUTATIONS = [
	["DELETE", ""],
	["PATCH", ""],
	["PATCH", "/visibility"],
	["POST", "/members"],
	["DELETE", "/members/someone"],
	["POST", "/transfer-owner"],
	["POST", "/backup/sync"],
	["POST", "/ruler/abandon"],
	["POST", "/ruler/merge"],
	["POST", "/ruler/rebase"],
	["POST", "/ruler/rebase-parked"],
	["POST", "/ruler/rebase-resolve"],
	["POST", "/ruler/fork"],
	["POST", "/volume-snapshots"],
	// Runtime 上游以后新增的写端点默认也被拦下（fail-closed）。
	["POST", "/some-future-action"],
	["PUT", "/settings"],
] as const;

async function projectExists(id: string): Promise<boolean> {
	return Boolean(await db.query.projects.findFirst({ where: eq(projects.id, id), columns: { id: true } }));
}

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	await mkdir(bookRoot, { recursive: true });
	await db.insert(projects).values([
		{ id: bookProjectId, name: "Book project", gitPath: bookRoot, createdAt: now, updatedAt: now },
		{ id: plainProjectId, name: "Plain project", createdAt: now, updatedAt: now },
	]);
	await db.insert(chapters).values({ id: bookChapterId, projectId: bookProjectId, title: "root", branch: "main", baseBranch: "main", createdAt: now, updatedAt: now });
	await getNovelForkProductDatabase().insert(bookRuntimeBindings).values({ id: `book-project-binding-${suffix}`, runtimeProjectId: bookProjectId, bookId, bookRoot, createdByUserId: author.sub, createdAt: now, updatedAt: now });
});

afterAll(async () => {
	await getNovelForkProductDatabase().delete(bookRuntimeBindings).where(inArray(bookRuntimeBindings.bookId, [bookId]));
	await db.delete(chapters).where(inArray(chapters.id, [bookChapterId]));
	await db.delete(projects).where(inArray(projects.id, [bookProjectId, plainProjectId]));
	await rm(bookRoot, { recursive: true, force: true });
});

describe("书的 Runtime 项目不能绕过产品层修改", () => {
	test("分类：只有修改类端点算书项目变更，读取与写作类端点不算", () => {
		const id = "p1";
		for (const [method, sub] of MUTATIONS) {
			expect(isBookProjectMutation(method, `/api/projects/${id}${sub}`, id), `${method} ${sub}`).toBe(true);
		}
		for (const [method, sub] of [
			["GET", ""],
			["GET", "/access"],
			["GET", "/graph"],
			["GET", "/ruler"],
			["GET", "/backup/status"],
			["HEAD", ""],
			["PATCH", "/graph/positions"],
			["PATCH", "/ruler/positions"],
		] as const) {
			expect(isBookProjectMutation(method, `/api/projects/${id}${sub}`, id), `${method} ${sub}`).toBe(false);
		}
	});

	test("作者对书项目的每个修改类请求都被拒，项目仍在", async () => {
		const app = projectApp(author);
		for (const [method, sub] of MUTATIONS) {
			const response = await app.request(`/api/projects/${bookProjectId}${sub}`, { method });
			expect(response.status, `${method} ${sub}`).toBe(403);
			const body = (await response.json()) as { code: string; error: string };
			expect(body.code).toBe("BOOK_PROJECT_PROTECTED");
			expect(body.error).toContain("删除作品");
		}
		expect(await projectExists(bookProjectId)).toBe(true);
	});

	test("管理员也不能直接删书项目", async () => {
		const response = await projectApp(admin).request(`/api/projects/${bookProjectId}`, { method: "DELETE" });
		expect(response.status).toBe(403);
		expect(await projectExists(bookProjectId)).toBe(true);
	});

	test("书项目的读取请求照常放行", async () => {
		const app = projectApp(author);
		expect((await app.request(`/api/projects/${bookProjectId}`)).status).toBe(200);
		expect((await app.request(`/api/projects/${bookProjectId}/access`)).status).toBe(200);
		expect((await app.request(`/api/projects/${bookProjectId}/graph`)).status).toBe(200);
		expect((await app.request(`/api/projects/${bookProjectId}/graph/positions`, { method: "PATCH" })).status).toBe(200);
	});

	test("别人的书项目：不透露它是一本书，按项目不存在处理", async () => {
		const stranger = { sub: `book-project-stranger-${suffix}`, role: "user" as const };
		const response = await projectApp(stranger).request(`/api/projects/${bookProjectId}`, { method: "DELETE" });
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain(bookId);
		expect(await projectExists(bookProjectId)).toBe(true);
	});

	test("没有绑定书的普通项目不受影响，DELETE 正常删除", async () => {
		const app = projectApp(author);
		expect((await app.request(`/api/projects/${plainProjectId}`, { method: "PATCH" })).status).toBe(200);
		expect((await app.request(`/api/projects/${plainProjectId}/transfer-owner`, { method: "POST" })).status).toBe(200);
		const deleted = await app.request(`/api/projects/${plainProjectId}`, { method: "DELETE" });
		expect(deleted.status).toBe(200);
		expect(await projectExists(plainProjectId)).toBe(false);
	});
});
