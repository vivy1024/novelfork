/**
 * 项目档案产品路由：经真实建书、可信绑定与书籍访问守卫导出、导入为新书，并核对 Runtime 绑定与数据。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { getStorageDatabase as getNovelStorage } from "@vivy1024/novelfork-core";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { getControlledBooksRoot } from "../services/book-binding";
import { countBookArchiveRows } from "../../../novel-plugin/src/engine/book-archive";

const owner = { sub: `archive-owner-${crypto.randomUUID()}`, role: "user" as const };
const outsider = { sub: `archive-outsider-${crypto.randomUUID()}`, role: "user" as const };
const createdBooks: string[] = [];

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) throw new Error("missing product mounts");
	app.use("*", async (c, next) => { c.set("user", user as never); await next(); });
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

async function json<T>(response: Response): Promise<T> {
	return await response.json() as T;
}

let sourceBookId = "";
let archiveBytes: ArrayBuffer = new ArrayBuffer(0);

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	const app = productApp(owner);
	const create = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `archive-source-${crypto.randomUUID()}` },
		body: JSON.stringify({ title: "档案往返" }),
	});
	const operation = await json<{ bookId: string; state: string }>(create);
	expect(operation.state).toBe("ready");
	sourceBookId = operation.bookId;
	createdBooks.push(sourceBookId);
	const base = `/api/books/${encodeURIComponent(sourceBookId)}`;
	for (const title of ["山门", "夜雨"]) {
		const created = await app.request(`${base}/workspace/chapters`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
		expect(created.status).toBe(201);
	}
	await app.request(`${base}/chapters/1`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "# 第1章 山门\n\n林远走上青石台阶。\n" }) });
	await app.request(`${base}/chapters/2`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "# 第2章 夜雨\n\n苏晚把铜钱按在林远掌心。\n" }) });
	const entry = await json<{ entry: { id: string } }>(await app.request(`${base}/jingwei/entries`, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ category: "characters", title: "林远", contentMd: "药童出身。" }),
	}));
	const storyline = await json<{ data: { id: string } }>(await app.request(`${base}/narrative-memory/storylines`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "铜钱之约", kind: "main", entryId: entry.entry.id }),
	}));
	const scene = await json<{ data: { id: string } }>(await app.request(`${base}/narrative-memory/scenes`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapterNumber: 2, title: "经楼夜访" }),
	}));
	const mount = await app.request(`${base}/narrative-memory/scenes/${encodeURIComponent(scene.data.id)}/mounts`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storylineId: storyline.data.id, role: "primary" }),
	});
	expect(mount.status).toBe(200);
});

afterAll(async () => {
	const app = productApp(owner);
	for (const bookId of createdBooks) {
		try {
			await app.request(`/api/novelfork/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
		} catch {
			// 清理尽力而为。
		}
	}
});

describe("项目档案产品路由", () => {
	test("模块清单可读", async () => {
		const body = await json<{ modules: Array<{ id: string; label: string }> }>(await productApp(owner).request("/api/novelfork/book-archives/modules"));
		expect(body.modules.map((module) => module.id)).toEqual(["chapters", "jingwei", "narrative", "workflow", "style", "skills", "references"]);
	});

	test("导出经书籍守卫：别人的书导不出", async () => {
		const denied = await productApp(outsider).request(`/api/books/${encodeURIComponent(sourceBookId)}/archive`);
		expect(denied.status).toBeGreaterThanOrEqual(400);
		expect(denied.headers.get("content-type") ?? "").not.toContain("application/zip");
	});

	test("导出为 zip，导入为新书后可继续写：正文、经纬、场景挂载一致且完成 Runtime 绑定", async () => {
		const app = productApp(owner);
		const exported = await app.request(`/api/books/${encodeURIComponent(sourceBookId)}/archive`);
		expect(exported.status).toBe(200);
		expect(exported.headers.get("content-type")).toBe("application/zip");
		expect(exported.headers.get("content-disposition")).toContain("filename*=UTF-8''");
		archiveBytes = await exported.arrayBuffer();
		expect(archiveBytes.byteLength).toBeGreaterThan(100);

		const imported = await app.request("/api/novelfork/book-archives/import", {
			method: "POST",
			headers: { "content-type": "application/zip", "Idempotency-Key": `archive-import-${crypto.randomUUID()}` },
			body: archiveBytes,
		});
		const body = await json<{ operation: { bookId: string; state: string; narratorId: string | null }; report: { bookId: string; items: Array<{ severity: string; explanation: string }>; idRemap: { bookId: { from: string; to: string } } } }>(imported);
		expect(imported.status).toBe(201);
		expect(body.operation.state).toBe("ready");
		expect(body.operation.narratorId).toBeTruthy();
		const newBookId = body.operation.bookId;
		createdBooks.push(newBookId);
		expect(newBookId).not.toBe(sourceBookId);
		expect(body.report.idRemap.bookId).toEqual({ from: sourceBookId, to: newBookId });
		expect(body.report.items.every((item) => item.explanation.length > 5)).toBe(true);

		// 新书出现在作品列表里，章节可读、可继续写。
		const books = await json<{ books: Array<{ id: string }> }>(await app.request("/api/novelfork/books"));
		expect(books.books.map((book) => book.id)).toContain(newBookId);
		const chapter = await json<{ content: string }>(await app.request(`/api/books/${encodeURIComponent(newBookId)}/chapters/2`));
		expect(chapter.content).toContain("铜钱");
		const saved = await app.request(`/api/books/${encodeURIComponent(newBookId)}/chapters/2`, {
			method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "# 第2章 夜雨\n\n苏晚把铜钱按在林远掌心。后山见。\n" }),
		});
		expect(saved.status).toBe(200);
		const created = await app.request(`/api/books/${encodeURIComponent(newBookId)}/workspace/chapters`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "后山" }) });
		expect(created.status).toBe(201);

		const structure = await json<{ scenes: Array<{ id: string; title: string }>; storylines: Array<{ id: string; entryId?: string | null }>; mounts: Array<{ sceneId: string; storylineId: string }> }>(
			await app.request(`/api/books/${encodeURIComponent(newBookId)}/narrative-structure`),
		);
		expect(structure.scenes.map((scene) => scene.title)).toEqual(["经楼夜访"]);
		expect(structure.mounts).toEqual([expect.objectContaining({ sceneId: structure.scenes[0]!.id, storylineId: structure.storylines[0]!.id })]);
		const entries = await json<{ entries: Array<{ id: string; title: string }> }>(await app.request(`/api/books/${encodeURIComponent(newBookId)}/jingwei/entries`));
		const newEntry = entries.entries.find((entry) => entry.title === "林远");
		expect(newEntry).toBeTruthy();
		expect(structure.storylines[0]!.entryId).toBe(newEntry!.id);

		// 源书的数据与新书行数一致（新书多出的只有刚才新写的日志）。
		const storage = getNovelStorage();
		const sourceCounts = countBookArchiveRows(storage, sourceBookId);
		const newCounts = countBookArchiveRows(storage, newBookId);
		for (const table of ["story_jingwei_entry", "story_jingwei_section", "narrative_scene", "narrative_storyline", "narrative_scene_storyline"]) {
			expect(newCounts[table], table).toBe(sourceCounts[table]);
		}

		// 受控书籍目录里不留导入暂存目录。
		const leftovers = (await readdir(getControlledBooksRoot())).filter((name) => name.startsWith(".archive-import-"));
		expect(leftovers).toEqual([]);
		const bookJson = JSON.parse(await readFile(join(getControlledBooksRoot(), newBookId, "book.json"), "utf8")) as { id: string; title: string };
		expect(bookJson).toMatchObject({ id: newBookId, title: "档案往返" });
	});

	test("坏档案、非法模块、缺少幂等键都被拒绝且不建书", async () => {
		const app = productApp(owner);
		const before = (await json<{ books: unknown[] }>(await app.request("/api/novelfork/books"))).books.length;
		const garbage = await app.request("/api/novelfork/book-archives/import", {
			method: "POST", headers: { "content-type": "application/zip", "Idempotency-Key": `bad-${crypto.randomUUID()}` }, body: new TextEncoder().encode("not a zip at all, sorry"),
		});
		expect(garbage.status).toBe(400);
		expect(await json<{ error: string; explanation: string }>(garbage)).toMatchObject({ error: "zip-not-zip", explanation: expect.stringContaining("zip") });
		const badModule = await app.request("/api/novelfork/book-archives/import?modules=chapters,everything", {
			method: "POST", headers: { "content-type": "application/zip", "Idempotency-Key": `bad-${crypto.randomUUID()}` }, body: archiveBytes,
		});
		expect(badModule.status).toBe(400);
		expect((await json<{ error: string }>(badModule)).error).toBe("invalid-modules");
		const noKey = await app.request("/api/novelfork/book-archives/import", { method: "POST", headers: { "content-type": "application/zip" }, body: archiveBytes });
		expect(noKey.status).toBe(400);
		const after = (await json<{ books: unknown[] }>(await app.request("/api/novelfork/books"))).books.length;
		expect(after).toBe(before);
	});
});
