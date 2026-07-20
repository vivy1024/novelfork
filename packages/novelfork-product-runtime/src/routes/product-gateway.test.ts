import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

const owner = { sub: `gateway-owner-${crypto.randomUUID()}`, role: "user" as const };
const outsider = { sub: `gateway-outsider-${crypto.randomUUID()}`, role: "user" as const };
let externalBookRoot = "";
let bookId: string | null = null;

function productApp(user: typeof owner) {
	const app = new Hono();
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

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	externalBookRoot = await mkdtemp(join(tmpdir(), "novelfork-existing-workspace-"));
	await mkdir(join(externalBookRoot, "jingwei"), { recursive: true });
	await writeFile(join(externalBookRoot, "source-marker.md"), "keep this source file intact\n", "utf8");
	await writeFile(join(externalBookRoot, "jingwei", "source-material.md"), "# 已有经纬资料\n\n必须从外部 workspace 读取。\n", "utf8");
});

afterAll(async () => {
	if (bookId) {
		try {
			await productApp(owner).request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		} catch {
			// Best-effort fixture cleanup.
		}
	}
	await rm(externalBookRoot, { recursive: true, force: true });
});

describe("NovelFork trusted narrator binding gateway", () => {
	test("binds an existing workspace through the product gateway without overwriting source files", async () => {
		const app = productApp(owner);
		const create = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: { "content-type": "application/json", "Idempotency-Key": `external-workspace-${crypto.randomUUID()}` },
			body: JSON.stringify({ title: "External workspace novel", projectInit: { source: "existing", workspaceRoot: externalBookRoot, managedByNovelFork: false } }),
		});
		const operation = await create.json() as { bookId?: string; narratorId?: string; state?: string; errorMessage?: string | null };
		expect({ status: create.status, operation }).toMatchObject({ status: 201, operation: { state: "ready", errorMessage: null } });
		if (!operation.bookId || !operation.narratorId) throw new Error("product gateway did not create a trusted binding");
		bookId = operation.bookId;

		const config = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as { id?: string; novelforkExternalWorkspace?: boolean };
		expect(config).toMatchObject({ id: bookId, novelforkExternalWorkspace: true });
		expect(await readFile(join(externalBookRoot, "source-marker.md"), "utf8")).toBe("keep this source file intact\n");

		const narrators = await app.request(`/api/books/${bookId}/narrators`);
		expect(narrators.status).toBe(200);
		expect(await narrators.json()).toMatchObject({ narrators: [expect.objectContaining({ id: operation.narratorId, bookId, cwd: externalBookRoot })] });
		const workspace = await app.request(`/api/books/${bookId}/workspace`);
		expect(workspace.status).toBe(200);
		expect(await workspace.json()).toMatchObject({ resources: expect.arrayContaining([expect.objectContaining({ path: "jingwei/source-material.md", content: "# 已有经纬资料\n\n必须从外部 workspace 读取。\n" })]) });
	});

	test("exposes the trusted workspace tree without permitting path escape and hides it from other users", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		await mkdir(join(externalBookRoot, "chapters"), { recursive: true });
		await writeFile(join(externalBookRoot, "chapters", "0001_设备故障.md"), "# 第 1 章\n", "utf8");
		const tree = await app.request(`/api/books/${bookId}/files/tree?depth=8`);
		expect(tree.status).toBe(200);
		expect(await tree.json()).toMatchObject({ tree: expect.arrayContaining([expect.objectContaining({ name: "chapters", path: "chapters", type: "directory" })]) });
		const read = await app.request(`/api/books/${bookId}/files/read?path=${encodeURIComponent("chapters/0001_设备故障.md")}`);
		expect(await read.json()).toEqual({ path: "chapters/0001_设备故障.md", content: "# 第 1 章\n" });
		expect((await app.request(`/api/books/${bookId}/files/read?path=../outside.txt`)).status).toBe(400);
		expect((await productApp(outsider).request(`/api/novelfork/books/${bookId}`, { method: "DELETE" })).status).toBe(404);
		await access(externalBookRoot);
	});
});
