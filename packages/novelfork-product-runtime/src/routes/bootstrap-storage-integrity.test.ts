import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage, recordStorageIntegrityAlert } from "../adapters/storage";
import { checkStartupStorageIntegrity } from "../services/storage-integrity";

// 启动完整性告警此前只打到 stderr，界面看不到：bootstrap 必须带上 storageIntegrity，
// 且只给三段式说明与报告摘要，库文件只给文件名，不把本机绝对路径交给前端。

const owner = { sub: `bootstrap-integrity-${crypto.randomUUID()}`, role: "user" as const };

function productApp() {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
		throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
	}
	app.use("*", async (c, next) => {
		c.set("user", owner as never);
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

const damagedPath = "C:\\Users\\author\\.novelfork\\.runtime\\novelfork.db";

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

afterAll(() => {
	recordStorageIntegrityAlert(null);
});

describe("GET /api/novelfork/bootstrap 的 storageIntegrity", () => {
	test("库健康时为 null", async () => {
		recordStorageIntegrityAlert(null);
		const response = await productApp().request("/api/novelfork/bootstrap");
		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toHaveProperty("storageIntegrity", null);
	});

	test("库损坏时带三段式说明与报告摘要，不暴露绝对路径", async () => {
		const alert = checkStartupStorageIntegrity({
			databasePath: damagedPath,
			startupIntegrity: `*** in database main ***\nPage 3 is never used\nrow 7 missing from index idx_books`,
		} as never);
		expect(alert).not.toBeNull();
		recordStorageIntegrityAlert(alert);

		const response = await productApp().request("/api/novelfork/bootstrap");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { storageIntegrity: Record<string, unknown> | null };
		expect(body.storageIntegrity).toMatchObject({
			code: "STORAGE_INTEGRITY_DAMAGED",
			storageFile: "novelfork.db",
			reportSummary: "*** in database main ***",
			explanation: {
				whatHappened: expect.stringContaining("novelfork.db"),
				whyItMatters: expect.stringContaining("作品"),
				suggestedAction: expect.stringContaining("导出"),
			},
		});
		const serialized = JSON.stringify(body.storageIntegrity);
		expect(serialized).not.toContain("Users");
		expect(serialized).not.toContain("author");
		expect(body.storageIntegrity).not.toHaveProperty("storagePath");
	});
});
