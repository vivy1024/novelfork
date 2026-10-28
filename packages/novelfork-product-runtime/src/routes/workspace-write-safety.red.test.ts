import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

// 红测：产品层写盘安全。
// 1. IDE 文件网关「新建 / 复制粘贴」以 create 意图写入时，目标已存在必须拒绝（409 + 三段式说明），原内容不变；
//    编辑器保存（不带意图，默认 overwrite）保持覆盖语义。
// 2. book.json 的多个写入方（章节保存的时间戳、书籍设置、叙事记忆配置）并发时不得互相冲掉字段。

const owner = { sub: `write-safety-owner-${crypto.randomUUID()}`, role: "user" as const };
let bookRoot = "";
let bookId: string | null = null;

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
		throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
	}
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

function putFile(app: ReturnType<typeof productApp>, body: Record<string, unknown>) {
	return app.request(`/api/books/${bookId}/files`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	bookRoot = await mkdtemp(join(tmpdir(), "novelfork-write-safety-"));
	const app = productApp(owner);
	const create = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `write-safety-${crypto.randomUUID()}` },
		body: JSON.stringify({
			title: "写盘安全测试书",
			projectInit: { source: "existing", workspaceRoot: bookRoot, managedByNovelFork: false },
		}),
	});
	const operation = (await create.json()) as { bookId?: string; state?: string };
	if (create.status !== 201 || !operation.bookId) throw new Error(`fixture did not create a book: ${create.status}`);
	bookId = operation.bookId;
});

afterAll(async () => {
	if (bookId) {
		try {
			await productApp(owner).request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		} catch {
			// Best-effort fixture cleanup.
		}
	}
	await rm(bookRoot, { recursive: true, force: true });
});

describe("IDE 文件网关的新建意图", () => {
	test("create 遇到已存在的文件被拒，原内容不变，错误带三段式说明", async () => {
		const app = productApp(owner);
		await mkdir(join(bookRoot, "story"), { recursive: true });
		await writeFile(join(bookRoot, "story", "existing-note.md"), "作者已有的设定\n", "utf8");

		const refused = await putFile(app, { path: "story/existing-note.md", content: "", mode: "create" });
		expect(refused.status).toBe(409);
		const payload = (await refused.json()) as { code?: string; error?: string };
		expect(payload.code).toBe("WORKSPACE_PATH_EXISTS");
		expect(payload.error).toContain("发生了什么");
		expect(payload.error).toContain("为什么要看");
		expect(payload.error).toContain("建议怎么做");
		expect(await readFile(join(bookRoot, "story", "existing-note.md"), "utf8")).toBe("作者已有的设定\n");
	});

	test("create 新文件成功", async () => {
		const app = productApp(owner);
		const created = await putFile(app, { path: "notes/brand-new.md", content: "# 新文件\n", mode: "create" });
		expect(created.status).toBe(200);
		expect(await readFile(join(bookRoot, "notes", "brand-new.md"), "utf8")).toBe("# 新文件\n");
	});

	test("overwrite（含不带意图的编辑器保存）照常覆盖", async () => {
		const app = productApp(owner);
		await putFile(app, { path: "notes/save-target.md", content: "第一版\n", mode: "create" });
		const explicit = await putFile(app, { path: "notes/save-target.md", content: "第二版\n", mode: "overwrite" });
		expect(explicit.status).toBe(200);
		expect(await readFile(join(bookRoot, "notes", "save-target.md"), "utf8")).toBe("第二版\n");
		const legacy = await putFile(app, { path: "notes/save-target.md", content: "第三版\n" });
		expect(legacy.status).toBe(200);
		expect(await readFile(join(bookRoot, "notes", "save-target.md"), "utf8")).toBe("第三版\n");
	});

	test("未知的写入意图被拒", async () => {
		const app = productApp(owner);
		const bad = await putFile(app, { path: "notes/x.md", content: "x", mode: "append" });
		expect(bad.status).toBe(400);
	});
});

describe("book.json 并发写入不丢字段", () => {
	test("章节保存、书籍设置、叙事记忆配置并发写入后，各自改的字段都在", async () => {
		const app = productApp(owner);
		const chapter = await app.request(`/api/books/${bookId}/chapters`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "第一章" }),
		});
		const chapterBody = await chapter.text();
		expect({ status: chapter.status, body: chapterBody }).toMatchObject({ status: 201 });

		for (let round = 0; round < 4; round += 1) {
			const wordCount = 3100 + round;
			const maxTokens = 20000 + round;
			const results = await Promise.all([
				app.request(`/api/books/${bookId}/chapters/1`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ content: `# 第一章\n\n第 ${round} 轮正文。\n` }),
				}),
				app.request(`/api/books/${bookId}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chapterWordCount: wordCount }),
				}),
				app.request(`/api/books/${bookId}/narrative-memory/config`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ config: { retrieval: { maxTokens } } }),
				}),
			]);
			const outcomes = await Promise.all(
				results.map(async (response) => ({ status: response.status, body: response.status === 200 ? "" : await response.text() })),
			);
			expect(outcomes).toEqual([
				{ status: 200, body: "" },
				{ status: 200, body: "" },
				{ status: 200, body: "" },
			]);

			const saved = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as {
				chapterWordCount?: number;
				narrativeMemory?: { retrieval?: { maxTokens?: number } };
			};
			expect({ round, chapterWordCount: saved.chapterWordCount, maxTokens: saved.narrativeMemory?.retrieval?.maxTokens })
				.toEqual({ round, chapterWordCount: wordCount, maxTokens });
		}
	});
});
