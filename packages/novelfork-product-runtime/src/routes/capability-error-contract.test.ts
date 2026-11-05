import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Hono as ProductHono } from "hono";
import { createBookRuntimeCapabilitiesRoutes, type BookRuntimeCapabilitiesRouteDeps } from "./runtime-capabilities";

/**
 * S1.2 红测：Runtime 父应用（自己那份 hono 安装）挂载能力子应用（产品侧另一份 hono 安装）时，
 * 能力路由抛出的已知业务错误必须仍由父应用的 onError 转为 JSON，而不是被子应用的
 * 默认处理器吞成纯文本 500。
 *
 * 同版本组合测不出这个问题：只有父子两份 hono 不同，Hono.route() 才会包装子应用的
 * errorHandler，导致父应用 onError 收不到异常。
 */
const runtimeRequire = createRequire(resolve(import.meta.dir, "../../../narrafork-runtime-private/package.json"));
const { Hono: RuntimeHono } = runtimeRequire("hono") as { Hono: typeof ProductHono };

function notFoundDeps(): BookRuntimeCapabilitiesRouteDeps {
	const notFound = Object.assign(new Error("Book not found"), { statusCode: 404, code: "NOT_FOUND" });
	return {
		resolveAccess: async () => {
			throw notFound;
		},
	} as unknown as BookRuntimeCapabilitiesRouteDeps;
}

describe("capability sub-app error contract across Hono copies", () => {
	test("sanity: the two hono copies are separate module instances, so the test exercises the production shape", () => {
		// Runtime 0.9.11 起两侧版本号相同（4.12.14），但仍是两份独立安装：子应用的 Hono 类与父应用
		// 不是同一个构造器，Hono.route() 仍走跨副本包装路径。契约依赖的是「不同实例」，不是「不同版本」。
		const productEntry = realpathSync(createRequire(import.meta.url).resolve("hono"));
		const runtimeEntry = realpathSync(runtimeRequire.resolve("hono"));
		expect(productEntry).not.toBe(runtimeEntry);
		expect(RuntimeHono).not.toBe(ProductHono);
	});

	test("a known AppError from the capability sub-app keeps the parent JSON contract", async () => {
		const parent = new RuntimeHono();
		// 生产里 Runtime 的鉴权中间件先写入 user；不写的话路由取 user.sub 时就抛 TypeError，测不到错误契约。
		parent.use("*", async (c, next) => {
			(c as unknown as { set: (key: string, value: unknown) => void }).set("user", { sub: "u1", role: "user" });
			await next();
		});
		parent.onError((err, c) => {
			const e = err as Error & { statusCode?: number; code?: string };
			return c.json({ code: e.code }, (e.statusCode ?? 500) as 404);
		});
		parent.route("/api/books/:bookId", createBookRuntimeCapabilitiesRoutes(notFoundDeps()));

		const res = await parent.request("/api/books/b1/skills");

		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ code: "NOT_FOUND" });
	});
});
