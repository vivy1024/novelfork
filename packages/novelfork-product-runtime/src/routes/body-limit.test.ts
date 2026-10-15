import { Hono } from "hono";
import { describe, expect, test } from "bun:test";

import {
	ARCHIVE_IMPORT_BODY_LIMIT_BYTES,
	ARCHIVE_IMPORT_PATH,
	LONG_TEXT_BODY_LIMIT_BYTES,
	PRODUCT_BODY_LIMIT_BYTES,
	productBodyLimit,
	resolveProductBodyLimit,
} from "./body-limit";
import { MAX_BOOK_ARCHIVE_UPLOAD_BYTES } from "../../../novel-plugin/src/routes/book-archive";
import { MAX_STYLE_DISTILLATION_CHARS } from "../../../novel-plugin/src/engine/writing-layers/style-distillation";

const MiB = 1024 * 1024;

function buildApp(seen: string[] = []): Hono {
	const app = new Hono();
	app.use("*", productBodyLimit());
	const echo = async (c: import("hono").Context) => {
		const text = await c.req.text();
		seen.push(c.req.path);
		return c.json({ ok: true, bytes: text.length });
	};
	app.post("/api/novelfork/books", echo);
	app.put("/api/books/:bookId/chapters/:chapterId", echo);
	app.post("/api/books/:bookId/style/distillations/preview", echo);
	app.post("/api/filter/scan", echo);
	app.post(ARCHIVE_IMPORT_PATH, echo);
	app.post("/api/runtime/upload", echo);
	return app;
}

function bigJson(bytes: number): string {
	return JSON.stringify({ text: "x".repeat(bytes) });
}

/** 分块上传：ReadableStream 请求体，不带 Content-Length。 */
function chunkedBody(totalBytes: number, chunkBytes = 256 * 1024): ReadableStream<Uint8Array> {
	let sent = 0;
	return new ReadableStream({
		pull(controller) {
			if (sent >= totalBytes) {
				controller.close();
				return;
			}
			const size = Math.min(chunkBytes, totalBytes - sent);
			controller.enqueue(new Uint8Array(size).fill(0x78));
			sent += size;
		},
	});
}

function chunkedRequest(path: string, totalBytes: number): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		body: chunkedBody(totalBytes),
		duplex: "half",
	} as RequestInit);
}

type Explained = { code?: string; explanation?: { whatHappened?: string; whyItMatters?: string; suggestedAction?: string } };

async function expectExplained413(response: Response) {
	expect(response.status).toBe(413);
	const body = (await response.json()) as Explained;
	expect(body.code).toBe("PAYLOAD_TOO_LARGE");
	expect(body.explanation?.whatHappened).toBeTruthy();
	expect(body.explanation?.whyItMatters).toBeTruthy();
	expect(body.explanation?.suggestedAction).toBeTruthy();
}

describe("product body limit policy (T-11)", () => {
	test("defaults to 2 MiB on product routes", () => {
		expect(PRODUCT_BODY_LIMIT_BYTES).toBe(2 * MiB);
		for (const path of [
			"/api/novelfork/books",
			"/api/books/b1/chapters/c1",
			"/api/books/b1",
			"/api/novel/runtime-bindings",
			"/api/plugins/bundled/narrator-team/install",
			"/api/product/admin/users/u1/force",
			"/api/filter/scan",
			"/api/compliance/dictionaries/import",
			"/api/writing-skills/foo",
			"/api/market/lexicon",
			"/api/embedding",
			"/api/settings/zhuque",
			"/api/works/import-preview",
			"/api/style/personal-profile",
		]) {
			expect(resolveProductBodyLimit(path)).toBe(PRODUCT_BODY_LIMIT_BYTES);
		}
	});

	test("raises long-text entries to 8 MiB", () => {
		expect(LONG_TEXT_BODY_LIMIT_BYTES).toBe(8 * MiB);
		for (const path of [
			"/api/books/b1/style/distillations/preview",
			"/api/books/b1/style/distillations/jobs",
			"/api/books/b1/style/distill",
			"/api/books/b1/jingwei/import",
			"/api/writing-skills/import",
			"/api/works/import",
		]) {
			expect(resolveProductBodyLimit(path)).toBe(LONG_TEXT_BODY_LIMIT_BYTES);
		}
		// 文风蒸馏最多 100 万字：UTF-8 下中文每字 3 字节，加上 JSON 包装仍在 8 MiB 之内。
		expect(LONG_TEXT_BODY_LIMIT_BYTES).toBeGreaterThan(MAX_STYLE_DISTILLATION_CHARS * 3 + 64 * 1024);
	});

	test("caps the archive import at its own 256 MiB limit instead of exempting it", () => {
		expect(resolveProductBodyLimit(ARCHIVE_IMPORT_PATH)).toBe(ARCHIVE_IMPORT_BODY_LIMIT_BYTES);
		expect(ARCHIVE_IMPORT_BODY_LIMIT_BYTES).toBe(MAX_BOOK_ARCHIVE_UPLOAD_BYTES);
		expect(ARCHIVE_IMPORT_PATH).toBe("/api/novelfork/book-archives/import");
	});

	test("leaves Runtime routes and look-alike prefixes alone", () => {
		for (const path of [
			"/api/runtime/upload",
			"/api/uploads",
			"/api/settings",
			"/api/settings/general",
			"/api/settings/zhuquex",
			"/api/novelforkx",
			"/api/marketplace",
			"/api/chat",
			"/assets/app.js",
		]) {
			expect(resolveProductBodyLimit(path)).toBeNull();
		}
	});

	test("covers every route the product actually mounts (no prefix left unlimited)", async () => {
		const { novelDomainRoutes } = await import("./domain");
		const { adminUserCleanupRoutes } = await import("./admin-user-cleanup");
		const paths = [...novelDomainRoutes.routes, ...adminUserCleanupRoutes.routes]
			.map((route) => route.path.replace(/:[^/]+/g, "x").replace(/\*$/, ""));
		const uncovered = paths.filter((path) => resolveProductBodyLimit(path) === null);
		expect(uncovered).toEqual([]);
	});
});

describe("product body limit middleware (T-11)", () => {
	test("rejects an oversized JSON body on a product route with an explained 413", async () => {
		const response = await buildApp().request("/api/novelfork/books", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Content-Length": String(PRODUCT_BODY_LIMIT_BYTES + 1) },
			body: bigJson(PRODUCT_BODY_LIMIT_BYTES + 1),
		});
		await expectExplained413(response);
	});

	test("still accepts an ordinary small JSON body", async () => {
		const response = await buildApp().request("/api/novelfork/books", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "测试书" }),
		});
		expect(response.status).toBe(200);
	});

	test("accepts 3 MiB on a long-text entry but not on a default product route", async () => {
		const body = bigJson(3 * MiB);
		const headers = { "Content-Type": "application/json", "Content-Length": String(body.length) };
		const relaxed = await buildApp().request("/api/books/b1/style/distillations/preview", { method: "POST", headers, body });
		const normal = await buildApp().request("/api/books/b1/chapters/c1", { method: "PUT", headers, body });
		expect(relaxed.status).toBe(200);
		await expectExplained413(normal);
	});

	test("rejects a chunked upload (no Content-Length) over the limit before the handler sees it", async () => {
		const seen: string[] = [];
		const app = buildApp(seen);
		const response = await app.request(chunkedRequest("/api/filter/scan", 3 * MiB));
		await expectExplained413(response);
		expect(seen).toEqual([]);
	});

	test("passes a chunked upload under the limit through intact", async () => {
		const response = await buildApp().request(chunkedRequest("/api/filter/scan", MiB));
		expect(response.status).toBe(200);
		expect(((await response.json()) as { bytes: number }).bytes).toBe(MiB);
	});

	test("caps the archive import at 256 MiB but lets an ordinary archive through", async () => {
		const tooLarge = await buildApp().request(ARCHIVE_IMPORT_PATH, {
			method: "POST",
			headers: { "Content-Type": "application/zip", "Content-Length": String(ARCHIVE_IMPORT_BODY_LIMIT_BYTES + 1) },
			body: "x",
		});
		await expectExplained413(tooLarge);
		const body = bigJson(9 * MiB);
		const ordinary = await buildApp().request(ARCHIVE_IMPORT_PATH, {
			method: "POST",
			headers: { "Content-Type": "application/zip", "Content-Length": String(body.length) },
			body,
		});
		expect(ordinary.status).toBe(200);
	});

	test("does not touch non-product Runtime routes even when mounted on every path", async () => {
		const body = bigJson(9 * MiB);
		const response = await buildApp().request("/api/runtime/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
			body,
		});
		expect(response.status).toBe(200);
	});
});
