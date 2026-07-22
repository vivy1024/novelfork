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
let newExternalBookRoot = "";
let reboundBookRoot = "";
let bookId: string | null = null;
let newBookId: string | null = null;

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
	newExternalBookRoot = await mkdtemp(join(tmpdir(), "novelfork-new-workspace-"));
	reboundBookRoot = await mkdtemp(join(tmpdir(), "novelfork-rebound-workspace-"));
	await mkdir(join(externalBookRoot, "jingwei"), { recursive: true });
	await writeFile(join(externalBookRoot, "source-marker.md"), "keep this source file intact\n", "utf8");
	await writeFile(join(externalBookRoot, "jingwei", "source-material.md"), "# 已有经纬资料\n\n必须从外部 workspace 读取。\n", "utf8");
});

afterAll(async () => {
	for (const id of [bookId, newBookId]) {
		if (!id) continue;
		try {
			await productApp(owner).request(`/api/novelfork/books/${id}`, { method: "DELETE" });
		} catch {
			// Best-effort fixture cleanup.
		}
	}
	await rm(externalBookRoot, { recursive: true, force: true });
	await rm(newExternalBookRoot, { recursive: true, force: true });
	await rm(reboundBookRoot, { recursive: true, force: true });
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

	test("persists book-scoped writing settings without dropping external binding metadata", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		const app = productApp(owner);
		const current = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as Record<string, unknown>;
		await writeFile(join(externalBookRoot, "book.json"), JSON.stringify({
			...current,
			narrativeMemory: { preservedForWritingSettingsTest: true },
		}, null, 2), "utf8");

		const presetsResponse = await app.request(`/api/books/${bookId}/presets`);
		expect(presetsResponse.status).toBe(200);
		const presets = await presetsResponse.json() as { presets?: Array<{ id: string }> };
		const presetId = presets.presets?.[0]?.id;
		if (!presetId) throw new Error("expected a builtin preset");
		expect((await app.request(`/api/books/${bookId}/presets`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ enabledPresetIds: [presetId] }),
		})).status).toBe(200);

		const beatsResponse = await app.request(`/api/books/${bookId}/beat-templates`);
		expect(beatsResponse.status).toBe(200);
		const beats = await beatsResponse.json() as { templates?: Array<{ id: string }> };
		const beatTemplateId = beats.templates?.[0]?.id;
		if (!beatTemplateId) throw new Error("expected a builtin beat template");
		expect((await app.request(`/api/books/${bookId}/beat-template`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beatTemplateId }),
		})).status).toBe(200);

		const update = await app.request(`/api/books/${bookId}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: "External workspace novel updated",
				chapterWordCount: 3200,
				targetChapters: 180,
				arcTrackingMode: "rule",
				customSensitiveWords: "测试敏感词",
			}),
		});
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({
			book: {
				title: "External workspace novel updated",
				chapterWordCount: 3200,
				targetChapters: 180,
				arcTrackingMode: "rule",
			},
		});

		const saved = JSON.parse(await readFile(join(externalBookRoot, "book.json"), "utf8")) as Record<string, unknown>;
		expect(saved).toMatchObject({
			id: bookId,
			novelforkExternalWorkspace: true,
			enabledPresetIds: [presetId],
			beatTemplateId,
			narrativeMemory: { preservedForWritingSettingsTest: true },
			chapterWordCount: 3200,
		});
	});

	test("rebinds an existing book to a marked external workspace", async () => {
		if (!bookId) throw new Error("gateway fixture missing");
		await writeFile(
			join(reboundBookRoot, "book.json"),
			JSON.stringify({
				id: bookId,
				title: "Rebound external workspace novel",
				chapterWordCount: 2800,
				preservedExternalSetting: true,
			}, null, 2),
			"utf8",
		);

		const app = productApp(owner);
		const rebind = await app.request(`/api/novelfork/books/${bookId}/rebind-workspace`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ workspaceRoot: reboundBookRoot }),
		});
		expect(rebind.status).toBe(200);
		expect(await rebind.json()).toMatchObject({ bookId, bookRoot: reboundBookRoot });

		const saved = JSON.parse(await readFile(join(reboundBookRoot, "book.json"), "utf8")) as Record<string, unknown>;
		expect(saved).toMatchObject({
			id: bookId,
			title: "Rebound external workspace novel",
			novelforkExternalWorkspace: true,
			preservedExternalSetting: true,
		});
		const narrators = await app.request(`/api/books/${bookId}/narrators`);
		expect(await narrators.json()).toMatchObject({
			narrators: [expect.objectContaining({ bookId, cwd: reboundBookRoot })],
		});
	});

	test("creates a new workspace at the user-selected book_root instead of controlled books dir", async () => {
		const app = productApp(owner);
		const create = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"Idempotency-Key": `new-workspace-${crypto.randomUUID()}`,
			},
			body: JSON.stringify({
				title: "New external workspace novel",
				projectInit: {
					source: "new",
					workspaceRoot: newExternalBookRoot,
					managedByNovelFork: false,
				},
			}),
		});
		const operation = await create.json() as {
			bookId?: string;
			narratorId?: string;
			state?: string;
			errorMessage?: string | null;
		};
		expect({ status: create.status, operation }).toMatchObject({
			status: 201,
			operation: { state: "ready", errorMessage: null },
		});
		if (!operation.bookId || !operation.narratorId) {
			throw new Error("product gateway did not create a new external binding");
		}
		newBookId = operation.bookId;

		const config = JSON.parse(
			await readFile(join(newExternalBookRoot, "book.json"), "utf8"),
		) as { id?: string; novelforkExternalWorkspace?: boolean };
		expect(config).toMatchObject({
			id: operation.bookId,
			novelforkExternalWorkspace: true,
		});

		const narrators = await app.request(`/api/books/${operation.bookId}/narrators`);
		expect(narrators.status).toBe(200);
		expect(await narrators.json()).toMatchObject({
			narrators: [
				expect.objectContaining({
					id: operation.narratorId,
					bookId: operation.bookId,
					cwd: newExternalBookRoot,
				}),
			],
		});
	});
});
