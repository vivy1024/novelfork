import { beforeAll, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Hono as ProductHono } from "hono";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import {
	bookDomainRoutes,
	bookNarratorGatewayRoutes,
	bookWorkspaceRoutes,
	novelForkProductBooksRoutes,
} from "./books";

/**
 * books.ts 的子应用挂到 Runtime 父应用（另一份 hono 副本）下时，400/404 仍须是父应用 onError
 * 产出的 JSON，而不是被子应用的默认处理器吞成纯文本 500（与 capability-error-contract.test.ts 同理）。
 */
const runtimeRequire = createRequire(resolve(import.meta.dir, "../../../narrafork-runtime-private/package.json"));
const { Hono: RuntimeHono } = runtimeRequire("hono") as { Hono: typeof ProductHono };

function runtimeParent() {
	const parent = new RuntimeHono();
	parent.use("*", async (c, next) => {
		(c as unknown as { set: (key: string, value: unknown) => void }).set("user", { sub: `books-contract-${crypto.randomUUID()}`, role: "user" });
		await next();
	});
	parent.onError((err, c) => {
		const e = err as Error & { statusCode?: number; code?: string };
		return c.json({ code: e.code ?? "INTERNAL_ERROR", error: e.message }, (e.statusCode ?? 500) as 400);
	});
	parent.route("/api/novelfork", novelForkProductBooksRoutes);
	parent.route("/api/books/:bookId", bookDomainRoutes);
	parent.route("/api/books/:bookId/workspace", bookWorkspaceRoutes);
	parent.route("/api/books/:bookId/narrators", bookNarratorGatewayRoutes);
	return parent;
}

function jsonRequest(method: string, body: unknown): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

describe("books 路由在 Runtime 父应用下的错误契约", () => {
	test.each([
		["POST /api/novelfork/books（缺标题）", "/api/novelfork/books", jsonRequest("POST", {}), 400, "VALIDATION_ERROR"],
		["DELETE /api/novelfork/books/不存在的书", "/api/novelfork/books/no-such-book", { method: "DELETE" }, 404, "NOT_FOUND"],
		["PUT /api/books/:bookId（空设置）", "/api/books/b1", jsonRequest("PUT", {}), 400, "VALIDATION_ERROR"],
		["POST /api/books/:bookId/workspace/chapters（标题类型错）", "/api/books/b1/workspace/chapters", jsonRequest("POST", { title: 5 }), 400, "VALIDATION_ERROR"],
		["POST /api/books/:bookId/narrators（缺标题）", "/api/books/b1/narrators", jsonRequest("POST", {}), 400, "VALIDATION_ERROR"],
	] as const)("%s 仍是 JSON 错误", async (_label, path, init, status, code) => {
		const response = await runtimeParent().request(path, init);
		expect(response.status).toBe(status);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toMatchObject({ code });
	});
});
