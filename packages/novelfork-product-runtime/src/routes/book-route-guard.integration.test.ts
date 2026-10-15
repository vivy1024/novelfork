import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

/**
 * T-03 HTTP 层：书路由守卫的放行清单只覆盖 Runtime 能力路由（它们自己做书归属校验）。
 * 其余书路由（含 novel-plugin 的 hooks/apply、hooks/generate）必须经过外层归属守卫：
 * 用户 B 不能读写用户 A 的书。
 */
const userA = { sub: `guard-a-${crypto.randomUUID()}`, role: "user" as const };
const userB = { sub: `guard-b-${crypto.randomUUID()}`, role: "user" as const };
const ORIGINAL_HOOKS = "# 待处理钩子\n\nA 自己写下的内容。\n";

function productApp(user: typeof userA) {
	const app = new Hono<{ Variables: { user: typeof userA } }>();
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

function json(method: string, body: unknown): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

let bookId = "";
let pendingHooksPath = "";

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	const create = await productApp(userA).request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `guard-${crypto.randomUUID()}` },
		body: JSON.stringify({ title: "A 的书" }),
	});
	const created = (await create.json()) as { bookId?: string; state?: string };
	expect({ status: create.status, state: created.state }).toMatchObject({ status: 201, state: "ready" });
	if (!created.bookId) throw new Error("book was not created");
	bookId = created.bookId;
	const booksRoot = process.env.NOVELFORK_BOOKS_ROOT;
	if (!booksRoot) throw new Error("test-env must set NOVELFORK_BOOKS_ROOT");
	pendingHooksPath = join(booksRoot, bookId, "story", "pending_hooks.md");
	await mkdir(join(booksRoot, bookId, "story"), { recursive: true });
	await writeFile(pendingHooksPath, ORIGINAL_HOOKS, "utf8");
});

describe("书路由守卫：用户 B 不能动用户 A 的书", () => {
	test("B 调 A 的 hooks/apply 与 hooks/generate 被拒，A 的 pending_hooks.md 不变", async () => {
		const b = productApp(userB);
		const apply = await b.request(
			`/api/books/${bookId}/hooks/apply`,
			json("POST", { chapterNumber: 1, hook: { id: "b-injected", text: "B 注入的钩子" } }),
		);
		expect(apply.status).toBe(404);
		const generate = await b.request(`/api/books/${bookId}/hooks/generate`, json("POST", { chapterNumber: 1, chapterContent: "正文" }));
		expect(generate.status).toBe(404);
		const unknownHookAction = await b.request(`/api/books/${bookId}/hooks/some-new-action`, json("POST", {}));
		expect(unknownHookAction.status).toBe(404);
		expect(await readFile(pendingHooksPath, "utf8")).toBe(ORIGINAL_HOOKS);
	});

	test("B 访问 A 的 Runtime 能力路由同样被拒", async () => {
		const b = productApp(userB);
		const attempts: Array<[string, string, unknown?]> = [
			["GET", "/skills"],
			["GET", "/skills/any-skill"],
			["POST", "/skills", { name: "b-skill", description: "x", content: "x" }],
			["GET", "/rules"],
			["PUT", "/rules", { content: "B 改的规则" }],
			["GET", "/hooks"],
			["PUT", "/hooks/h1", { enabled: false }],
			["DELETE", "/hooks/h1"],
			["GET", "/routines"],
			["PUT", "/routines/r1", { enabled: true }],
			["GET", "/mcp"],
			["PUT", "/mcp/servers/s1", { defaultBehavior: "deny" }],
		];
		for (const [method, path, body] of attempts) {
			const response = await b.request(
				`/api/books/${bookId}${path}`,
				body === undefined ? { method } : json(method, body),
			);
			// 404 来自归属校验（外层守卫或能力路由自己的 resolveAccess）；hooks 能力路由先查管理员，非管理员得 403。两者都是拒绝。
			expect({ request: `${method} ${path}`, rejected: [403, 404].includes(response.status) }).toEqual({
				request: `${method} ${path}`,
				rejected: true,
			});
		}
	});

	test("A 自己照常可用：能力路由可读，hooks/apply 能写入（证明上面的 404 来自归属校验而非路由不存在）", async () => {
		const a = productApp(userA);
		expect((await a.request(`/api/books/${bookId}/skills`)).status).toBe(200);
		const apply = await a.request(
			`/api/books/${bookId}/hooks/apply`,
			json("POST", { chapterNumber: 1, hook: { id: "a-own", text: "A 自己的钩子" } }),
		);
		expect({ status: apply.status, body: await apply.clone().text() }).toMatchObject({ status: 200 });
		const after = await readFile(pendingHooksPath, "utf8");
		expect(after.startsWith(ORIGINAL_HOOKS)).toBe(true);
		expect(after).toContain("A 自己的钩子");
	});
});
