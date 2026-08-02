import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { inArray } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { Hono } from "hono";
import { AppError, chapters, db, narrators, projects } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { getNovelForkProductDatabase } from "../db/database";
import { bookRuntimeBindings } from "../db/schema";
import { getControlledBooksRoot } from "./book-binding";
import { isGeneralNarratorLifecycleMutation } from "./narrator-access";

const suffix = crypto.randomUUID();
const actor = { userId: `lifecycle-user-${suffix}`, role: "user" as const };
const bookId = `lifecycle-book-${suffix}`;
const projectId = `lifecycle-project-${suffix}`;
const chapterId = `lifecycle-chapter-${suffix}`;
const bookNarratorId = `lifecycle-book-narrator-${suffix}`;
const standaloneNarratorId = `lifecycle-standalone-narrator-${suffix}`;
const bookRoot = resolve(getControlledBooksRoot(), bookId);
const now = new Date().toISOString();

function protectedRouteApp() {
	const app = new Hono<{
		Variables: { user: { sub: string; role: "admin" | "user" } };
	}>();
	const { mountAuthenticatedGuards } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards) {
		throw new Error("NovelFork product integration did not provide authenticated guards");
	}
	app.use("*", async (c, next) => { c.set("user", { sub: actor.userId, role: actor.role } as never); await next(); });
	mountAuthenticatedGuards(app);
	app.all("/api/narrators/:id", (c) => c.json({ ok: true }));
	app.all("/api/narrators/:id/:operation", (c) => c.json({ ok: true }));
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	await mkdir(bookRoot, { recursive: true });
	await db.insert(projects).values({ id: projectId, name: "Lifecycle protection project", gitPath: bookRoot, createdAt: now, updatedAt: now });
	await db.insert(chapters).values({ id: chapterId, projectId, title: "Lifecycle protection chapter", branch: "main", baseBranch: "main", createdAt: now, updatedAt: now });
	await db.insert(narrators).values([
		{ id: bookNarratorId, chapterId, title: "Protected book narrator", type: "primary", inheritMode: "fresh", createdAt: now, updatedAt: now },
		{ id: standaloneNarratorId, chapterId: null, title: "Independent narrator", type: "primary", inheritMode: "fresh", createdAt: now, updatedAt: now },
	]);
	await getNovelForkProductDatabase().insert(bookRuntimeBindings).values({ id: `lifecycle-binding-${suffix}`, runtimeProjectId: projectId, bookId, bookRoot, createdByUserId: actor.userId, createdAt: now, updatedAt: now });
});

afterAll(async () => {
	await getNovelForkProductDatabase().delete(bookRuntimeBindings).where(inArray(bookRuntimeBindings.bookId, [bookId]));
	await db.delete(narrators).where(inArray(narrators.id, [bookNarratorId, standaloneNarratorId]));
	await db.delete(chapters).where(inArray(chapters.id, [chapterId]));
	await db.delete(projects).where(inArray(projects.id, [projectId]));
	await rm(bookRoot, { recursive: true, force: true });
});

describe("NovelFork book narrator lifecycle protection", () => {
	test("classifies all destructive general-session endpoints without blocking safe operations", () => {
		const id = "book-narrator";
		for (const [method, path] of [["PATCH", `/api/narrators/${id}/archive`], ["PATCH", `/api/narrators/${id}/unarchive`], ["PATCH", `/api/narrators/${id}/title`], ["POST", `/api/narrators/${id}/fork`], ["POST", `/api/narrators/${id}/fork-latest`], ["POST", `/api/narrators/${id}/fork-messages`], ["DELETE", `/api/narrators/${id}`]] as const) expect(isGeneralNarratorLifecycleMutation(method, path, id)).toBe(true);
		expect(isGeneralNarratorLifecycleMutation("GET", `/api/narrators/${id}`, id)).toBe(false);
		expect(isGeneralNarratorLifecycleMutation("PATCH", `/api/narrators/${id}/mark-read`, id)).toBe(false);
	});

	test("blocks every raw lifecycle mutation for a bound narrator but lets an ordinary narrator reach Runtime routes", async () => {
		const app = protectedRouteApp();
		for (const [method, path] of [["PATCH", `/api/narrators/${bookNarratorId}/archive`], ["PATCH", `/api/narrators/${bookNarratorId}/unarchive`], ["PATCH", `/api/narrators/${bookNarratorId}/title`], ["POST", `/api/narrators/${bookNarratorId}/fork`], ["POST", `/api/narrators/${bookNarratorId}/fork-latest`], ["POST", `/api/narrators/${bookNarratorId}/fork-messages`], ["DELETE", `/api/narrators/${bookNarratorId}`]] as const) {
			const response = await app.request(path, { method });
			expect(response.status, `${method} ${path}`).toBe(403);
			expect(await response.json()).toMatchObject({ code: "BOOK_NARRATOR_PROTECTED" });
		}
		expect((await app.request(`/api/narrators/${standaloneNarratorId}/archive`, { method: "PATCH" })).status).toBe(200);
	});
});
