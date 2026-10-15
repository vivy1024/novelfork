import { Hono, type Context } from "hono";
import { describe, expect, test } from "bun:test";

import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { ARCHIVE_IMPORT_BODY_LIMIT_BYTES, ARCHIVE_IMPORT_PATH } from "./body-limit";

/**
 * 请求体上限的挂载测试（T-11）：直接调用 index.ts 导出的 mountAuthenticatedGuards，
 * 测的是生产里真实的挂载，而不是手工复刻的前缀清单。守卫之后挂几个只读请求体的探针路由，
 * 用它们观察请求体有没有被上限拦下。
 */

const MiB = 1024 * 1024;

const PROBE_PATHS = [
	"/api/filter/scan",
	"/api/compliance/dictionaries/import",
	"/api/writing-skills/foo",
	"/api/writing-skills/import",
	"/api/market/scan",
	"/api/embedding",
	"/api/settings/zhuque",
	"/api/works/import",
	"/api/style/personal-profile",
	"/api/novelfork/books",
	ARCHIVE_IMPORT_PATH,
	"/api/books/b1/jingwei/entries",
	"/api/books/b1/style/distillations/preview",
	"/api/runtime/upload",
] as const;

function buildMountedApp(seen: string[] = []): Hono {
	const app = new Hono();
	// 生产里 Runtime 的会话鉴权先写入 user；书籍守卫要用到它。
	app.use("*", async (c, next) => {
		c.set("user" as never, { sub: "body-limit-admin", role: "admin" } as never);
		await next();
	});
	novelForkProductIntegration.mountAuthenticatedGuards?.(app as never);
	const probe = async (c: Context) => {
		const text = await c.req.text();
		seen.push(c.req.path);
		return c.json({ ok: true, bytes: text.length });
	};
	for (const path of PROBE_PATHS) app.post(path, probe);
	app.onError((error, c) =>
		error instanceof AppError
			? c.json({ code: error.code, error: error.message }, error.statusCode as never)
			: c.json({ error: String(error) }, 500),
	);
	return app;
}

function sized(path: string, bytes: number): Request {
	const body = "x".repeat(bytes);
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
		body,
	});
}

function chunked(path: string, totalBytes: number): Request {
	let sent = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent >= totalBytes) {
				controller.close();
				return;
			}
			const size = Math.min(256 * 1024, totalBytes - sent);
			controller.enqueue(new Uint8Array(size).fill(0x78));
			sent += size;
		},
	});
	return new Request(`http://localhost${path}`, { method: "POST", body, duplex: "half" } as RequestInit);
}

async function expectExplained413(response: Response) {
	expect(response.status).toBe(413);
	const body = (await response.json()) as { explanation?: { whatHappened?: string; whyItMatters?: string; suggestedAction?: string } };
	expect(body.explanation?.whatHappened).toBeTruthy();
	expect(body.explanation?.whyItMatters).toBeTruthy();
	expect(body.explanation?.suggestedAction).toBeTruthy();
}

describe("product body limit, as mounted by index.ts (T-11)", () => {
	for (const path of [
		"/api/filter/scan",
		"/api/compliance/dictionaries/import",
		"/api/writing-skills/foo",
		"/api/market/scan",
		"/api/embedding",
		"/api/settings/zhuque",
		"/api/style/personal-profile",
		"/api/novelfork/books",
		"/api/books/b1/jingwei/entries",
	]) {
		test(`limits ${path} to 2 MiB`, async () => {
			const seen: string[] = [];
			await expectExplained413(await buildMountedApp(seen).request(sized(path, 3 * MiB)));
			expect(seen).toEqual([]);
		});
	}

	test("lets 3 MiB through on the long-text entries (writing-skill import, style distillation)", async () => {
		const skills = await buildMountedApp().request(sized("/api/writing-skills/import", 3 * MiB));
		expect(skills.status).toBe(200);
		// 书籍路径随后还有书籍守卫（测试库里没有这本书），只要求不是被上限拦下的 413。
		const distill = await buildMountedApp().request(sized("/api/books/b1/style/distillations/preview", 3 * MiB));
		expect(distill.status).not.toBe(413);
	});

	test("still caps the long-text entries at 8 MiB", async () => {
		await expectExplained413(await buildMountedApp().request(sized("/api/works/import", 9 * MiB)));
	});

	test("limits chunked uploads without Content-Length the same way", async () => {
		const seen: string[] = [];
		const app = buildMountedApp(seen);
		await expectExplained413(await app.request(chunked("/api/filter/scan", 3 * MiB)));
		await expectExplained413(await app.request(chunked("/api/books/b1/jingwei/entries", 3 * MiB)));
		expect(seen).toEqual([]);
		const small = await app.request(chunked("/api/filter/scan", 64 * 1024));
		expect(small.status).toBe(200);
		expect(((await small.json()) as { bytes: number }).bytes).toBe(64 * 1024);
	});

	test("caps the archive import at 256 MiB instead of exempting it", async () => {
		const declared = new Request(`http://localhost${ARCHIVE_IMPORT_PATH}`, {
			method: "POST",
			headers: { "Content-Type": "application/zip", "Content-Length": String(ARCHIVE_IMPORT_BODY_LIMIT_BYTES + 1) },
			body: "x",
		});
		await expectExplained413(await buildMountedApp().request(declared));
		const ordinary = await buildMountedApp().request(sized(ARCHIVE_IMPORT_PATH, 9 * MiB));
		expect(ordinary.status).toBe(200);
	});

	test("does not cap a non-product Runtime route", async () => {
		const response = await buildMountedApp().request(sized("/api/runtime/upload", 9 * MiB));
		expect(response.status).toBe(200);
	});
});
