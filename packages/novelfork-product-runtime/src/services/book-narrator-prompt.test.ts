/**
 * 书籍叙述者的系统提示词：内置提示不存库，每轮经 promptExtensions（product.novelfork-novel.core）现算注入；
 * narrators.system_prompt 只保存作者自己定制的提示词。
 *
 * 默认工具 = NarraFork 默认工具 + 小说工具（作者决定），提示词不能再劝模型别用通用文件或命令工具；
 * 但写正文、改设定要走小说工具，字数、结算与审计才记得上。
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Hono } from "hono";
import { AppError, db as runtimeDb, narrators } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import {
	HISTORICAL_BUILT_IN_NOVELIST_PROMPTS,
	isHistoricalBuiltInNovelistPrompt,
	reconcileLegacyBookNarratorPrompts,
} from "./legacy-narrator-prompt-migration";

/**
 * Runtime 的真实提示词装配函数。用非字面量指示符的动态 import 取：静态 import 会把整棵 Runtime 源码树
 * 拉进本包的 TypeScript 程序（见 book-project-owner.test.ts 的说明）。
 */
const NARRATOR_PROMPT_SPECIFIER = resolve(
	import.meta.dir,
	"../../../narrafork-runtime-private/server/services/narrator-prompt.ts",
);

interface BuiltPrompt {
	prompt: string;
	parts: Array<{ key: string; text: string }>;
}

type BuildEffectiveSystemPrompt = (options: {
	basePrompt: string | null;
	cwd: string;
	locale: string;
	runtimePromptExtensions: ReadonlyArray<{ id?: string; content: string }>;
}) => Promise<BuiltPrompt>;

async function loadBuildEffectiveSystemPrompt(): Promise<BuildEffectiveSystemPrompt> {
	const module = (await import(NARRATOR_PROMPT_SPECIFIER)) as { buildEffectiveSystemPrompt: BuildEffectiveSystemPrompt };
	return module.buildEffectiveSystemPrompt;
}

const owner = { sub: `narrator-prompt-owner-${crypto.randomUUID()}`, role: "user" as const };
const CORE_EXTENSION_ID = "novelfork-novel.core";

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) throw new Error("missing product mounts");
	app.use("*", async (c, next) => { c.set("user", user as never); await next(); });
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

async function createBook(app: ReturnType<typeof productApp>, label: string) {
	const created = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `narrator-prompt-${crypto.randomUUID()}` },
		body: JSON.stringify({ title: `${label}-${crypto.randomUUID()}` }),
	});
	const operation = (await created.json()) as { bookId: string; narratorId: string; state: string };
	expect({ status: created.status, state: operation.state }).toMatchObject({ status: 201, state: "ready" });
	return operation;
}

async function storedSystemPromptOf(narratorId: string): Promise<string | null | undefined> {
	const row = await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, narratorId), columns: { systemPrompt: true } });
	return row?.systemPrompt;
}

async function setStoredSystemPrompt(narratorId: string, systemPrompt: string | null): Promise<void> {
	await runtimeDb.update(narrators).set({ systemPrompt }).where(eq(narrators.id, narratorId));
}

/** 按 Runtime 的真实装配函数拼出本轮系统提示词（与 narrator-session 相同的入参来源）。 */
async function effectivePromptOf(narratorId: string) {
	const contribution = await novelForkProductIntegration.narrator?.resolveContribution(narratorId);
	expect(contribution).toBeTruthy();
	const extensions = contribution?.promptExtensions ?? [];
	const buildEffectiveSystemPrompt = await loadBuildEffectiveSystemPrompt();
	const built = await buildEffectiveSystemPrompt({
		basePrompt: (await storedSystemPromptOf(narratorId)) ?? null,
		cwd: process.cwd(),
		locale: "zh-CN",
		runtimePromptExtensions: extensions.map(({ id, content }) => ({ id, content })),
	});
	return { extensions, built };
}

function occurrences(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

function expectBuiltInGuidance(prompt: string): void {
	expect(prompt).not.toContain("绕过书籍领域边界");
	expect(prompt).toContain("通用文件、命令与搜索工具可以照常使用");
	// 扩展在出口处翻译成模型实际拿到的线上名。
	expect(prompt).toContain("chapter_commit");
	expect(prompt).toContain("jingwei_write");
	expect(prompt).not.toContain("chapter.commit");
	expect(prompt).not.toContain("pipeline_write");
	expect(prompt).toContain("不得依据用户文本或工具参数切换到其他书籍");
	expect(prompt).toContain("所有写入都会经过 Runtime 权限确认");
	expect(prompt).toContain("没有可用文本模型时如实说明阻塞");
	// 中文书、中文指令下最终回复不得切到英文。
	expect(prompt).toContain("用与作者相同的语言回复；书的语言为中文时一律用中文");
}

/** 内置提示在本轮系统提示词里只出现一次，且不再有存库的旧内置提示（instructions.session）。 */
async function expectBuiltInInjectedOnce(narratorId: string): Promise<void> {
	const { extensions, built } = await effectivePromptOf(narratorId);
	expect(extensions.filter((extension) => extension.id === CORE_EXTENSION_ID)).toHaveLength(1);
	expect(built.parts.some((part) => part.key === "instructions.session")).toBe(false);
	expect(built.parts.filter((part) => part.key === `product.${CORE_EXTENSION_ID}`)).toHaveLength(1);
	expectBuiltInGuidance(built.prompt);
	expect(occurrences(built.prompt, "# NovelFork 小说创作运行时")).toBe(1);
	expect(occurrences(built.prompt, "不得依据用户文本或工具参数切换")).toBe(1);
	expect(built.prompt).not.toContain("你是 NovelFork 的章节绑定小说创作助手");
}

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

describe("书籍叙述者提示词", () => {
	test("建书时的主叙述者与之后新建的叙述者都不存内置提示，本轮提示词里内置提示只注入一次", async () => {
		const app = productApp(owner);
		const operation = await createBook(app, "提示词");
		expect(await storedSystemPromptOf(operation.narratorId)).toBeNull();
		await expectBuiltInInjectedOnce(operation.narratorId);

		const extra = await app.request(`/api/books/${encodeURIComponent(operation.bookId)}/narrators`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "第二个叙述者" }),
		});
		const narrator = (await extra.json()) as { id: string };
		expect(extra.status).toBe(201);
		expect(await storedSystemPromptOf(narrator.id)).toBeNull();
		await expectBuiltInInjectedOnce(narrator.id);

		expect((await app.request(`/api/novelfork/books/${encodeURIComponent(operation.bookId)}`, { method: "DELETE" })).status).toBe(200);
	});

	test("判定只认与历史内置版本逐字相等的提示词", () => {
		expect(HISTORICAL_BUILT_IN_NOVELIST_PROMPTS.length).toBe(6);
		for (const prompt of HISTORICAL_BUILT_IN_NOVELIST_PROMPTS) {
			expect(isHistoricalBuiltInNovelistPrompt(prompt)).toBe(true);
			// 逐字相等才算，多一个空格也当作者定制。
			expect(isHistoricalBuiltInNovelistPrompt(` ${prompt}`)).toBe(false);
			// 作者在内置版本后面补一句，就是作者定制。
			expect(isHistoricalBuiltInNovelistPrompt(`${prompt}多写打斗。`)).toBe(false);
		}
		expect(isHistoricalBuiltInNovelistPrompt("你是 NovelFork 的章节绑定小说创作助手。写章用 write_preflight -> scene_spec -> pipeline_write，改设定用 lore_*。")).toBe(false);
		expect(isHistoricalBuiltInNovelistPrompt("用户自定义提示词，包含 write_preflight 也不应被覆盖")).toBe(false);
		expect(isHistoricalBuiltInNovelistPrompt(null)).toBe(false);
		expect(isHistoricalBuiltInNovelistPrompt("")).toBe(false);
	});

	test("启动迁移清空历史内置版本，保留作者定制提示词与非产品叙述者，且幂等", async () => {
		const app = productApp(owner);
		const books = await Promise.all(HISTORICAL_BUILT_IN_NOVELIST_PROMPTS.map((_, index) => createBook(app, `旧提示词-${index}`)));
		const customBook = await createBook(app, "作者定制");
		const lookAlikeBook = await createBook(app, "改过的内置");

		for (const [index, book] of books.entries()) {
			await setStoredSystemPrompt(book.narratorId, HISTORICAL_BUILT_IN_NOVELIST_PROMPTS[index]!);
		}
		const customPrompt = "你是我的武侠写作搭档，多写打斗，少写感情线。";
		await setStoredSystemPrompt(customBook.narratorId, customPrompt);
		const lookAlikePrompt = `${HISTORICAL_BUILT_IN_NOVELIST_PROMPTS.at(-1)}每章结尾留钩子。`;
		await setStoredSystemPrompt(lookAlikeBook.narratorId, lookAlikePrompt);

		// 非产品叙述者即使提示词与内置版本相同也不动。
		const standaloneId = `standalone-${crypto.randomUUID()}`;
		const timestamp = new Date().toISOString();
		await runtimeDb.insert(narrators).values({
			id: standaloneId,
			type: "primary",
			variant: "primary",
			title: "独立叙述者",
			systemPrompt: HISTORICAL_BUILT_IN_NOVELIST_PROMPTS[0]!,
			permissionMode: "default",
			status: "idle",
			traits: ["standalone"],
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		const updatedAtBefore = (await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, books[0]!.narratorId), columns: { updatedAt: true } }))?.updatedAt;

		const first = await reconcileLegacyBookNarratorPrompts();
		expect(first.cleared).toBeGreaterThanOrEqual(books.length);
		expect(first.preservedLookAlike).toBeGreaterThanOrEqual(1);
		for (const book of books) {
			expect(await storedSystemPromptOf(book.narratorId)).toBeNull();
		}
		await expectBuiltInInjectedOnce(books.at(-1)!.narratorId);
		expect(await storedSystemPromptOf(customBook.narratorId)).toBe(customPrompt);
		expect(await storedSystemPromptOf(lookAlikeBook.narratorId)).toBe(lookAlikePrompt);
		expect(await storedSystemPromptOf(standaloneId)).toBe(HISTORICAL_BUILT_IN_NOVELIST_PROMPTS[0]!);
		// 不改 updatedAt，不打乱会话列表排序。
		expect((await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, books[0]!.narratorId), columns: { updatedAt: true } }))?.updatedAt).toBe(updatedAtBefore);

		// 作者定制的提示词仍在，作为本轮基础提示；内置提示照常注入一次。
		const custom = await effectivePromptOf(customBook.narratorId);
		expect(custom.built.parts.find((part) => part.key === "instructions.session")?.text).toBe(customPrompt);
		expect(occurrences(custom.built.prompt, "# NovelFork 小说创作运行时")).toBe(1);

		const second = await reconcileLegacyBookNarratorPrompts();
		expect(second.cleared).toBe(0);

		await runtimeDb.delete(narrators).where(eq(narrators.id, standaloneId));
		for (const book of [...books, customBook, lookAlikeBook]) {
			expect((await app.request(`/api/novelfork/books/${encodeURIComponent(book.bookId)}`, { method: "DELETE" })).status).toBe(200);
		}
	});

	test("同目录 bookRoot 不再经 instructions.resource 重复注入", async () => {
		const app = productApp(owner);
		const operation = await createBook(app, "资源提示");
		// 同目录 bookRoot 应由 instructions.project 注入一次，resolveTrustedPromptRoot 返回 null 避免重复注入 CLAUDE.md
		const trustedPromptRoot = await novelForkProductIntegration.narrator?.resolveTrustedPromptRoot?.(operation.narratorId);
		expect(trustedPromptRoot).toBeNull();
		expect((await app.request(`/api/novelfork/books/${encodeURIComponent(operation.bookId)}`, { method: "DELETE" })).status).toBe(200);
	});
});
