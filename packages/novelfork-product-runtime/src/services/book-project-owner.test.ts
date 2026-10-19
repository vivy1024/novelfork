import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { db as runtimeDb, projects, users } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { bookRuntimeBindingService } from "./book-binding";
import { reconcileBookProjectOwners } from "./book-project-owner";

/**
 * 建书必须把 Runtime 项目的 owner 落成本书的归属人。
 *
 * Runtime 的写权限只认 admin / owner / 显式 write 授权（`canWriteProject`），而写作台「本书设置」
 * 嵌的就是 Runtime 项目设置界面（项目技能、可选工具套路覆盖）。项目没有 owner 时，非管理员
 * 作者看到的是只读界面、保存被 404 拒绝——这正是本次修复要消灭的状态。
 *
 * `canWriteProject` 用「非字面量指示符的动态 import」取。两个约束同时成立才这样写：
 *   - 静态 import（或字面量 import()）会把整棵 Runtime 源码树拉进本包的 TypeScript 程序——
 *     实测多出 1600+ 条上游类型错误；
 *   - Runtime 是 ESM，`createRequire` 加载会抛「async module is unsupported」。
 * 指示符是变量时 TypeScript 无法解析，类型按 any 处理，运行时则由 Bun 正常加载 ESM。
 */
const PROJECT_ACL_SPECIFIER = resolve(
	import.meta.dir,
	"../../../narrafork-runtime-private/server/services/project-acl.ts",
);

interface ProjectAclRow {
	id: string;
	ownerUserId: string | null;
	visibility: string;
}

interface ProjectPrincipal {
	userId: string;
	isAdmin: boolean;
}

type CanWriteProject = (row: ProjectAclRow, principal: ProjectPrincipal) => Promise<boolean>;

let canWriteProjectPromise: Promise<CanWriteProject> | null = null;
function loadCanWriteProject(): Promise<CanWriteProject> {
	canWriteProjectPromise ??= import(PROJECT_ACL_SPECIFIER).then(
		(mod) => mod.canWriteProject as CanWriteProject,
	);
	return canWriteProjectPromise;
}

const ownerId = `owner-${crypto.randomUUID()}`;
const owner = { sub: ownerId, role: "user" as const };

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) throw new Error("missing product mounts");
	app.use("*", async (c, next) => {
		c.set("user", user as never);
		await next();
	});
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) =>
		error instanceof AppError
			? c.json({ code: error.code, error: error.message }, error.statusCode as never)
			: c.json({ error: String(error) }, 500),
	);
	return app;
}

async function createBook(user: typeof owner, title: string) {
	const response = await productApp(user).request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `owner-${crypto.randomUUID()}` },
		body: JSON.stringify({ title }),
	});
	const body = (await response.json()) as { bookId?: string; state?: string; error?: string };
	if (response.status !== 201 || !body.bookId) {
		throw new Error(`book creation failed: ${response.status} ${JSON.stringify(body)}`);
	}
	return body.bookId;
}

async function projectOwnerOf(bookId: string): Promise<string | null> {
	const binding = await bookRuntimeBindingService.getByBookId(bookId);
	if (!binding) throw new Error(`no binding for ${bookId}`);
	const project = await runtimeDb.query.projects.findFirst({
		where: eq(projects.id, binding.runtimeProjectId),
		columns: { ownerUserId: true },
	});
	if (!project) throw new Error(`no project for ${bookId}`);
	return project.ownerUserId;
}

let booksRoot: string;

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	booksRoot = process.env.NOVELFORK_BOOKS_ROOT ?? "";
	// 真实 Runtime 用户：owner_user_id 是 users 外键，只有存在的用户才落得进去。
	await runtimeDb.insert(users).values({
		id: ownerId,
		username: `owner-${ownerId.slice(-8)}`,
		passwordHash: "x",
		role: "user",
		createdAt: new Date().toISOString(),
	});
});

afterAll(async () => {
	if (booksRoot) await rm(booksRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("建书时写下 Runtime 项目 owner", () => {
	test("建出的项目 owner 就是建书人：非管理员作者因此拿到项目写权限", async () => {
		const bookId = await createBook(owner, "有主之书");
		expect(await projectOwnerOf(bookId)).toBe(ownerId);

		// 非管理员、非 owner 会在这里被拒；能通过说明 owner 生效，写作台保存不会 404。
		const binding = await bookRuntimeBindingService.getByBookId(bookId);
		const project = await runtimeDb.query.projects.findFirst({
			where: eq(projects.id, binding!.runtimeProjectId),
			columns: { id: true, ownerUserId: true, visibility: true },
		});
		expect(await (await loadCanWriteProject())(project!, { userId: ownerId, isAdmin: false })).toBe(true);
	});

	test("建书人的 id 不是 Runtime 用户时留空而不是建书失败（owner 是外键）", async () => {
		const ghost = { sub: `ghost-${crypto.randomUUID()}`, role: "user" as const };
		const bookId = await createBook(ghost, "无主之书");
		expect(await projectOwnerOf(bookId)).toBeNull();
	});

	test("visibility 不给其他人写权限：private 的书只有归属人和管理员能打开", async () => {
		const bookId = await createBook(owner, "私密之书");
		const binding = await bookRuntimeBindingService.getByBookId(bookId);
		const project = await runtimeDb.query.projects.findFirst({
			where: eq(projects.id, binding!.runtimeProjectId),
			columns: { id: true, ownerUserId: true, visibility: true },
		});
		expect(project?.visibility).toBe("private");
		expect(await (await loadCanWriteProject())(project!, { userId: "someone-else", isAdmin: false })).toBe(false);
	});
});

describe("老书（本次修复前建的）补 owner", () => {
	test("只补 owner 仍为空的项目，重复跑不再改动", async () => {
		const bookId = await createBook(owner, "老书");
		const binding = await bookRuntimeBindingService.getByBookId(bookId);
		await runtimeDb
			.update(projects)
			.set({ ownerUserId: null })
			.where(eq(projects.id, binding!.runtimeProjectId));

		const first = await reconcileBookProjectOwners();
		expect(first.adopted).toBeGreaterThanOrEqual(1);
		expect(await projectOwnerOf(bookId)).toBe(ownerId);

		const second = await reconcileBookProjectOwners();
		expect(second.adopted).toBe(0);
		expect(await projectOwnerOf(bookId)).toBe(ownerId);
	});

	test("归别人所有的项目不被抢走（owner 不同即原样保留）", async () => {
		const otherOwnerId = `other-${crypto.randomUUID()}`;
		await runtimeDb.insert(users).values({
			id: otherOwnerId,
			username: `other-${otherOwnerId.slice(-8)}`,
			passwordHash: "x",
			role: "user",
			createdAt: new Date().toISOString(),
		});
		const bookId = await createBook(owner, "别人的书");
		const binding = await bookRuntimeBindingService.getByBookId(bookId);
		await runtimeDb
			.update(projects)
			.set({ ownerUserId: otherOwnerId })
			.where(eq(projects.id, binding!.runtimeProjectId));

		await reconcileBookProjectOwners();
		expect(await projectOwnerOf(bookId)).toBe(otherOwnerId);
	});

	test("绑定里的建书人已不存在时留空并计入 unresolved，不误写外键", async () => {
		const ghost = { sub: `ghost2-${crypto.randomUUID()}`, role: "user" as const };
		const bookId = await createBook(ghost, "孤儿绑定");
		const binding = await bookRuntimeBindingService.getByBookId(bookId);
		const result = await reconcileBookProjectOwners();
		expect(result.unresolved).toBeGreaterThanOrEqual(1);
		expect(await projectOwnerOf(bookId)).toBeNull();
		expect(binding).not.toBeNull();
	});
});
