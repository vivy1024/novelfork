/**
 * 书路由守卫的放行清单（S1.2 / T-03）。
 *
 * 只有 Runtime 能力路由（`routes/runtime-capabilities.ts`）自己调用 `resolveAccess`
 * 完成书归属校验，才允许跳过外层守卫，以保留它们统一的 fail-closed 错误契约。
 * 清单按「方法 + 路径」逐条列出这些路由，与 runtime-capabilities.ts 实际注册的一一对应
 * （`book-guard-bypass.test.ts` 逐条核对）。不再按前缀放行某个命名空间、也不再用
 * 「排除 apply/generate」这类黑名单：novel-plugin 的 `hooks/apply`、`hooks/generate`
 * 以及以后新增的任何 hooks 子路由都不在清单里，默认走归属校验
 * （否则任何登录用户都能写入别人的书，隔离实例实测过 B 向 A 的书 hooks/apply 返回 200）。
 */
export const BOOK_GUARD_BYPASS_ROUTES: ReadonlyArray<{ readonly method: string; readonly path: string }> = [
	{ method: "GET", path: "/routines" },
	{ method: "PUT", path: "/routines/:routineId" },
	{ method: "GET", path: "/mcp" },
	{ method: "PUT", path: "/mcp/servers/:serverId" },
	{ method: "GET", path: "/skills" },
	{ method: "GET", path: "/skills/:name" },
	{ method: "POST", path: "/skills" },
	{ method: "PUT", path: "/skills/:name" },
	{ method: "DELETE", path: "/skills/:name" },
	{ method: "GET", path: "/rules" },
	{ method: "PUT", path: "/rules" },
	{ method: "GET", path: "/hooks" },
	{ method: "POST", path: "/hooks" },
	{ method: "PUT", path: "/hooks/:hookId" },
	{ method: "DELETE", path: "/hooks/:hookId" },
];

const COMPILED_ROUTES = BOOK_GUARD_BYPASS_ROUTES.map(({ method, path }) => ({
	method,
	pattern: new RegExp(
		`^/api/books/[^/]+${path
			.split("/")
			.map((segment) => (segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
			.join("/")}$`,
		"u",
	),
}));

/**
 * 是否跳过外层书归属守卫。必须同时给出请求方法；未给方法时无法精确匹配，一律不放行（fail-closed）。
 * HEAD 按 GET 处理，与 Hono 用 GET 路由响应 HEAD 的行为一致。
 */
export function shouldBypassBookGuard(path: string, method?: string): boolean {
	if (!method) return false;
	const normalizedMethod = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
	return COMPILED_ROUTES.some((route) => route.method === normalizedMethod && route.pattern.test(path));
}
