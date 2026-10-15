import { describe, expect, test } from "bun:test";
import {
	createBookRuntimeCapabilitiesRoutes,
	type BookRuntimeCapabilitiesRouteDeps,
} from "../routes/runtime-capabilities";
import { BOOK_GUARD_BYPASS_ROUTES, shouldBypassBookGuard } from "./book-guard-bypass";

const BOOK = "/api/books/b1";

/** 把 Hono 路由形状里的 `:param` 换成样例值。 */
function samplePath(routePath: string): string {
	return `${BOOK}${routePath.replace(/:[^/]+/gu, "sample-id")}`;
}

describe("书路由守卫放行清单（T-03：按「方法+路径」精确匹配）", () => {
	test("放行清单与 runtime-capabilities.ts 实际注册的路由逐条一致", () => {
		const routes = createBookRuntimeCapabilitiesRoutes({} as BookRuntimeCapabilitiesRouteDeps);
		const registered = routes.routes.map((route) => `${route.method} ${route.path}`).sort();
		expect(registered).toHaveLength(15);
		expect(BOOK_GUARD_BYPASS_ROUTES.map((route) => `${route.method} ${route.path}`).sort()).toEqual(registered);
		for (const route of routes.routes) {
			expect(shouldBypassBookGuard(samplePath(route.path), route.method), `${route.method} ${route.path}`).toBe(true);
		}
	});

	test("同一路径换成未注册的方法不放行", () => {
		for (const [path, method] of [
			["/hooks/h1", "POST"],
			["/hooks/h1", "GET"],
			["/hooks", "DELETE"],
			["/rules", "DELETE"],
			["/routines/r1", "POST"],
			["/skills", "PUT"],
			["/mcp", "PUT"],
			["/mcp/servers/s1", "GET"],
		] as const) {
			expect(shouldBypassBookGuard(`${BOOK}${path}`, method), `${method} ${path}`).toBe(false);
		}
	});

	test("novel-plugin 的 hooks/apply、hooks/generate 与新增的 hooks 子路由默认走归属守卫", () => {
		expect(shouldBypassBookGuard(`${BOOK}/hooks/apply`, "POST")).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/hooks/generate`, "POST")).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/hooks/some-new-action`, "POST")).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/hooks/h1/history`, "GET")).toBe(false);
	});

	test("mcp 只放行 /mcp 与 /mcp/servers/:serverId，不再允许任意深度", () => {
		expect(shouldBypassBookGuard(`${BOOK}/mcp`, "GET")).toBe(true);
		expect(shouldBypassBookGuard(`${BOOK}/mcp/servers/s1`, "PUT")).toBe(true);
		expect(shouldBypassBookGuard(`${BOOK}/mcp/servers`, "PUT")).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/mcp/servers/s1/tools`, "PUT")).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/mcp/a/b/c`, "GET")).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/mcp/s1`, "PUT")).toBe(false);
	});

	test("没有传入方法时一律不放行（fail-closed）", () => {
		expect(shouldBypassBookGuard(`${BOOK}/skills`)).toBe(false);
		expect(shouldBypassBookGuard(`${BOOK}/hooks/h1`)).toBe(false);
	});

	test("方法大小写不敏感；HEAD 与 GET 同路由（Hono 用 GET 处理 HEAD）", () => {
		expect(shouldBypassBookGuard(`${BOOK}/skills`, "get")).toBe(true);
		expect(shouldBypassBookGuard(`${BOOK}/skills`, "HEAD")).toBe(true);
		expect(shouldBypassBookGuard(`${BOOK}/rules`, "HEAD")).toBe(true);
	});

	test("不在清单里的书路由、相似前缀与结尾斜杠都照常经过守卫", () => {
		for (const path of [
			`${BOOK}/chapters`,
			`${BOOK}/jingwei/sections`,
			`${BOOK}/workflow-runs`,
			BOOK,
			`${BOOK}/hooksevil`,
			`${BOOK}/skillsx/foo`,
			`${BOOK}/skills/`,
			"/api/books//skills",
		]) {
			expect(shouldBypassBookGuard(path, "GET"), path).toBe(false);
		}
	});
});
