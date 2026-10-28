import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError, db as runtimeDb, projects } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { getNovelForkProductDatabase } from "../db/database";
import { bookProvisionOperations } from "../db/schema";
import { bookRuntimeBindingService, getControlledBooksRoot } from "../services/book-binding";
import { novelForkProductBookService } from "../services/book-provision";

// 受控书根下没有建书记录、也没有绑定的旧书，只能由管理员走 claim 认领。
// 普通用户在建书请求里带上它的 bookId，不能借 create 把它接管进自己的书架。
const user = { sub: `takeover-user-${crypto.randomUUID()}`, role: "user" as const };
const admin = { sub: `takeover-admin-${crypto.randomUUID()}`, role: "admin" as const };
const LEGACY_TEXT = "旧书原文：这一章只属于原作者。\n";

type TestUser = { sub: string; role: "user" | "admin" };

function productApp(actor: TestUser) {
	const app = new Hono<{ Variables: { user: TestUser } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
		throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
	}
	app.use("*", async (c, next) => { c.set("user", actor as never); await next(); });
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

const createdBookIds: string[] = [];

/** 在受控书根下放一本「旧书」：有 book.json 与正文，但没有建书记录和绑定。 */
async function seedLegacyBook(extra: Record<string, unknown> = {}): Promise<{ bookId: string; root: string; configText: string }> {
	const bookId = `legacy-${crypto.randomUUID().slice(0, 8)}`;
	createdBookIds.push(bookId);
	const root = join(getControlledBooksRoot(), bookId);
	await mkdir(join(root, "chapters"), { recursive: true });
	const configText = `${JSON.stringify({ id: bookId, title: "原作者的旧书", createdAt: "2020-01-01T00:00:00.000Z", ...extra }, null, 2)}\n`;
	await writeFile(join(root, "book.json"), configText, "utf8");
	await writeFile(join(root, "chapters", "index.json"), "[]\n", "utf8");
	await writeFile(join(root, "chapters", "0001_第一章.md"), LEGACY_TEXT, "utf8");
	return { bookId, root, configText };
}

async function createAs(app: ReturnType<typeof productApp>, body: Record<string, unknown>, key = `takeover-${crypto.randomUUID()}`) {
	const response = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": key },
		body: JSON.stringify(body),
	});
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function provisionRecord(bookId: string) {
	return getNovelForkProductDatabase().query.bookProvisionOperations.findFirst({
		where: eq(bookProvisionOperations.bookId, bookId),
	});
}

async function runtimeProjectsAt(root: string) {
	return runtimeDb.query.projects.findMany({ where: eq(projects.gitPath, root) });
}

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

afterAll(async () => {
	for (const bookId of createdBookIds) {
		await rm(join(getControlledBooksRoot(), bookId), { recursive: true, force: true });
	}
});

describe("建书不能接管受控根下的旧书", () => {
	test("普通用户带旧书 bookId 建书：被拒，且没有留下任何记录、项目或绑定", async () => {
		const { bookId, root, configText } = await seedLegacyBook();
		const app = productApp(user);

		const result = await createAs(app, { title: "抢来的书", bookId });
		expect(result.status).toBe(400);
		expect(result.body.code).toBe("BOOK_ROOT_ALREADY_EXISTS");
		expect(String(result.body.error)).not.toContain(LEGACY_TEXT.trim());

		expect(await provisionRecord(bookId)).toBeUndefined();
		expect(await bookRuntimeBindingService.getByBookId(bookId)).toBeNull();
		expect(await runtimeProjectsAt(root)).toHaveLength(0);
		expect(await readFile(join(root, "book.json"), "utf8")).toBe(configText);

		const shelf = await app.request("/api/novelfork/books");
		expect(JSON.stringify(await shelf.json())).not.toContain(bookId);
		expect((await app.request(`/api/books/${bookId}/workspace`)).status).not.toBe(200);
	});

	test("管理员也不能用建书静默接管，提示改走认领；认领仍然可用", async () => {
		const { bookId, root } = await seedLegacyBook();
		const app = productApp(admin);

		const result = await createAs(app, { title: "管理员建书", bookId });
		expect(result.status).toBe(400);
		expect(result.body.code).toBe("BOOK_ROOT_ALREADY_EXISTS");
		expect(String(result.body.error)).toContain("认领");
		expect(await provisionRecord(bookId)).toBeUndefined();
		expect(await runtimeProjectsAt(root)).toHaveLength(0);

		const claimed = await app.request(`/api/novelfork/books/${bookId}/claim`, { method: "POST" });
		expect(claimed.status).toBe(200);
		expect(((await claimed.json()) as { state: string }).state).toBe("ready");
		expect(await bookRuntimeBindingService.getByBookId(bookId)).not.toBeNull();
	});

	test("受控根下同名目录虽不是作品（没有 book.json）也拒绝，不在里面落半本书", async () => {
		const bookId = `occupied-${crypto.randomUUID().slice(0, 8)}`;
		createdBookIds.push(bookId);
		const root = join(getControlledBooksRoot(), bookId);
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "notes.md"), "别人的笔记\n", "utf8");

		const result = await createAs(productApp(user), { title: "占位目录", bookId });
		expect(result.status).toBe(400);
		expect(result.body.code).toBe("BOOK_ROOT_ALREADY_EXISTS");
		expect(await provisionRecord(bookId)).toBeUndefined();
	});

	test("新 bookId 正常建书，同一 Idempotency-Key 重试返回同一本书", async () => {
		const bookId = `fresh-${crypto.randomUUID().slice(0, 8)}`;
		createdBookIds.push(bookId);
		const app = productApp(user);
		const key = `takeover-retry-${crypto.randomUUID()}`;
		const first = await createAs(app, { title: "全新的书", bookId }, key);
		expect(first.status).toBe(201);
		const second = await createAs(app, { title: "全新的书", bookId }, key);
		expect(second.status).toBe(201);
		expect(second.body.id).toBe(first.body.id);
		expect(second.body.bookId).toBe(bookId);
	});
});

describe("promoteFilesystem 兜底：只沿用本次建书自己写下的目录", () => {
	async function insertCreateOperation(bookId: string, createdAt: string) {
		const operation = {
			id: crypto.randomUUID(),
			actorUserId: user.sub,
			idempotencyKey: `takeover-fallback-${crypto.randomUUID()}`,
			bookId,
			title: "中断的建书",
			// 与 create() 写入的记录同形：带上建书来源标记。
			inputJson: { title: "中断的建书", bookId, projectInit: { source: "none", managedByNovelFork: true }, provisionOrigin: "create" },
			state: "core-staged" as const,
			runtimeProjectId: null,
			runtimeChapterId: null,
			narratorId: null,
			errorMessage: null,
			createdAt,
			updatedAt: createdAt,
		};
		await getNovelForkProductDatabase().insert(bookProvisionOperations).values(operation);
		return operation;
	}

	test("建书记录已在 core-staged、目录却是别人的旧书：继续时拒绝，不绑定", async () => {
		const { bookId, root, configText } = await seedLegacyBook();
		await insertCreateOperation(bookId, new Date().toISOString());

		const result = await novelForkProductBookService.retry(bookId, { userId: user.sub, role: "user" });
		expect(result.state).toBe("compensation-required");
		expect(result.error).toContain("认领");
		expect(await bookRuntimeBindingService.getByBookId(bookId)).toBeNull();
		expect(await runtimeProjectsAt(root)).toHaveLength(0);
		expect(await readFile(join(root, "book.json"), "utf8")).toBe(configText);
	});

	test("上次中断在目录转正之后：目录是本次建书写的（createdAt 一致），继续完成", async () => {
		const createdAt = new Date().toISOString();
		const { bookId } = await seedLegacyBook({ title: "中断的建书", createdAt });
		await insertCreateOperation(bookId, createdAt);

		const result = await novelForkProductBookService.retry(bookId, { userId: user.sub, role: "user" });
		expect(result.state).toBe("ready");
		expect(await bookRuntimeBindingService.getByBookId(bookId)).not.toBeNull();
	});
});
