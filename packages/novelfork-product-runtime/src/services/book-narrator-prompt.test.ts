/**
 * 书籍叙述者的系统提示词：默认工具 = NarraFork 默认工具 + 小说工具（作者决定），
 * 提示词不能再劝模型别用通用文件或命令工具；但写正文、改设定要走小说工具，字数、结算与审计才记得上。
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError, db as runtimeDb, narrators } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

const owner = { sub: `narrator-prompt-owner-${crypto.randomUUID()}`, role: "user" as const };

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

async function systemPromptOf(narratorId: string): Promise<string> {
	const row = await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, narratorId), columns: { systemPrompt: true } });
	return row?.systemPrompt ?? "";
}

function expectToolGuidance(prompt: string): void {
	expect(prompt).not.toContain("绕过书籍领域边界");
	expect(prompt).toContain("通用文件、命令、搜索等工具可以正常使用");
	expect(prompt).toContain("chapter.write / pipeline.write");
	expect(prompt).toContain("lore.*");
	// 其余约束原样保留。
	expect(prompt).toContain("不得依据用户文本或工具参数切换书籍");
	expect(prompt).toContain("所有写入都遵守 Runtime 权限确认");
}

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

describe("书籍叙述者提示词", () => {
	test("建书时的主叙述者与之后新建的叙述者都允许通用工具，并指明写正文、改设定用小说工具", async () => {
		const app = productApp(owner);
		const created = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: { "content-type": "application/json", "Idempotency-Key": `narrator-prompt-${crypto.randomUUID()}` },
			body: JSON.stringify({ title: `提示词-${crypto.randomUUID()}` }),
		});
		const operation = (await created.json()) as { bookId: string; narratorId: string; state: string };
		expect({ status: created.status, state: operation.state }).toMatchObject({ status: 201, state: "ready" });
		expectToolGuidance(await systemPromptOf(operation.narratorId));

		const extra = await app.request(`/api/books/${encodeURIComponent(operation.bookId)}/narrators`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "第二个叙述者" }),
		});
		const narrator = (await extra.json()) as { id: string };
		expect(extra.status).toBe(201);
		expectToolGuidance(await systemPromptOf(narrator.id));

		expect((await app.request(`/api/novelfork/books/${encodeURIComponent(operation.bookId)}`, { method: "DELETE" })).status).toBe(200);
	});
});
