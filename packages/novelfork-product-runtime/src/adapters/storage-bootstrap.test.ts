import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	closeNovelRuntimeStorage,
	getStorageIntegrityAlert,
	initializeNovelRuntimeStorage,
	resolveNovelRuntimeStoragePath,
} from "./storage";

const originalStoragePath = process.env.NOVELFORK_STORAGE_DB_PATH;
const originalSessionStoreDir = process.env.NOVELFORK_SESSION_STORE_DIR;
const roots: string[] = [];

afterEach(async () => {
	closeNovelRuntimeStorage();
	if (originalStoragePath === undefined) delete process.env.NOVELFORK_STORAGE_DB_PATH;
	else process.env.NOVELFORK_STORAGE_DB_PATH = originalStoragePath;
	if (originalSessionStoreDir === undefined) delete process.env.NOVELFORK_SESSION_STORE_DIR;
	else process.env.NOVELFORK_SESSION_STORE_DIR = originalSessionStoreDir;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Novel Runtime storage bootstrap", () => {
	test("uses an explicit domain database path and runs Core migrations", async () => {
		const root = await mkdtemp(join(tmpdir(), "novel-runtime-storage-"));
		roots.push(root);
		const databaseDir = join(root, "domain-store");
		await mkdir(databaseDir, { recursive: true });
		const databasePath = join(databaseDir, "novelfork.db");
		process.env.NOVELFORK_STORAGE_DB_PATH = databasePath;
		process.env.NOVELFORK_SESSION_STORE_DIR = join(root, "ignored-session-store");

		expect(resolveNovelRuntimeStoragePath()).toBe(resolve(databasePath));
		const storage = initializeNovelRuntimeStorage();
		expect(storage.databasePath).toBe(resolve(databasePath));
		expect(
			storage.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'")
				.get(),
		).toBeDefined();
	});

	test("uses the Studio-compatible session store directory when no explicit path exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "novel-runtime-session-store-"));
		roots.push(root);
		delete process.env.NOVELFORK_STORAGE_DB_PATH;
		process.env.NOVELFORK_SESSION_STORE_DIR = root;

		expect(resolveNovelRuntimeStoragePath()).toBe(resolve(root, "novelfork.db"));
	});

	// B2：启动时算出的完整性检查结果必须被产品侧真正消费（此前只有 core 写、无人读）。
	test("exposes the startup integrity result through the product storage adapter", async () => {
		await mkdtemp(join(tmpdir(), "novel-runtime-integrity-")).then((root) => {
			roots.push(root);
			process.env.NOVELFORK_STORAGE_DB_PATH = join(root, "novelfork.db");
			delete process.env.NOVELFORK_SESSION_STORE_DIR;
		});

		const storage = initializeNovelRuntimeStorage();
		// 健康库：不产生告警（不能把正常启动报成故障）。
		expect(storage.startupIntegrity).toBe("ok");
		expect(getStorageIntegrityAlert()).toBeNull();

		closeNovelRuntimeStorage();
		// 关闭后告警状态必须清空，不能把上一次启动的结论留给下一次。
		expect(getStorageIntegrityAlert()).toBeNull();
	});
});
