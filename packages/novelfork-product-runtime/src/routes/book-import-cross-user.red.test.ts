import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { getControlledBooksRoot } from "../services/book-binding";

// T-03②：用户 B 不能用 /books/import 的 sourcePath 指向与用户 A 的书重叠的目录。
// cp 整目录会把 A 的书复制进 B 的受控根；B 的响应也不得泄露 A 的书 id，或该目录是否属于他人。
const ownerA = { sub: `import-owner-a-${crypto.randomUUID()}`, role: "user" as const };
const userB = { sub: `import-user-b-${crypto.randomUUID()}`, role: "user" as const };

function productApp(user: typeof ownerA) {
	const app = new Hono<{ Variables: { user: typeof ownerA } }>();
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

const createdRoots: string[] = [];

async function exists(path: string): Promise<boolean> {
	return access(path).then(() => true, () => false);
}

/** 以指定用户建立外部书，返回绑定的 bookId。 */
async function createExternalBookAs(app: ReturnType<typeof productApp>, title: string, root: string): Promise<string> {
	const created = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `t03-create-${crypto.randomUUID()}` },
		body: JSON.stringify({ title, projectInit: { source: "existing", workspaceRoot: root, managedByNovelFork: false } }),
	});
	expect(created.status).toBe(201);
	return ((await created.json()) as { bookId: string }).bookId;
}

/** 以指定用户调用导入，返回状态码与完整响应体，便于与「路径不存在」的响应逐字比对。 */
async function importAs(app: ReturnType<typeof productApp>, sourcePath: string): Promise<{ status: number; text: string }> {
	const response = await app.request("/api/novelfork/books/import", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `t03-import-${crypto.randomUUID()}` },
		body: JSON.stringify({ sourcePath }),
	});
	return { status: response.status, text: await response.text() };
}

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

afterAll(async () => {
	for (const root of createdRoots) await rm(root, { recursive: true, force: true });
});

describe("T-03②：跨用户 /books/import", () => {
	test("B 指向 A 的书目录：被拒，不复制，响应与「路径不存在」逐字一致且不含 A 的书 id", async () => {
		const appA = productApp(ownerA);
		const appB = productApp(userB);
		const root = await mkdtemp(join(tmpdir(), "novelfork-t03-owner-book-"));
		createdRoots.push(root);
		const jsonId = `t03-a-${crypto.randomUUID().slice(0, 8)}`;
		await mkdir(join(root, "chapters"), { recursive: true });
		await writeFile(join(root, "book.json"), `${JSON.stringify({ id: jsonId, title: "A 的书" })}\n`, "utf8");
		await writeFile(join(root, "chapters", "index.json"), "[]\n", "utf8");
		const boundId = await createExternalBookAs(appA, "A 的外部书", root);

		const foreign = await importAs(appB, root);
		const missing = await importAs(appB, join(tmpdir(), `nf-t03-missing-${crypto.randomUUID()}`));
		expect(foreign).toEqual(missing);
		expect(foreign.text).not.toContain(boundId);
		expect(foreign.text).not.toContain(jsonId);
		expect(await exists(join(getControlledBooksRoot(), jsonId))).toBe(false);
		expect(await readFile(join(root, "book.json"), "utf8")).toContain("A 的书");
	});

	test("B 指向包住 A 书根的上级目录：被拒，A 的子书不被复制进 B 的受控根", async () => {
		const appA = productApp(ownerA);
		const appB = productApp(userB);
		const parent = await mkdtemp(join(tmpdir(), "novelfork-t03-parent-"));
		createdRoots.push(parent);
		const parentJsonId = `t03-parent-${crypto.randomUUID().slice(0, 8)}`;
		await mkdir(join(parent, "chapters"), { recursive: true });
		await writeFile(join(parent, "book.json"), `${JSON.stringify({ id: parentJsonId, title: "上级的书" })}\n`, "utf8");
		await writeFile(join(parent, "chapters", "index.json"), "[]\n", "utf8");
		const childRoot = join(parent, "a-book");
		const childJsonId = `t03-child-${crypto.randomUUID().slice(0, 8)}`;
		await mkdir(join(childRoot, "chapters"), { recursive: true });
		await writeFile(join(childRoot, "book.json"), `${JSON.stringify({ id: childJsonId, title: "A 的子书" })}\n`, "utf8");
		await writeFile(join(childRoot, "chapters", "index.json"), "[]\n", "utf8");
		const boundChildId = await createExternalBookAs(appA, "A 的子书", childRoot);

		const foreign = await importAs(appB, parent);
		const missing = await importAs(appB, join(tmpdir(), `nf-t03-missing-${crypto.randomUUID()}`));
		expect(foreign).toEqual(missing);
		expect(foreign.text).not.toContain(boundChildId);
		expect(foreign.text).not.toContain(childJsonId);
		expect(await exists(join(getControlledBooksRoot(), parentJsonId, "a-book"))).toBe(false);
		expect(await readFile(join(childRoot, "book.json"), "utf8")).toContain("A 的子书");
	});

	test("A 的书目录名以 .. 开头（如 ..backup）时，B 指向其上级仍被拒（不得因子串 .. 误判为越界）", async () => {
		const appA = productApp(ownerA);
		const appB = productApp(userB);
		const parent = await mkdtemp(join(tmpdir(), "novelfork-t03-dotdot-"));
		createdRoots.push(parent);
		const parentJsonId = `t03-dotp-${crypto.randomUUID().slice(0, 8)}`;
		await mkdir(join(parent, "chapters"), { recursive: true });
		await writeFile(join(parent, "book.json"), `${JSON.stringify({ id: parentJsonId, title: "上级的书" })}\n`, "utf8");
		await writeFile(join(parent, "chapters", "index.json"), "[]\n", "utf8");
		const dotRoot = join(parent, "..backup");
		const dotJsonId = `t03-dotc-${crypto.randomUUID().slice(0, 8)}`;
		await mkdir(join(dotRoot, "chapters"), { recursive: true });
		await writeFile(join(dotRoot, "book.json"), `${JSON.stringify({ id: dotJsonId, title: "A 的点号书" })}\n`, "utf8");
		await writeFile(join(dotRoot, "chapters", "index.json"), "[]\n", "utf8");
		await createExternalBookAs(appA, "A 的点号书", dotRoot);

		const foreign = await importAs(appB, parent);
		const missing = await importAs(appB, join(tmpdir(), `nf-t03-missing-${crypto.randomUUID()}`));
		expect(foreign).toEqual(missing);
		expect(await readFile(join(dotRoot, "book.json"), "utf8")).toContain("A 的点号书");
		expect(await exists(join(getControlledBooksRoot(), parentJsonId, "..backup"))).toBe(false);
	});
});
