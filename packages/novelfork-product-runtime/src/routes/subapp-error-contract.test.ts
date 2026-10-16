import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Hono as ProductHono } from "hono";
import { novelRuntimeBindingRoutes } from "./runtime-bindings";

/**
 * T-31 补充：Runtime 父应用（hono 4.13.13）挂载产品子应用（hono 4.12.14）时，子应用抛出的
 * 已知业务错误必须仍由父应用的 onError 序列化为 JSON，不能被子应用的默认处理器吞成纯文本 500。
 * capability-error-contract.test.ts 覆盖了能力子应用；这里覆盖其余产品子应用。
 * 同版本组合测不出这个问题，所以父应用必须用 Runtime 自己的 hono。
 */
const runtimeRequire = createRequire(resolve(import.meta.dir, "../../../narrafork-runtime-private/package.json"));
const { Hono: RuntimeHono } = runtimeRequire("hono") as { Hono: typeof ProductHono };

function parentWith(role: "admin" | "user") {
	const parent = new RuntimeHono();
	parent.use("*", async (c, next) => {
		(c as unknown as { set: (key: string, value: unknown) => void }).set("user", { sub: "u1", role });
		await next();
	});
	parent.onError((err, c) => {
		const e = err as Error & { statusCode?: number; code?: string };
		return c.json({ code: e.code }, (e.statusCode ?? 500) as 400);
	});
	return parent;
}

describe("产品子应用的业务错误跨 Hono 副本仍由父应用序列化（T-31）", () => {
	test("runtime-bindings：管理员缺少 projectId 时抛 ValidationError，应得到 400 JSON 而不是纯文本 500", async () => {
		const parent = parentWith("admin");
		parent.route("/api/novel/runtime-bindings", novelRuntimeBindingRoutes as never);

		const res = await parent.request("/api/novel/runtime-bindings");

		expect(res.status).toBe(400);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ code: "VALIDATION_ERROR" });
	});

	test("runtime-bindings：非管理员被 requireAdmin 拒绝时，也应走父应用的 JSON 契约", async () => {
		const parent = parentWith("user");
		parent.route("/api/novel/runtime-bindings", novelRuntimeBindingRoutes as never);

		const res = await parent.request("/api/novel/runtime-bindings?projectId=p1");

		expect(res.headers.get("content-type")).toContain("application/json");
		expect([401, 403]).toContain(res.status);
	});
});
