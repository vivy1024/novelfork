import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

// T-17（缺陷 #6）红测：book.json 损坏或读取失败时，书不得从书架消失。
// 书架列表的 id/title/status/updatedAt 来自产品库记录，不依赖 book.json 内容；
// 因此 book.json 损坏只应让写作配置字段缺省，而不应让整本书被跳过。
// 同时守住安全边界：损坏的 book.json 不得使该书重新获得可信根与工具访问权。

const owner = { sub: `shelf-owner-${crypto.randomUUID()}`, role: "user" as const };
let externalBookRoot = "";
let bookId: string | null = null;

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
		throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
	}
	app.use("*", async (c, next) => {
		c.set("user", user as never);
		await next();
	});
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) =>
		error instanceof AppError
			? c.json({ code: error.code, error: error.message }, error.statusCode as never)
			: c.json({ error: String(error) }, 500),
	);
	return app;
}

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	externalBookRoot = await mkdtemp(join(tmpdir(), "novelfork-shelf-corrupt-"));
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

describe("book.json 损坏时书架不丢书（T-17 红测）", () => {
	test("book.json 损坏后，书仍在书架列表中且 id/title 与损坏前一致", async () => {
		const app = productApp(owner);
		const create = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"Idempotency-Key": `shelf-corrupt-${crypto.randomUUID()}`,
			},
			body: JSON.stringify({
				title: "书架不丢书的测试书",
				projectInit: { source: "existing", workspaceRoot: externalBookRoot, managedByNovelFork: false },
			}),
		});
		const operation = (await create.json()) as { bookId?: string; state?: string };
		expect({ status: create.status, state: operation.state }).toMatchObject({ status: 201, state: "ready" });
		if (!operation.bookId) throw new Error("fixture did not create a book");
		bookId = operation.bookId;

		const before = (await (await app.request("/api/novelfork/books")).json()) as {
			books: Array<{ id: string; title: string }>;
		};
		const shelfBefore = before.books.find((book) => book.id === bookId);
		expect(shelfBefore).toBeDefined();

		// 模拟写入中断 / 人工误改：把 book.json 写成半截、无法解析的内容。
		const configPath = join(externalBookRoot, "book.json");
		const originalConfig = await readFile(configPath, "utf8");
		await writeFile(configPath, originalConfig.slice(0, Math.floor(originalConfig.length / 2)), "utf8");

		const after = (await (await app.request("/api/novelfork/books")).json()) as {
			books: Array<{ id: string; title: string }>;
		};
		const shelfAfter = after.books.find((book) => book.id === bookId);

		// 修复目标：损坏后这本书依然在书架上，且身份字段来自产品库，与损坏前一致。
		expect(shelfAfter).toBeDefined();
		expect(shelfAfter).toMatchObject({ id: shelfBefore?.id, title: shelfBefore?.title });
	});

	test("book.json 损坏后，该书仍不获得工作区或叙述者访问权（安全边界不被降级绕过）", async () => {
		if (!bookId) throw new Error("shelf fixture missing");
		const app = productApp(owner);
		// 信任检查依赖 book.json 的可信标记；标记无法读取时必须继续拒绝访问。
		const workspace = await app.request(`/api/books/${bookId}/workspace`);
		expect(workspace.status).not.toBe(200);
		const narrators = await app.request(`/api/books/${bookId}/narrators`);
		expect(narrators.status).not.toBe(200);
	});

	test("原子写覆盖 book.json 后文件始终是完整可解析的 JSON，书仍可读（接线层证据）", async () => {
		// 本用例自建一本健康的书、使用独立目录，不依赖前一用例留下的（已被故意损坏的）状态，
		// 因此无论执行顺序如何都成立。
		const ownRoot = await mkdtemp(join(tmpdir(), "novelfork-shelf-write-"));
		try {
			const app = productApp(owner);
			const create = await app.request("/api/novelfork/books", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"Idempotency-Key": `shelf-write-${crypto.randomUUID()}`,
				},
				body: JSON.stringify({
					title: "覆盖写接线测试书",
					projectInit: { source: "existing", workspaceRoot: ownRoot, managedByNovelFork: false },
				}),
			});
			const operation = (await create.json()) as { bookId?: string; state?: string };
			expect({ status: create.status, state: operation.state }).toMatchObject({ status: 201, state: "ready" });
			if (!operation.bookId) throw new Error("write-path fixture did not create a book");
			const ownBookId = operation.bookId;

			// 中断安全的语义（rename 失败时旧内容完好、无临时文件残留）由 atomic-write.test.ts 直接证明。
			// 本用例证明产品侧的覆盖写已走原子路径：覆盖后 book.json 仍是完整 JSON，且书架仍能读到该书。
			const configPath = join(ownRoot, "book.json");
			const before = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
			expect(before).toMatchObject({ id: ownBookId });

			// 触发一次真实的 book.json 覆盖写：PUT /api/books/:bookId 写入 foreshadowDebtThresholds。
			const save = await app.request(`/api/books/${ownBookId}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ foreshadowDebtThresholds: { watchChapters: 8, overdueChapters: 30 } }),
			});
			// 只接受真实成功码：404/405 说明路由不存在，不能被当作通过。
			expect(save.status).toBe(200);

			const after = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
			expect(after).toMatchObject({ id: ownBookId, foreshadowDebtThresholds: { watchChapters: 8, overdueChapters: 30 } });
			const shelf = (await (await app.request("/api/novelfork/books")).json()) as { books: Array<{ id: string }> };
			expect(shelf.books.some((book) => book.id === ownBookId)).toBe(true);
			await Promise.resolve(app.request(`/api/novelfork/books/${ownBookId}`, { method: "DELETE" })).catch(() => undefined);
		} finally {
			await rm(ownRoot, { recursive: true, force: true });
		}
	});
});
