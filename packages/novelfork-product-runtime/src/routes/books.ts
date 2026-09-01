import { ValidationError } from "@vivy1024/narrafork-runtime-bridge";
import {
	handleProjectWritingSkillDelete,
	handleProjectWritingSkillUpdate,
	handleWritingSkillsRead,
	handleWritingSkillsWrite,
} from "../../../novel-plugin/src/handlers/writing-skill-handlers";
import { Hono } from "hono";
import { z } from "zod/v4";
import {
	getProductModelStatus,
	novelForkProductBookService,
	type ProductBookBasicSettingsPatch,
	type ProductBookImportInput,
	type ProductBookInput,
} from "../services/book-provision";
import type { BoundNarratorActor } from "../services/narrator-access";
import { getProductBootstrapContract } from "../services/product-contract";

const guidedSetupAnswerSchema = z
	.object({
		mode: z.string().trim().min(1).max(40),
		value: z.string().max(20_000),
	})
	.strict();

const guidedSetupSchema = z
	.object({
		answers: z.record(z.string().trim().min(1).max(80), guidedSetupAnswerSchema),
	})
	.strict();

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

const bookBasicSettingsPatchSchema = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		genre: z.string().trim().min(1).max(100).optional(),
		language: z.enum(["zh", "en"]).optional(),
		platform: z.enum(["tomato", "feilu", "qidian", "other"]).optional(),
		status: z.enum(["incubating", "outlining", "active", "paused", "completed", "dropped"]).optional(),
		chapterWordCount: z.number().int().min(500).max(100_000).optional(),
		targetChapters: z.number().int().min(1).max(100_000).nullable().optional(),
		arcTrackingMode: z.enum(["off", "rule", "llm"]).optional(),
		customSensitiveWords: z.string().max(50_000).optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "至少提供一项可保存的书籍设置");

const writingSkillSelectionSchema = z
	.object({
		addSkillIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
		removeSkillIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
		refreshSkillIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
	})
	.strict();

const projectWritingSkillUpdateSchema = z
	.object({ content: z.string().min(1).max(2_000_000) })
	.strict();

const bookImportSchema = z
	.object({
		sourcePath: z.string().trim().min(1).max(2_000),
		bookId: z.string().trim().min(1).max(80).optional(),
	})
	.strict();

const bookRebindWorkspaceSchema = z
	.object({
		workspaceRoot: z.string().trim().min(1).max(2_000),
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

function handlerData(result: {
	ok: boolean;
	summary: string;
	error?: string;
	data?: unknown;
}): unknown {
	if (!result.ok) throw new ValidationError(result.summary || result.error || "书籍写作配置操作失败");
	return result.data ?? {};
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

novelForkProductBooksRoutes.post("/books/:bookId/rebind-workspace", async (c) => {
	const parsed = bookRebindWorkspaceSchema.safeParse(await c.req.json());
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	return c.json(
		await novelForkProductBookService.rebindWorkspace(
			requiredParam(c, "bookId"),
			actor(c),
			parsed.data.workspaceRoot,
		),
	);
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

/** NewBookGuide completion: POST /api/books/:bookId/guided-setup */
bookDomainRoutes.post("/guided-setup", async (c) => {
	const parsed = guidedSetupSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const result = await novelForkProductBookService.applyGuidedSetup(
		requiredParam(c, "bookId"),
		parsed.data,
		actor(c),
	);
	return c.json(result);
});

bookDomainRoutes.put("/", async (c) => {
	const parsed = bookBasicSettingsPatchSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const book = await novelForkProductBookService.updateBasicSettings(
		requiredParam(c, "bookId"),
		parsed.data as ProductBookBasicSettingsPatch,
		actor(c),
	);
	return c.json({ book });
});

// 书籍级 Writing Skills。项目目录 `.novelfork/skills/` 的实际文件是唯一生效来源，
// 该路由只对指定 catalog Skill 执行增删/刷新，不维护 book.json 选择字段。
bookDomainRoutes.get("/writing-skills", async (c) => {
	const bookId = requiredParam(c, "bookId");
	const { root } = await novelForkProductBookService.getTrustedBookConfiguration(bookId, actor(c));
	const scope = c.req.query("scope") === "enabled" ? "enabled" : "available";
	const result = await handleWritingSkillsRead({ bookId, scope }, { bookRoot: root });
	return c.json(handlerData(result));
});

bookDomainRoutes.put("/writing-skills", async (c) => {
	const parsed = writingSkillSelectionSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const bookId = requiredParam(c, "bookId");
	const { root } = await novelForkProductBookService.getTrustedBookConfiguration(bookId, actor(c));
	const result = await handleWritingSkillsWrite(
		{
			bookId,
			...(parsed.data.addSkillIds === undefined ? {} : { addSkillIds: parsed.data.addSkillIds }),
			...(parsed.data.removeSkillIds === undefined ? {} : { removeSkillIds: parsed.data.removeSkillIds }),
			...(parsed.data.refreshSkillIds === undefined ? {} : { refreshSkillIds: parsed.data.refreshSkillIds }),
		},
		{ bookRoot: root },
	);
	return c.json(handlerData(result));
});

bookDomainRoutes.put("/writing-skills/:slug", async (c) => {
	const parsed = projectWritingSkillUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) throw new ValidationError(parsed.error.message);
	const bookId = requiredParam(c, "bookId");
	const { root } = await novelForkProductBookService.getTrustedBookConfiguration(bookId, actor(c));
	const result = await handleProjectWritingSkillUpdate(
		{ bookId, slug: requiredParam(c, "slug"), content: parsed.data.content },
		{ bookRoot: root },
	);
	return c.json(handlerData(result));
});

bookDomainRoutes.delete("/writing-skills/:slug", async (c) => {
	const bookId = requiredParam(c, "bookId");
	const { root } = await novelForkProductBookService.getTrustedBookConfiguration(bookId, actor(c));
	const result = await handleProjectWritingSkillDelete(
		{ bookId, slug: requiredParam(c, "slug") },
		{ bookRoot: root },
	);
	return c.json(handlerData(result));
});

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
	const refresh = c.req.query("refresh") === "1";
	return c.json(await novelForkProductBookService.getWorkspaceFileTree(
		requiredParam(c, "bookId"), actor(c), depth, { refresh },
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
