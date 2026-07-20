import { ValidationError } from "@vivy1024/narrafork-runtime-bridge";
import { Hono } from "hono";
import { z } from "zod/v4";
import {
	getProductModelStatus,
	novelForkProductBookService,
	type ProductBookImportInput,
	type ProductBookInput,
} from "../services/book-provision";
import type { BoundNarratorActor } from "../services/narrator-access";
import { getProductBootstrapContract } from "../services/product-contract";

const bookInputSchema = z
	.object({
		bookId: z.string().trim().min(1).max(80).optional(),
		title: z.string().trim().min(1).max(200),
		genre: z.string().trim().max(100).optional(),
		language: z.enum(["zh", "en"]).optional(),
		platform: z.enum(["tomato", "feilu", "qidian", "other"]).optional(),
		projectInit: z.object({
			source: z.enum(["none", "new", "existing"]).optional(),
			repositorySource: z.enum(["none", "new", "existing"]).optional(),
			workspaceRoot: z.string().trim().min(1).max(2_000).optional(),
			managedByNovelFork: z.boolean().optional(),
		}).strict().optional(),
		chapterWordCount: z.number().int().min(500).max(100_000).optional(),
		targetChapters: z.number().int().min(1).max(100_000).optional(),
	})
	.strict();

const bookImportSchema = z
	.object({
		sourcePath: z.string().trim().min(1).max(2_000),
		bookId: z.string().trim().min(1).max(80).optional(),
	})
	.strict();

const workspaceResourceSaveSchema = z.object({ content: z.string().max(2_000_000) }).strict();
const workspaceChapterCreateSchema = z
	.object({ title: z.string().trim().min(1).max(200).optional() })
	.strict();
const workspaceFileWriteSchema = z.object({ path: z.string().trim().min(1).max(2_000), content: z.string().max(2_000_000) }).strict();
const workspacePathSchema = z.object({ path: z.string().trim().min(1).max(2_000) }).strict();
const workspaceRenameSchema = z.object({ from: z.string().trim().min(1).max(2_000), to: z.string().trim().min(1).max(2_000) }).strict();
const bookNarratorCreateSchema = z
	.object({ title: z.string().trim().min(1).max(200) })
	.strict();

function actor(c: {
	get: (key: "user") => { sub: string; role: "admin" | "user" };
}): BoundNarratorActor {
	const user = c.get("user");
	return { userId: user.sub, role: user.role };
}

function requiredParam(
	c: { req: { param: (name: string) => string | undefined } },
	name: string,
): string {
	const value = c.req.param(name);
	if (!value) throw new ValidationError(`${name} is required`);
	return value;
}

/**
 * Auth is installed by app.ts. All book and narrator IDs are validated against a
 * server-owned binding before the route touches Runtime or Core data.
 */
export const novelForkProductBooksRoutes = new Hono();

novelForkProductBooksRoutes.get("/bootstrap", async (c) => {
	const currentActor = actor(c);
	const [books, narrators] = await Promise.all([
		novelForkProductBookService.listReadyBooks(currentActor),
		novelForkProductBookService.listBoundNarrators(currentActor),
	]);
	return c.json({
		...getProductBootstrapContract(),
		books,
		narrators,
		model: getProductModelStatus(),
	});
});

novelForkProductBooksRoutes.get("/books", async (c) => {
	return c.json({ books: await novelForkProductBookService.listReadyBooks(actor(c)) });
});

novelForkProductBooksRoutes.post("/books", async (c) => {
	const parsed = bookInputSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const idempotencyKey = c.req.header("Idempotency-Key") ?? "";
	const operation = await novelForkProductBookService.create(
		actor(c),
		idempotencyKey,
		parsed.data as ProductBookInput,
	);
	return c.json(operation, operation.state === "ready" ? 201 : 202);
});

novelForkProductBooksRoutes.post("/books/import", async (c) => {
	const parsed = bookImportSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const operation = await novelForkProductBookService.importExisting(
		actor(c),
		c.req.header("Idempotency-Key") ?? "",
		parsed.data as ProductBookImportInput,
	);
	return c.json(operation, operation.state === "ready" ? 201 : 202);
});

novelForkProductBooksRoutes.delete("/books/:bookId", async (c) => {
	const deleteWorkspace = c.req.query("deleteWorkspace") === "true";
	await novelForkProductBookService.deleteBook(requiredParam(c, "bookId"), actor(c), deleteWorkspace);
	return c.json({ ok: true });
});

novelForkProductBooksRoutes.get("/books/:bookId/status", async (c) => {
	return c.json(await novelForkProductBookService.status(requiredParam(c, "bookId"), actor(c)));
});

novelForkProductBooksRoutes.post("/books/:bookId/retry", async (c) => {
	return c.json(await novelForkProductBookService.retry(requiredParam(c, "bookId"), actor(c)));
});

novelForkProductBooksRoutes.post("/books/:bookId/claim", async (c) => {
	return c.json(await novelForkProductBookService.claim(requiredParam(c, "bookId"), actor(c)));
});

novelForkProductBooksRoutes.post("/books/:bookId/repair", async (c) => {
	return c.json(await novelForkProductBookService.repair(requiredParam(c, "bookId"), actor(c)));
});

novelForkProductBooksRoutes.get("/books/:bookId/resources", async (c) => {
	return c.json(
		await novelForkProductBookService.getReadOnlyResources(requiredParam(c, "bookId"), actor(c)),
	);
});

/** Shared guard used before mounting novel-plugin domain routers. */
export async function assertBookProductAccess(
	currentActor: BoundNarratorActor,
	bookId: string,
): Promise<void> {
	await novelForkProductBookService.assertReadyBookAccess(bookId, currentActor);
}

/**
 * Compatibility-shaped book endpoints backed by the trusted Runtime product
 * binding. They keep the retained NovelFork workbench functional without
 * reviving the deleted Studio server.
 */
export const bookDomainRoutes = new Hono();

bookDomainRoutes.get("/", async (c) => {
	const payload = await novelForkProductBookService.getReadOnlyResources(
		requiredParam(c, "bookId"),
		actor(c),
	);
	const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
	return c.json({
		...payload,
		nextChapter:
			chapters.reduce((max, chapter) => {
				if (!chapter || typeof chapter !== "object") return max;
				const number = Number((chapter as { number?: unknown }).number);
				return Number.isSafeInteger(number) && number > max ? number : max;
			}, 0) + 1,
	});
});

bookDomainRoutes.get("/chapters/:chapterNumber", async (c) => {
	const chapterNumber = Number(requiredParam(c, "chapterNumber"));
	if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
		throw new ValidationError("chapterNumber must be a positive integer");
	}
	const workspace = await novelForkProductBookService.getWorkspace(
		requiredParam(c, "bookId"),
		actor(c),
	);
	const resource = workspace.resources.find(
		(candidate) => candidate.id === `chapter:${chapterNumber}`,
	);
	if (!resource || typeof resource.content !== "string") {
		return c.json({ error: "Chapter not found" }, 404);
	}
	return c.json({
		chapterNumber,
		filename: typeof resource.metadata?.fileName === "string" ? resource.metadata.fileName : null,
		content: resource.content,
	});
});

bookDomainRoutes.post("/chapters", async (c) => {
	const parsed = workspaceChapterCreateSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const result = await novelForkProductBookService.createWorkspaceChapter(
		requiredParam(c, "bookId"),
		parsed.data,
		actor(c),
	);
	return c.json({ chapter: result.resource }, 201);
});

bookDomainRoutes.put("/chapters/:chapterNumber", async (c) => {
	const chapterNumber = Number(requiredParam(c, "chapterNumber"));
	if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
		throw new ValidationError("chapterNumber must be a positive integer");
	}
	const parsed = workspaceResourceSaveSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	await novelForkProductBookService.saveWorkspaceResource(
		requiredParam(c, "bookId"),
		`chapter:${chapterNumber}`,
		parsed.data.content,
		actor(c),
	);
	return c.json({ ok: true, chapterNumber });
});

// Complete IDE filesystem gateway. Every operation resolves against the trusted
// book binding on the server; the browser only ever sends a relative path.
bookDomainRoutes.get("/files/tree", async (c) => {
	const rawDepth = Number(c.req.query("depth") ?? 8);
	const depth = Number.isFinite(rawDepth) ? rawDepth : 8;
	return c.json(await novelForkProductBookService.getWorkspaceFileTree(
		requiredParam(c, "bookId"), actor(c), depth,
	));
});

bookDomainRoutes.get("/files/read", async (c) => {
	const path = c.req.query("path");
	if (!path) throw new ValidationError("path is required");
	return c.json(await novelForkProductBookService.readWorkspaceFile(
		requiredParam(c, "bookId"), path, actor(c),
	));
});

bookDomainRoutes.put("/files", async (c) => {
	const parsed = workspaceFileWriteSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(await novelForkProductBookService.writeWorkspaceFile(
		requiredParam(c, "bookId"), parsed.data.path, parsed.data.content, actor(c),
	));
});

bookDomainRoutes.post("/files/mkdir", async (c) => {
	const parsed = workspacePathSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(await novelForkProductBookService.mkdirWorkspacePath(
		requiredParam(c, "bookId"), parsed.data.path, actor(c),
	), 201);
});

bookDomainRoutes.post("/files/rename", async (c) => {
	const parsed = workspaceRenameSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(await novelForkProductBookService.renameWorkspacePath(
		requiredParam(c, "bookId"), parsed.data.from, parsed.data.to, actor(c),
	));
});

bookDomainRoutes.post("/files/delete", async (c) => {
	const parsed = workspacePathSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(await novelForkProductBookService.deleteWorkspacePath(
		requiredParam(c, "bookId"), parsed.data.path, actor(c),
	));
});

// Book-scoped workspace gateway. Mutable chapter resources use semantic IDs;
// all reads and writes resolve through the server-owned binding.
export const bookWorkspaceRoutes = new Hono();

bookWorkspaceRoutes.get("/", async (c) => {
	return c.json(
		await novelForkProductBookService.getWorkspace(requiredParam(c, "bookId"), actor(c)),
	);
});

bookWorkspaceRoutes.post("/chapters", async (c) => {
	const parsed = workspaceChapterCreateSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(
		await novelForkProductBookService.createWorkspaceChapter(
			requiredParam(c, "bookId"),
			parsed.data,
			actor(c),
		),
		201,
	);
});

bookWorkspaceRoutes.put("/resources/:resourceId", async (c) => {
	const parsed = workspaceResourceSaveSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(
		await novelForkProductBookService.saveWorkspaceResource(
			requiredParam(c, "bookId"),
			requiredParam(c, "resourceId"),
			parsed.data.content,
			actor(c),
		),
	);
});

// Book-scoped narrator history and creation for the NovelFork IDE shell. The
// embedded native NarratorPanel still uses Runtime's canonical /api/narrators
// and /ws/narrator contracts after this trusted product selection.
export const bookNarratorGatewayRoutes = new Hono();

bookNarratorGatewayRoutes.get("/", async (c) => {
	const bookId = requiredParam(c, "bookId");
	return c.json({
		narrators: await novelForkProductBookService.listBookNarrators(bookId, actor(c)),
	});
});

bookNarratorGatewayRoutes.post("/", async (c) => {
	const parsed = bookNarratorCreateSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const narrator = await novelForkProductBookService.createBookNarrator(
		requiredParam(c, "bookId"),
		actor(c),
		parsed.data.title,
	);
	return c.json(narrator, 201);
});
